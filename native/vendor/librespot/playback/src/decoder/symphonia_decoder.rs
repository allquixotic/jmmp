use std::{io, time::Duration};

use symphonia::core::{
    codecs::audio::{AudioDecoder as SymphoniaAudioDecoder, AudioDecoderOptions},
    errors::Error,
    formats::{FormatOptions, FormatReader, SeekMode, SeekTo, TrackType, probe::Hint},
    io::{MediaSource, MediaSourceStream, MediaSourceStreamOptions},
    meta::{MetadataOptions, StandardTag},
    units::{TimeBase, Timestamp},
};

use super::{AudioDecoder, AudioPacket, AudioPacketPosition, DecoderError, DecoderResult};

use crate::{NUM_CHANNELS, PAGES_PER_MS, SAMPLE_RATE, player::NormalisationData, symphonia_util};

pub struct SymphoniaDecoder {
    probe_result: Box<dyn FormatReader>,
    decoder: Box<dyn SymphoniaAudioDecoder>,
    track_id: u32,
    time_base: Option<TimeBase>,
    duration: Option<Duration>,
    sample_buffer: Vec<f64>,
}

#[derive(Default)]
pub(crate) struct LocalFileMetadata {
    pub name: Option<String>,
    pub language: Option<String>,
    pub album: Option<String>,
    pub artists: Option<String>,
    pub album_artists: Option<String>,
    pub number: Option<u32>,
    pub disc_number: Option<u32>,
}

impl SymphoniaDecoder {
    pub fn new<R>(input: R, hint: Hint) -> DecoderResult<Self>
    where
        R: MediaSource + 'static,
    {
        let mss_opts = MediaSourceStreamOptions {
            buffer_len: librespot_audio::AudioFetchParams::get().minimum_download_size,
        };
        let mss = MediaSourceStream::new(Box::new(input), mss_opts);

        let format_opts = FormatOptions::default();
        let metadata_opts: MetadataOptions = Default::default();

        let probe_result =
            symphonia::default::get_probe().probe(&hint, mss, format_opts, metadata_opts)?;

        let format = &probe_result;

        let track = format.default_track(TrackType::Audio).ok_or_else(|| {
            DecoderError::SymphoniaDecoder("Could not retrieve default track".into())
        })?;

        let decoder_opts: AudioDecoderOptions = Default::default();

        let decoder = symphonia::default::get_codecs().make_audio_decoder(
            track
                .codec_params
                .as_ref()
                .and_then(|p| p.audio())
                .ok_or_else(|| {
                    DecoderError::SymphoniaDecoder("Missing audio codec parameters".into())
                })?,
            &decoder_opts,
        )?;

        let rate = decoder.codec_params().sample_rate.ok_or_else(|| {
            DecoderError::SymphoniaDecoder("Could not retrieve sample rate".into())
        })?;

        // TODO: The official client supports local files with sample rates other than 44,100 kHz.
        // To play these accurately, we need to either resample the input audio, or introduce a way
        // to change the player's current sample rate (likely by closing and re-opening the sink
        // with new parameters).
        if rate != SAMPLE_RATE {
            return Err(DecoderError::SymphoniaDecoder(format!(
                "Unsupported sample rate: {rate}"
            )));
        }

        let channels = decoder.codec_params().channels.as_ref().ok_or_else(|| {
            DecoderError::SymphoniaDecoder("Could not retrieve channel configuration".into())
        })?;
        if channels.count() != NUM_CHANNELS as usize {
            return Err(DecoderError::SymphoniaDecoder(format!(
                "Unsupported number of channels: {channels}"
            )));
        }

        let track_id = track.id;
        let time_base = track.time_base;
        let duration = track
            .time_base
            .zip(track.duration)
            .and_then(|(tb, d)| tb.calc_duration(d))
            .map(|t| Duration::from_secs_f64(t.as_secs_f64().max(0.0)));
        Ok(Self {
            probe_result,
            track_id,
            time_base,
            duration,
            decoder,
            // We set the sample buffer when decoding the first full packet,
            // whose duration is also the ideal sample buffer size.
            sample_buffer: Vec::new(),
        })
    }

