// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
//! Private framed PCM pipe, an Opus publisher, and an embedded WT/WS relay.
#![recursion_limit = "512"]
use anyhow::{Context, ensure};
use bytes::Bytes;
use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
mod diagnostics;
mod runtime;
mod spotify;
mod spotify_stream;
mod upstream;

#[derive(Deserialize)]
struct Config {
    relay: moq_relay::Config,
    bitrate: u64,
    name: String,
    upstream: Option<Upstream>,
}

#[derive(Deserialize)]
struct Upstream {
    url: String,
    protocol: String,
}

fn initialize_crypto() {
    // Select one provider for both MoQ and librespot before either mode builds
    // a TLS client. Rustls cannot infer it when both providers are compiled in.
    let _ = moq_tokio::crypto::install_default();
}

fn main() -> anyhow::Result<()> {
    initialize_crypto();
    runtime::run(run())
}

async fn run() -> anyhow::Result<()> {
    if std::env::args().nth(1).as_deref() == Some("--spotify") {
        return spotify::run().await;
    }
    if std::env::var_os("RUST_LOG").is_some() {
        moq_tokio::Log::default().init()?;
    }
    // Configuration arrives through stdin, never through process arguments.
    let mut input = BufReader::new(tokio::io::stdin());
    let mut line = String::new();
    input.read_line(&mut line).await?;
    let config: Config = serde_json::from_str(&line)?;
    ensure!(
        (32_000..=320_000).contains(&config.bitrate),
        "invalid bitrate"
    );
    let relay = moq_relay::Relay::load(config.relay).await?;
    let ready = relay.ready();

    let mut broadcast = relay
        .cluster()
        .origin
        .publish(config.name, Default::default())?;
    let mut catalog = moq_mux::catalog::Producer::new(
        &mut broadcast,
        moq_mux::catalog::Config::default()
            .with_catalog(moq_mux::catalog::hang::Catalog::<
                moq_mux::catalog::hang::Extra,
            >::default())
            .with_max_age(std::time::Duration::from_secs(10)),
    )?;
    let mut options = moq_audio::encode::Options::default();
    options.track = Some("audio.opus".into());
    options.settings.bitrate = Some(moq_net::bandwidth::Rate::from_bps(config.bitrate));
    let mut audio = moq_audio::encode::Producer::new(
        &mut broadcast,
        catalog.clone(),
        Default::default(),
        &options,
    )?;
    // The Rust catalog indexes each track separately. Released @moq/hang
    // 0.5.2 expects the earlier archive.track shape. This is a live broadcast:
    // omit archive discovery while retaining the media's ten-second cache.
    catalog.modify()?.archive = None;
    let relay_origin = relay.cluster().origin.consume();
    let trigger = relay.shutdown_trigger().clone();
    let mut running = tokio::spawn(relay.with_signals(false).run());
    ready.wait().await?;
    // Outbound only: the managed relay learns the broadcast through this
    // connection and clients never need an address for this server.
    let stats = moq_net::stats::Registry::new(Default::default());
    let upstream = if let Some(upstream) = config.upstream {
        let connect = upstream::config(&upstream.url, &upstream.protocol)?;
        let client = connect.init(Default::default())?.with_stats(
            stats
                .tier(moq_net::stats::Tier::new("upstream"))
                .session(""),
        );
        let connection = client
            .publish(relay_origin)
            .context("Missing upstream URL")?;
        Some(
            tokio::time::timeout(std::time::Duration::from_secs(20), connection.established())
                .await
                .map_err(|_| anyhow::anyhow!("Upstream MoQ connection timed out"))?
                .context("Upstream MoQ connection failed")?,
        )
    } else {
        None
    };
    println!("{}", serde_json::json!({"event":"ready"}));
    // Relays without joining FETCH cannot backfill the current catalog group.
    // Publish a fresh snapshot periodically so an idle broadcast remains joinable.
    let refresh = async {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(3));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut revision = 0u64;
        loop {
            interval.tick().await;
            revision += 1;
            if let Err(error) = catalog.modify().and_then(|mut catalog| {
                catalog.set_section("jmmp", serde_json::json!({"revision": revision}))
            }) {
                return Err::<(), anyhow::Error>(error.into());
            }
        }
    };
    let clock = std::time::Instant::now();
    let pcm_health = std::sync::Arc::new(std::sync::Mutex::new(diagnostics::PcmHealth::default()));
    let monitoring = async {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(250));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let monitor = upstream.as_ref().map(|connection| connection.monitor());
        let mut health = diagnostics::UpstreamHealth::default();
        let mut report = moq_net::stats::Report::default();
        let mut last_transport = None;
        loop {
            interval.tick().await;
            let now = clock.elapsed().as_millis() as u64;
            let (frames, recent) = {
                let mut pcm = pcm_health.lock().unwrap();
                if let Some(event) = pcm.tick(now) {
                    diagnostics::emit(event);
                }
                (pcm.frames, pcm.recent(now))
            };
            if last_transport.is_some_and(|last| now.saturating_sub(last) < 1000) {
                continue;
            }
            last_transport = Some(now);
            if let (Some(monitor), Some(connection)) = (&monitor, &upstream) {
                stats.report(&mut report);
                let traffic = report
                    .traffic
                    .first()
                    .map(|entry| entry.publisher.clone())
                    .unwrap_or_default();
                for event in health.sample(
                    now,
                    connection.epoch(),
                    monitor.stats(),
                    &traffic,
                    frames,
                    recent,
                ) {
                    diagnostics::emit(event);
                }
            }
        }
    };
    let read = async {
        let mut last_encode_warning = None;
        loop {
            // 24 bytes: type, generation, byte length, reserved, timestamp µs (LE).
            let mut header = [0u8; 24];
            match input.read_exact(&mut header).await {
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
                Err(e) => return Err(e.into()),
            }
            let kind = u32::from_le_bytes(header[0..4].try_into()?);
            let generation = u32::from_le_bytes(header[4..8].try_into()?);
            let len = u32::from_le_bytes(header[8..12].try_into()?) as usize;
            ensure!(
                len <= 960 * 2 * 4 && len % 8 == 0,
                "invalid PCM frame length"
            );
            let mut data = vec![0u8; len];
            input
                .read_exact(&mut data)
                .await
                .context("truncated PCM frame")?;
            match kind {
                0 => {
                    for event in pcm_health
                        .lock()
                        .unwrap()
                        .progress(clock.elapsed().as_millis() as u64, generation)
                    {
                        diagnostics::emit(event);
                    }
                    ensure!(len > 0, "empty PCM frame");
                    ensure!(
                        data.chunks_exact(4)
                            .all(|v| f32::from_le_bytes(v.try_into().unwrap()).is_finite()),
                        "non-finite PCM"
                    );
                    let encoding = std::time::Instant::now();
                    let result = audio.write(&moq_audio::Frame::new(
                        Bytes::from(data),
                        moq_net::Timestamp::from_micros(clock.elapsed().as_micros() as u64)?,
                    ));
                    let now = clock.elapsed().as_millis() as u64;
                    if result.is_err()
                        || encoding.elapsed().as_millis() > 100
                            && last_encode_warning
                                .is_none_or(|last| now.saturating_sub(last) >= 5000)
                    {
                        last_encode_warning = Some(now);
                        diagnostics::emit(
                            serde_json::json!({"stage":"server_helper", "eventType":if result.is_err() {"encode_failed"} else {"encode_slow"}, "phase":"encode", "generation":generation, "durationMs":encoding.elapsed().as_millis() as u64}),
                        );
                    }
                    result?;
                }
                1 => {
                    pcm_health.lock().unwrap().reset();
                    ensure!(len == 0, "cut has payload");
                    audio.discontinuity()?;
                }
                2 => {
                    ensure!(len == 0, "stop has payload");
                    break;
                }
                _ => anyhow::bail!("unknown pipe frame"),
            }
        }
        Ok::<(), anyhow::Error>(())
    };
    let result = tokio::select! {
        _ = monitoring => Err(anyhow::anyhow!("Pipeline monitor stopped")),
        result = read => result,
        result = refresh => result,
        result = &mut running => {
            diagnostics::emit(serde_json::json!({"stage":"server_helper", "eventType":"relay_failed", "phase":"transport"}));
            return result.context("relay task")?;
        },
        result = async {
            match &upstream {
                Some(connection) => connection.closed().await,
                None => std::future::pending::<moq_tokio::Result<()>>().await,
            }
        } => {
            diagnostics::emit(serde_json::json!({"stage":"helper_upstream", "eventType":"closed", "phase":"transport"}));
            Err(upstream::stopped(result))
        },
    };
    drop(audio);
    drop(catalog);
    drop(broadcast);
    let upstream_shutdown = match upstream {
        Some(upstream) => upstream
            .close()
            .await
            .map_err(|_| anyhow::anyhow!("Upstream MoQ shutdown failed")),
        None => Ok(()),
    };
    trigger.start();
    running.await.context("relay task")??;
    result?;
    upstream_shutdown
}

#[cfg(test)]
mod startup_tests {
    #[test]
    fn v18_spotify_tls_provider_is_selected_before_request() {
        super::initialize_crypto();
        // Both ring (librespot) and aws-lc-rs (MoQ) are compiled in. Spotify's
        // HTTPS connector needs the process default, without a network request.
        let _ = moq_tokio::rustls::ClientConfig::builder();
    }
}
