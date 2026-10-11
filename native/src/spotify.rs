// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
//! Server-only Spotify source. Credentials arrive on stdin; stdout is a bounded pipe.
use anyhow::{Context, bail, ensure};
use librespot_audio::{AudioDecrypt, AudioFile};
use librespot_core::{
    FileId, Session, SpotifyId, SpotifyUri, authentication::Credentials, config::SessionConfig,
};
use librespot_metadata::{
    Album, Metadata, Playlist, Track,
    audio::{file::AudioFileFormat, item::AudioItem},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::{HashSet, VecDeque};
use std::future::Future;
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
    query: Option<String>,
    limit: Option<usize>,
}
#[derive(Deserialize)]
struct Range {
    start: u64,
    end: Option<u64>,
}
const HEADER: u64 = 0xa7;
const MAX_TRACKS: usize = 10_000;
const MAX_TRACK_LOOKUPS: usize = 32;

async fn resolve_audio_track<F, Fut>(
    uri: SpotifyUri,
    mut load: F,
) -> anyhow::Result<(SpotifyId, AudioFileFormat, FileId)>
where
    F: FnMut(SpotifyUri) -> Fut,
    Fut: Future<Output = anyhow::Result<AudioItem>>,
{
    let mut pending = VecDeque::from([uri]);
    let mut visited = HashSet::new();
    let mut lookup_error = None;
    while let Some(uri) = pending.pop_front() {
        if visited.len() >= MAX_TRACK_LOOKUPS {
            break;
        }
        if !matches!(uri, SpotifyUri::Track { .. }) || !visited.insert(uri.clone()) {
            continue;
        }
        let item = match load(uri).await {
            Ok(item) => item,
            Err(error) => {
                // Service/auth failures are not evidence that a song is unavailable.
                if !error
                    .downcast_ref::<librespot_core::Error>()
                    .is_some_and(|e| e.kind == librespot_core::error::ErrorKind::NotFound)
                {
                    lookup_error = Some(error);
                }
                continue;
            }
        };
        if item.availability.is_ok()
            && let SpotifyUri::Track { id } = item.track_id
        {
            for format in [
                AudioFileFormat::OGG_VORBIS_320,
                AudioFileFormat::OGG_VORBIS_160,
                AudioFileFormat::OGG_VORBIS_96,
            ] {
                if let Some(file) = item.files.get(&format) {
                    return Ok((id, format, *file));
                }
            }
        }
        if let Some(alternatives) = item.alternatives {
            pending.extend(alternatives.0.into_iter().take(MAX_TRACK_LOOKUPS));
        }
    }
    if let Some(error) = lookup_error {
        return Err(error.context("Spotify track lookup failed"));
    }
    if pending.iter().any(|uri| !visited.contains(uri)) {
        bail!("Spotify track lookup failed");
    }
    bail!("Spotify track has no available Vorbis audio")
}

fn search_query(query: &str) -> String {
    let mut encoded = String::new();
    for byte in query.bytes() {
        match byte {
            b' ' => encoded.push('+'),
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char)
            }
            _ => {
                use std::fmt::Write;
                let _ = write!(encoded, "%{byte:02X}");
            }
        }
    }
    encoded
}
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
    let mut audio_started = false;
    let result = execute(request, &mut audio_started).await;
    if !audio_started && let Err(error) = &result {
        // Never send raw upstream errors, URLs or account credentials to Bun.
        // Before an audio header, stream failures use the same bounded protocol
        // as metadata. Once binary audio starts, failures use only the exit code.
        let _ = emit(&json!({"kind":"error","code":error_code(error)}));
    }
    result
}

fn error_code(error: &anyhow::Error) -> &'static str {
    for cause in error.chain() {
        match cause.to_string().as_str() {
            "Spotify login timed out" | "Spotify login failed; reconnect this source" => {
                return "login";
            }
            "Spotify playlist unavailable" => return "playlist",
            "Spotify returned an incomplete playlist" => return "incomplete",
            "Collection contains an unsupported Spotify item" => return "item",
            "Spotify import exceeds 10000 tracks" => return "limit",
            "Spotify track unavailable" | "Spotify track has no available Vorbis audio" => {
                return "unavailable";
            }
            "Spotify audio key request failed" => return "audio_key",
            "Spotify audio download failed" => return "download",
            "Spotify track lookup timed out" => return "timeout",
            "Spotify track lookup failed" => return "lookup",
            "Spotify search failed" => return "search",
            _ => {}
        }
    }
    "unknown"
}

fn importable_tracks(tracks: Vec<SpotifyUri>) -> (Vec<SpotifyUri>, usize) {
    let count = tracks.len();
    let supported: Vec<_> = tracks
        .into_iter()
        .filter(|id| matches!(id, SpotifyUri::Track { .. }))
        .collect();
    let skipped = count - supported.len();
    (supported, skipped)
}