    pub fn normalisation_data(&mut self) -> Option<NormalisationData> {
        let metadata = symphonia_util::get_latest_metadata(&mut self.probe_result)?;
        let tags = &metadata.current()?.media.tags;
        let mut data = NormalisationData::default();
        let mut found = false;
        for tag in tags {
            let target = match &tag.std {
                Some(StandardTag::ReplayGainAlbumGain(v)) => Some((v, &mut data.album_gain_db)),
                Some(StandardTag::ReplayGainAlbumPeak(v)) => Some((v, &mut data.album_peak)),
                Some(StandardTag::ReplayGainTrackGain(v)) => Some((v, &mut data.track_gain_db)),
                Some(StandardTag::ReplayGainTrackPeak(v)) => Some((v, &mut data.track_peak)),
                _ => None,
            };
            if let Some((value, target)) = target {
                if let Some(number) = value
                    .split_whitespace()
                    .next()
                    .and_then(|v| v.parse::<f64>().ok())
                {
                    *target = number;
                    found = true;
                }
            }
        }
        found.then_some(data)
    }

    pub(crate) fn local_file_metadata(&mut self) -> Option<LocalFileMetadata> {
        let metadata = symphonia_util::get_latest_metadata(&mut self.probe_result)?;
        let mut result = LocalFileMetadata::default();
        for tag in &metadata.current()?.media.tags {
            match &tag.std {
                Some(StandardTag::TrackTitle(v)) => result.name = Some(v.to_string()),
                Some(StandardTag::Language(v)) => result.language = Some(v.to_string()),
                Some(StandardTag::Artist(v)) => result.artists = Some(v.to_string()),
                Some(StandardTag::AlbumArtist(v)) => result.album_artists = Some(v.to_string()),
                Some(StandardTag::Album(v)) => result.album = Some(v.to_string()),
                Some(StandardTag::TrackNumber(v)) => result.number = u32::try_from(*v).ok(),
                Some(StandardTag::DiscNumber(v)) => result.disc_number = u32::try_from(*v).ok(),
                _ => (),
            }
        }
        Some(result)
    }

    #[inline]
    fn ts_to_ms(&self, ts: Timestamp) -> u32 {
        match self.time_base {
            Some(time_base) => {
                let time = Duration::from_secs_f64(
                    time_base.calc_time_saturating(ts).as_secs_f64().max(0.0),
                );
                time.as_millis() as u32
            }
            // Fallback in the unexpected case that the format has no base time set.
            None => (ts.get().max(0) as f64 * PAGES_PER_MS) as u32,
        }
    }
}

impl AudioDecoder for SymphoniaDecoder {
    fn seek(&mut self, position_ms: u32) -> Result<u32, DecoderError> {
        // "Saturate" the position_ms to the duration of the track if it exceeds it.
        let mut target = Duration::from_millis(position_ms.into());
        if let Some(duration) = self.duration {
            if target > duration {
                target = duration;
            }
        }

        // `track_id: None` implies the default track ID (of the container, not of Spotify).
        let seeked_to_ts = self.probe_result.seek(
            SeekMode::Accurate,
            SeekTo::Time {
                time: symphonia::core::units::Time::from_millis_u64(target.as_millis() as u64),
                track_id: None,
            },
        )?;

        // Seeking is a `FormatReader` operation, so the decoder cannot reliably
        // know when a seek took place. Reset it to avoid audio glitches.
        self.decoder.reset();

        Ok(self.ts_to_ms(seeked_to_ts.actual_ts))
    }

    fn next_packet(&mut self) -> DecoderResult<Option<(AudioPacketPosition, AudioPacket)>> {
        let mut skipped = false;

        loop {
            let packet = match self.probe_result.next_packet() {
                Ok(Some(packet)) => packet,
                Ok(None) => return Ok(None),
                Err(Error::IoError(err)) => {
                    if err.kind() == io::ErrorKind::UnexpectedEof {
                        return Ok(None);
                    } else {
                        return Err(DecoderError::SymphoniaDecoder(err.to_string()));
                    }
                }
                Err(err) => {
                    return Err(err.into());
                }
            };

            if packet.track_id != self.track_id {
                continue;
            }
            let position_ms = self.ts_to_ms(packet.pts);
            let packet_position = AudioPacketPosition {
                position_ms,
                skipped,
            };

            match self.decoder.decode(&packet) {
                Ok(decoded) => {
                    self.sample_buffer
                        .resize(decoded.samples_interleaved(), 0.0);
                    decoded.copy_to_slice_interleaved(&mut self.sample_buffer);
                    let samples = AudioPacket::Samples(self.sample_buffer.clone());

                    return Ok(Some((packet_position, samples)));
                }
                Err(Error::DecodeError(_)) => {
                    // The packet failed to decode due to corrupted or invalid data, get a new
                    // packet and try again.
                    warn!("Skipping malformed audio packet at {position_ms} ms");
                    skipped = true;
                    continue;
                }
                Err(err) => return Err(err.into()),
            }
        }
    }
}
