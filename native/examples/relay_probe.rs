// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
//! Pipe a subscriber relay URL on stdin. Reads catalog and five media packets over WT.
use anyhow::Context;
use std::io::BufRead;
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    moq_tokio::Log::default().init()?;
    let stdin = std::io::stdin();
    let mut lines = stdin.lock().lines();
    let url = lines.next().context("Subscriber URL required")??;
    let name = lines
        .next()
        .context("Broadcast name required on second line")??;
    let result = tokio::time::timeout(std::time::Duration::from_secs(20), async {
        let origin = moq_tokio::origin::spawn();
        let consumer = origin.consume();
        let mut config = moq_tokio::connect::Config::default();
        config.url = Some(url.parse()?);
        config.version = vec![
            "moq-transport-16"
                .parse()
                .map_err(|_| anyhow::anyhow!("Invalid protocol"))?,
        ];
        let connection = config
            .init(Default::default())?
            .consume(origin)
            .context("Missing relay")?
            .established()
            .await?;
        eprintln!("Relay connected");
        let broadcast = consumer.routed_broadcast(name).await?;
        eprintln!("Broadcast resolved");
        let mut catalog = broadcast
            .track("catalog.json")?
            .subscribe(None)
            .await?
            .ordered();
        let mut group = catalog.next_group().await?.context("No catalog")?;
        let frame = group.read_frame().await?.context("No catalog frame")?;
        let catalog: serde_json::Value = serde_json::from_slice(&frame.payload)?;
        if std::env::args().any(|arg| arg == "--catalog") {
            return Ok::<_, anyhow::Error>(
                serde_json::json!({"transport":"webtransport","catalog":catalog,"frames":[]}),
            );
        }
        let mut audio = broadcast
            .track("audio.opus")?
            .subscribe(None)
            .await?
            .ordered();
        let mut frames = Vec::new();
        while frames.len() < 5 {
            let mut group = audio.next_group().await?.context("No audio group")?;
            while let Some(frame) = group.read_frame().await? {
                let mut payload = frame.payload.clone();
                moq_net::VarInt::decode_quic(&mut payload)?;
                if !payload.is_empty() {
                    frames.push(frame.payload.to_vec());
                }
                if frames.len() == 5 {
                    break;
                }
            }
        }
        drop(connection);
        Ok::<_, anyhow::Error>(
            serde_json::json!({"transport":"webtransport","catalog":catalog,"frames":frames}),
        )
    })
    .await
    .context("Relay probe timed out")??;
    println!("{}", result);
    Ok(())
}