async fn execute(request: Request, audio_started: &mut bool) -> anyhow::Result<()> {
    ensure!(
        matches!(request.operation.as_str(), "metadata" | "stream" | "search"),
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
                    let playlist = Playlist::get(&session, &id)
                        .await
                        .context("Spotify playlist unavailable")?;
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
            // Spotify local files are references to somebody else's device;
            // the server cannot fetch their audio. Episodes are not music tracks.
            let (tracks, skipped) = importable_tracks(tracks);
            let mut ids = Vec::new();
            for track_id in tracks {
                let track = Track::get(&session, &track_id).await?;
                let value = track_value(&track)?;
                ids.push(value["sourceTrackId"].clone());
                emit(&json!({"kind":"track","track":value}))?;
            }
            if let Some(name) = name {
                emit(
                    &json!({"kind":"playlist","sourcePlaylistId":uri,"name":name,"tracks":ids,"skippedTracks":skipped}),
                )?;
            }
        }
    } else if request.operation == "search" {
        let query = request.query.as_deref().unwrap_or("").trim();
        let limit = request.limit.unwrap_or(50);
        ensure!(
            (2..=256).contains(&query.chars().count()) && (1..=50).contains(&limit),
            "Invalid Spotify search"
        );
        tokio::time::timeout(std::time::Duration::from_secs(20), async {
            let context = session
                .spclient()
                .get_context(&format!("spotify:search:{}", search_query(query)))
                .await?;
            let mut seen = HashSet::new();
            for entry in context.pages.iter().flat_map(|page| &page.tracks) {
                let Some(uri) = entry.uri.as_deref() else {
                    continue;
                };
                let Ok(id) = SpotifyUri::from_uri(uri) else {
                    continue;
                };
                if !matches!(id, SpotifyUri::Track { .. }) || !seen.insert(id.clone()) {
                    continue;
                }
                let track = Track::get(&session, &id).await?;
                emit(&json!({"kind":"track","track":track_value(&track)?}))?;
                if seen.len() >= limit {
                    break;
                }
            }
            Ok::<(), anyhow::Error>(())
        })
        .await
        .context("Spotify search failed")?
        .context("Spotify search failed")?;
    } else {
        let uri = SpotifyUri::from_uri(
            request
                .uri
                .as_deref()
                .context("Spotify track URI required")?,
        )?;
        ensure!(
            matches!(uri, SpotifyUri::Track { .. }),
            "Spotify track required"
        );
        let lookup_session = &session;
        let (id, format, file) = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            resolve_audio_track(uri, |uri| async move {
                AudioItem::get_file(lookup_session, uri)
                    .await
                    .map_err(Into::into)
            }),
        )
        .await
        .context("Spotify track lookup timed out")??;
        let rate = match format {
            AudioFileFormat::OGG_VORBIS_320 => 40_000,
            AudioFileFormat::OGG_VORBIS_160 => 20_000,
            _ => 12_000,
        };
        let key = session
            .audio_key()
            .request(id, file)
            .await
            .context("Spotify audio key request failed")?;
        let file = AudioFile::open(&session, file, rate)
            .await
            .context("Spotify audio download failed")?;
        let controller = file.get_stream_loader_controller()?;
        let size = (controller.len() as u64)
            .checked_sub(HEADER)
            .context("Invalid Spotify audio size")?;
        let (start, end, status) = byte_range(size, request.range)?;
        *audio_started = true;
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
    use librespot_core::FileId;
    use librespot_metadata::{
        audio::{
            file::AudioFiles,
            item::{AudioItem, UniqueFields},
        },
        availability::UnavailabilityReason,
        track::Tracks,
    };
    fn audio_item(
        uri: SpotifyUri,
        files: Vec<(AudioFileFormat, FileId)>,
        alternatives: Vec<SpotifyUri>,
        available: bool,
    ) -> AudioItem {
        AudioItem {
            uri: uri.to_uri().unwrap(),
            track_id: uri,
            files: AudioFiles(files.into_iter().collect()),
            name: "Fixture".into(),
            covers: vec![],
            language: vec![],
            duration_ms: 1000,
            is_explicit: false,
            availability: if available {
                Ok(())
            } else {
                Err(UnavailabilityReason::NotWhitelisted)
            },
            alternatives: Some(Tracks(alternatives)),
            unique_fields: UniqueFields::Track {
                artists: Default::default(),
                album: String::new(),
                album_artists: vec![],
                popularity: 0,
                number: 1,
                disc_number: 1,
            },
        }
    }
    #[tokio::test]
    async fn v27_relinked_track_selects_available_alternate_and_its_key_id() {
        let original = SpotifyUri::from_uri("spotify:track:4WFeJTXNHIS2wURtwlAkhu").unwrap();
        let blocked = SpotifyUri::from_uri("spotify:track:5sWHDYs0csV6RS48xBl0tH").unwrap();
        let alternate = SpotifyUri::from_uri("spotify:track:6sWHDYs0csV6RS48xBl0tH").unwrap();
        let low = FileId([1; 20]);
        let high = FileId([2; 20]);
        let items = std::collections::HashMap::from([
            (
                original.clone(),
                audio_item(
                    original.clone(),
                    vec![],
                    vec![
                        original.clone(),
                        blocked.clone(),
                        alternate.clone(),
                        alternate.clone(),
                    ],
                    true,
                ),
            ),
            (
                blocked.clone(),
                audio_item(
                    blocked,
                    vec![(AudioFileFormat::OGG_VORBIS_320, high)],
                    vec![],
                    false,
                ),
            ),
            (
                alternate.clone(),
                audio_item(
                    alternate.clone(),
                    vec![
                        (AudioFileFormat::OGG_VORBIS_96, low),
                        (AudioFileFormat::OGG_VORBIS_320, high),
                    ],
                    vec![],
                    true,
                ),
            ),
        ]);
        let mut looked_up = vec![];
        let (id, format, file) = resolve_audio_track(original, |uri| {
            looked_up.push(uri.clone());
            std::future::ready(Ok(items.get(&uri).unwrap().clone()))
        })
        .await
        .unwrap();
        let SpotifyUri::Track { id: expected } = alternate else {
            unreachable!()
        };
        assert_eq!(id, expected);
        assert_eq!(format, AudioFileFormat::OGG_VORBIS_320);
        assert_eq!(file, high);
        assert_eq!(looked_up.len(), 3);
    }
    #[tokio::test]
    async fn v27_unplayable_alternate_cycles_terminate_without_duplicate_lookups() {
        let a = SpotifyUri::from_uri("spotify:track:4WFeJTXNHIS2wURtwlAkhu").unwrap();
        let b = SpotifyUri::from_uri("spotify:track:5sWHDYs0csV6RS48xBl0tH").unwrap();
        let mut looked_up = vec![];
        let result = resolve_audio_track(a.clone(), |uri| {
            looked_up.push(uri.clone());
            std::future::ready(Ok(audio_item(
                uri.clone(),
                vec![],
                if uri == a {
                    vec![b.clone(), b.clone()]
                } else {
                    vec![a.clone()]
                },
                true,
            )))
        })
        .await;
        assert!(result.is_err());
        assert_eq!(looked_up, vec![a, b]);
        assert_eq!(error_code(&result.unwrap_err()), "unavailable");
    }
    #[tokio::test]
    async fn v27_alternate_lookup_count_is_bounded() {
        let uris: Vec<_> = (1..=50)
            .map(|id| SpotifyUri::from_uri(&format!("spotify:track:{id:022}")).unwrap())
            .collect();
        let mut lookups = 0;
        let result = resolve_audio_track(uris[0].clone(), |uri| {
            lookups += 1;
            std::future::ready(Ok(audio_item(uri, vec![], uris.clone(), true)))
        })
        .await;
        assert!(result.is_err());
        assert_eq!(lookups, MAX_TRACK_LOOKUPS);
    }
    #[tokio::test]
    async fn v28_transient_metadata_failure_is_not_track_unavailability() {
        let uri = SpotifyUri::from_uri("spotify:track:4WFeJTXNHIS2wURtwlAkhu").unwrap();
        let result = resolve_audio_track(uri, |_| {
            std::future::ready(Err(
                librespot_core::Error::unavailable("service offline").into()
            ))
        })
        .await
        .unwrap_err();
        assert_eq!(error_code(&result), "lookup");
    }
    #[test]
    fn v27_stream_failures_have_fixed_safe_error_codes() {
        assert_eq!(
            error_code(&anyhow::anyhow!(
                "Spotify track has no available Vorbis audio"
            )),
            "unavailable"
        );
        assert_eq!(
            error_code(&anyhow::anyhow!("private-key").context("Spotify audio key request failed")),
            "audio_key"
        );
        assert_eq!(
            error_code(&anyhow::anyhow!("private URL").context("Spotify audio download failed")),
            "download"
        );
    }
    #[test]
    fn v29_search_query_encodes_unicode_and_reserved_characters() {
        assert_eq!(search_query("Björk & AC/DC"), "Bj%C3%B6rk+%26+AC%2FDC");
        assert_eq!(
            error_code(&anyhow::anyhow!("private URL").context("Spotify search failed")),
            "search"
        );
    }
    #[test]
    fn v20_mixed_playlist_preserves_music_order_and_reports_skipped_items() {
        let a = SpotifyUri::from_uri("spotify:track:5sWHDYs0csV6RS48xBl0tH").unwrap();
        let b = SpotifyUri::from_uri("spotify:track:6sWHDYs0csV6RS48xBl0tH").unwrap();
        let local = SpotifyUri::from_uri("spotify:local:Artist:Album:Song:123").unwrap();
        let episode = SpotifyUri::from_uri("spotify:episode:5sWHDYs0csV6RS48xBl0tH").unwrap();
        let (music, skipped) =
            importable_tracks(vec![a.clone(), local, b.clone(), episode, a.clone()]);
        assert_eq!(music, vec![a.clone(), b, a]);
        assert_eq!(skipped, 2);
    }
    #[test]
    fn v19_errors_expose_only_fixed_codes() {
        let secret = anyhow::anyhow!("private-refresh https://secret.example/?token=secret");
        assert_eq!(error_code(&secret), "unknown");
        assert_eq!(
            error_code(&secret.context("Spotify playlist unavailable")),
            "playlist"
        );
        assert_eq!(
            error_code(&anyhow::anyhow!("Spotify login timed out")),
            "login"
        );
    }
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
