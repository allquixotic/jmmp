// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
//! Private framed PCM pipe, an Opus publisher, and an embedded WT/WS relay.
#![recursion_limit = "512"]
use anyhow::{Context, ensure};
use bytes::Bytes;
use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

#[derive(Deserialize)]
struct Config {
    relay: moq_relay::Config,
    bitrate: u64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
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
        .publish("jmmp.hang", Default::default())?;
    let mut catalog = moq_mux::catalog::Producer::new(
        &mut broadcast,
        moq_mux::catalog::Config::default().with_max_age(std::time::Duration::from_secs(10)),
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
    let trigger = relay.shutdown_trigger().clone();
    let mut running = tokio::spawn(relay.with_signals(false).run());
    ready.wait().await?;
    println!("{}", serde_json::json!({"event":"ready"}));
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
        result = &mut running => return result.context("relay task")?,
    };
    trigger.start();
    running.await.context("relay task")??;
    result
}
