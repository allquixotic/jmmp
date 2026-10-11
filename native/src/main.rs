// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
//! Private framed PCM pipe, an Opus publisher, and an embedded WT/WS relay.
#![recursion_limit = "512"]
use anyhow::{Context, ensure};
use bytes::Bytes;
use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
mod spotify;

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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
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
    let upstream = if let Some(upstream) = config.upstream {
        let mut connect = moq_tokio::connect::Config::default();
        connect.url = Some(
            upstream
                .url
                .parse()
                .map_err(|_| anyhow::anyhow!("Invalid upstream URL"))?,
        );
        connect.version = vec![
            upstream
                .protocol
                .parse()
                .map_err(|_| anyhow::anyhow!("Invalid upstream protocol"))?,
        ];
        let client = connect.init(Default::default())?;
        let connection = client
            .publish(relay_origin)
            .context("Missing upstream URL")?;
        Some(
            tokio::time::timeout(std::time::Duration::from_secs(20), connection.established())
                .await
                .map_err(|_| anyhow::anyhow!("Upstream MoQ connection timed out"))?
                .map_err(|_| anyhow::anyhow!("Upstream MoQ connection failed"))?,
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
    let read = async {
        loop {
            // 24 bytes: type, generation, byte length, reserved, timestamp µs (LE).
            let mut header = [0u8; 24];
            match input.read_exact(&mut header).await {
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
                Err(e) => return Err(e.into()),
            }
            let kind = u32::from_le_bytes(header[0..4].try_into()?);
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
                    ensure!(len > 0, "empty PCM frame");
                    ensure!(
                        data.chunks_exact(4)
                            .all(|v| f32::from_le_bytes(v.try_into().unwrap()).is_finite()),
                        "non-finite PCM"
                    );
                    audio.write(&moq_audio::Frame::new(
                        Bytes::from(data),
                        moq_net::Timestamp::from_micros(clock.elapsed().as_micros() as u64)?,
                    ))?;
                }
                1 => {
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
        result = read => result,
        result = refresh => result,
        result = &mut running => return result.context("relay task")?,
        _ = async {
            match &upstream {
                Some(connection) => { let _ = connection.closed().await; }
                None => std::future::pending::<()>().await,
            }
        } => Err(anyhow::anyhow!("Upstream MoQ connection stopped")),
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
