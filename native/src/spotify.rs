// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
//! Server-only Spotify source. Credentials arrive on stdin; stdout is a bounded pipe.
use anyhow::{Context, bail, ensure};
use librespot_audio::{AudioDecrypt, AudioFile};
use librespot_core::{Session, SpotifyUri, authentication::Credentials, config::SessionConfig};
use librespot_metadata::{Album, Metadata, Playlist, Track, audio::file::AudioFileFormat};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    operation: String,
    client_id: String,
    access_token: String,
    #[serde(default)]
    uris: Vec<String>,
    uri: Option<String>,
    range: Option<Range>,
}
#[derive(Deserialize)]
struct Range {
    start: u64,
    end: Option<u64>,
}
const HEADER: u64 = 0xa7;
const MAX_TRACKS: usize = 10_000;

fn emit(value: &Value) -> anyhow::Result<()> {
    let mut stdout = std::io::stdout().lock();
    serde_json::to_writer(&mut stdout, value)?;
    stdout.write_all(b"\n")?;
    stdout.flush()?;
    Ok(())
}
fn track_value(track: &Track) -> anyhow::Result<Value> {
    Ok(
        json!({"sourceTrackId":track.id.to_uri()?, "title":track.name,
        "artist":track.artists.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", "),
        "album":track.album.name,"trackNo":track.number,"discNo":track.disc_number,
        "durationMs":track.duration.max(0),"codec":"vorbis","sampleRate":44100,"channels":2}),
    )
}
fn byte_range(size: u64, range: Option<Range>) -> anyhow::Result<(u64, u64, u16)> {
    ensure!(size > 0, "Empty Spotify audio file");
    let Some(range) = range else {
        return Ok((0, size - 1, 200));
    };
    let end = range.end.unwrap_or(size - 1).min(size - 1);
    ensure!(
        range.start < size && range.start <= end,
        "Unsatisfiable Spotify byte range"
    );
    Ok((range.start, end, 206))
}
pub async fn run() -> anyhow::Result<()> {
    let mut input = BufReader::new(std::io::stdin());
    let mut line = String::new();
    (&mut input).take(64 * 1024).read_line(&mut line)?;
    let request: Request = serde_json::from_str(&line).context("Invalid Spotify request")?;
    // Bun workers can be terminated during login/download. A parent heartbeat
    // bounds the child lifetime even when no audio has reached stdout yet.
    let (heartbeat, received) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut byte = [0];
        while input.read_exact(&mut byte).is_ok() && byte[0] == b'\n' {
            if heartbeat.send(()).is_err() {
                return;
            }
        }
    });
    std::thread::spawn(move || {
        loop {
            if received
                .recv_timeout(std::time::Duration::from_secs(10))
                .is_err()
            {
                std::process::exit(1);
            }
        }
    });
    ensure!(
        matches!(request.operation.as_str(), "metadata" | "stream"),
        "Invalid Spotify operation"
    );
    ensure!(
        request.client_id.len() == 32 && request.client_id.bytes().all(|b| b.is_ascii_hexdigit()),
        "Invalid Spotify client ID"
    );
    let session = Session::new(
        SessionConfig {
            client_id: request.client_id,
            ..Default::default()
        },
        None,
    );
    tokio::time::timeout(
        std::time::Duration::from_secs(60),
        session.connect(Credentials::with_access_token(request.access_token), false),
    )
    .await
    .context("Spotify login timed out")?
    .map_err(|_| anyhow::anyhow!("Spotify login failed; reconnect this source"))?;
    if request.operation == "metadata" {
        ensure!(request.uris.len() <= 100, "Too many Spotify collections");
        let mut count = 0;
        for uri in request.uris {
            let id = SpotifyUri::from_uri(&uri)?;
            let (name, tracks) = match &id {
                SpotifyUri::Track { .. } => (None, vec![id.clone()]),
                SpotifyUri::Album { .. } => {
                    let album = Album::get(&session, &id).await?;
                    (Some(album.name.clone()), album.tracks().cloned().collect())
                }
                SpotifyUri::Playlist { .. } => {
                    let playlist = Playlist::get(&session, &id).await?;
                    ensure!(
                        playlist.tracks().len() == playlist.length.max(0) as usize,
                        "Spotify returned an incomplete playlist"
                    );
                    (
                        Some(playlist.name().to_owned()),
                        playlist.tracks().cloned().collect(),
                    )
                }
                _ => bail!("Only Spotify tracks, albums and playlists are supported"),
            };
            count += tracks.len();
            ensure!(count <= MAX_TRACKS, "Spotify import exceeds 10000 tracks");
            let mut ids = Vec::new();
            for track_id in tracks {
                ensure!(
                    matches!(track_id, SpotifyUri::Track { .. }),
                    "Collection contains an unsupported Spotify item"
                );
                let track = Track::get(&session, &track_id).await?;
                let value = track_value(&track)?;
                ids.push(value["sourceTrackId"].clone());
                emit(&json!({"kind":"track","track":value}))?;
            }
            if let Some(name) = name {
                emit(&json!({"kind":"playlist","sourcePlaylistId":uri,"name":name,"tracks":ids}))?;
            }
        }
    } else {
        let uri = SpotifyUri::from_uri(
            request
                .uri
                .as_deref()
                .context("Spotify track URI required")?,
        )?;
        let SpotifyUri::Track { id } = uri else {
            bail!("Spotify track required");
        };
        let track = Track::get(&session, &uri).await?;
        let (format, file) = [
            AudioFileFormat::OGG_VORBIS_320,
            AudioFileFormat::OGG_VORBIS_160,
            AudioFileFormat::OGG_VORBIS_96,
        ]
        .into_iter()
        .find_map(|format| track.files.get(&format).map(|file| (format, *file)))
        .context("Spotify track has no available Vorbis audio")?;
        let rate = match format {
            AudioFileFormat::OGG_VORBIS_320 => 40_000,
            AudioFileFormat::OGG_VORBIS_160 => 20_000,
            _ => 12_000,
        };
        let key = session.audio_key().request(id, file).await?;
        let file = AudioFile::open(&session, file, rate).await?;
        let controller = file.get_stream_loader_controller()?;
        let size = (controller.len() as u64)
            .checked_sub(HEADER)
            .context("Invalid Spotify audio size")?;
        let (start, end, status) = byte_range(size, request.range)?;
        let result = tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
            let mut audio = AudioDecrypt::new(Some(key), file);
            audio.seek(SeekFrom::Start(HEADER + start))?;
            emit(&json!({"size":size,"start":start,"end":end,"status":status}))?;
            let copied = std::io::copy(
                &mut audio.take(end - start + 1),
                &mut std::io::stdout().lock(),
            )?;
            controller.close();
            ensure!(
                copied == end - start + 1,
                "Spotify audio download truncated"
            );
            Ok(())
        })
        .await?;
        result?;
    }
    session.shutdown();
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranges() {
        assert_eq!(byte_range(100, None).unwrap(), (0, 99, 200));
        assert_eq!(
            byte_range(
                100,
                Some(Range {
                    start: 20,
                    end: Some(200)
                })
            )
            .unwrap(),
            (20, 99, 206)
        );
        assert!(
            byte_range(
                100,
                Some(Range {
                    start: 100,
                    end: None
                })
            )
            .is_err()
        );
        assert!(
            byte_range(
                100,
                Some(Range {
                    start: 50,
                    end: Some(20)
                })
            )
            .is_err()
        );
    }
}
