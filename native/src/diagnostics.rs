// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
use serde_json::{Value, json};

pub fn emit(mut event: Value) {
    event["event"] = json!("diagnostic");
    // Explicit numeric/state fields only: never connection URLs or raw errors.
    println!("{event}");
}

#[derive(Default)]
pub struct PcmHealth {
    pub generation: u32,
    pub frames: u64,
    last: Option<u64>,
    reported: Option<u64>,
}
impl PcmHealth {
    pub fn reset(&mut self) {
        self.last = None;
        self.reported = None;
    }
    pub fn recent(&self, now: u64) -> bool {
        self.last.is_some_and(|last| now.saturating_sub(last) < 100)
    }
    pub fn tick(&mut self, now: u64) -> Option<Value> {
        let gap = now.saturating_sub(self.last?);
        if gap <= 100
            || self
                .reported
                .is_some_and(|last| now.saturating_sub(last) < 5000)
        {
            return None;
        }
        self.reported = Some(now);
        Some(
            json!({"stage":"server_helper", "eventType":"gap", "phase":"pcm_input", "generation":self.generation, "gapMs":gap.saturating_sub(20)}),
        )
    }
    pub fn progress(&mut self, now: u64, generation: u32) -> Vec<Value> {
        if generation != self.generation {
            self.reset();
            self.generation = generation;
        }
        let mut events = Vec::new();
        if let Some(event) = self.tick(now) {
            events.push(event);
        }
        if self.reported.is_some() {
            events.push(json!({"stage":"server_helper", "eventType":"recovered", "phase":"pcm_input", "generation":self.generation, "gapMs":now.saturating_sub(self.last.unwrap()).saturating_sub(20)}));
        }
        self.last = Some(now);
        self.reported = None;
        self.frames += 1;
        events
    }
}

#[derive(Default)]
pub struct UpstreamHealth {
    last: Option<moq_net::session::Stats>,
    last_epoch: u64,
    connected: bool,
    last_warning: Option<u64>,
    last_summary: Option<u64>,
    stale_frames: u64,
}
impl UpstreamHealth {
    pub fn sample(
        &mut self,
        now: u64,
        epoch: u64,
        stats: Option<moq_net::session::Stats>,
        traffic: &moq_net::stats::Traffic,
        pcm_frames: u64,
        pcm_recent: bool,
    ) -> Vec<Value> {
        let mut events = Vec::new();
        let connected = stats.is_some();
        if connected != self.connected || connected && epoch != self.last_epoch {
            events.push(json!({"stage":"helper_upstream", "eventType":if connected {"connected"} else {"disconnected"}, "epoch":epoch}));
            self.last = None;
            self.last_warning = None;
        }
        self.connected = connected;
        self.last_epoch = epoch;
        let stale_delta = traffic.stale.frames.saturating_sub(self.stale_frames);
        self.stale_frames = traffic.stale.frames;
        let lost = stats
            .and_then(|stats| stats.packets_lost)
            .unwrap_or(0)
            .saturating_sub(self.last.and_then(|stats| stats.packets_lost).unwrap_or(0));
        let event_type = if stale_delta > 0 {
            Some("stale_content")
        } else if lost > 0 {
            Some("packet_loss")
        } else if pcm_recent
            && stats
                .and_then(|stats| stats.rtt)
                .is_some_and(|rtt| rtt.as_millis() >= 250)
        {
            Some("high_rtt")
        } else {
            None
        };
        let warning = event_type.is_some()
            && self
                .last_warning
                .is_none_or(|last| now.saturating_sub(last) >= 5000);
        let summary = self
            .last_summary
            .is_none_or(|last| now.saturating_sub(last) >= 30000);
        if warning || summary {
            let mut event = json!({"stage":"helper_upstream", "eventType":if warning {event_type.unwrap()} else {"summary"},
                "phase":"transport", "connected":connected, "epoch":epoch, "pcmFrames":pcm_frames,
                "subscriptions":traffic.active_subscriptions(), "frames":traffic.frames,
                "staleFrames":traffic.stale.frames, "staleGroups":traffic.stale.groups, "staleBytes":traffic.stale.bytes});
            if let Some(stats) = stats {
                event["rttMs"] = json!(stats.rtt.map(|rtt| rtt.as_secs_f64() * 1000.0));
                event["bytesSent"] = json!(stats.bytes_sent);
                event["bytesReceived"] = json!(stats.bytes_received);
                event["bytesLost"] = json!(stats.bytes_lost);
                event["packetsSent"] = json!(stats.packets_sent);
                event["packetsLost"] = json!(stats.packets_lost);
            }
            events.push(event);
            if warning {
                self.last_warning = Some(now);
            }
            if summary {
                self.last_summary = Some(now);
            }
        }
        self.last = stats;
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn v36_pcm_gap_reported_before_recovery_boundaries_suppress_idle() {
        let mut health = PcmHealth::default();
        assert!(health.progress(0, 1).is_empty());
        assert!(health.tick(100).is_none());
        assert_eq!(health.tick(120).unwrap()["gapMs"], 100);
        assert!(health.tick(500).is_none());
        assert_eq!(health.progress(600, 1)[0]["eventType"], "recovered");
        health.reset();
        assert!(health.tick(90000).is_none());
        assert!(health.progress(90000, 2).is_empty());
        assert_eq!(health.progress(90300, 2).len(), 2);
        assert!(health.progress(99999, 3).is_empty());
    }
    #[test]
    fn v36_upstream_loss_stale_content_and_disconnect_are_distinct_and_bounded() {
        let mut health = UpstreamHealth::default();
        let mut traffic = moq_net::stats::Traffic::default();
        let mut stats = moq_net::session::Stats::default();
        stats.packets_lost = Some(0);
        stats.rtt = Some(std::time::Duration::from_millis(10));
        assert_eq!(
            health.sample(0, 1, Some(stats), &traffic, 0, false)[0]["eventType"],
            "connected"
        );
        stats.packets_lost = Some(3);
        assert_eq!(
            health.sample(1000, 1, Some(stats), &traffic, 50, true)[0]["eventType"],
            "packet_loss"
        );
        stats.packets_lost = Some(5);
        assert!(
            health
                .sample(2000, 1, Some(stats), &traffic, 100, true)
                .is_empty()
        );
        traffic.stale.frames = 4;
        assert_eq!(
            health.sample(6000, 1, Some(stats), &traffic, 300, true)[0]["eventType"],
            "stale_content"
        );
        assert_eq!(
            health.sample(7000, 1, None, &traffic, 350, true)[0]["eventType"],
            "disconnected"
        );
        assert_eq!(
            health.sample(8000, 2, Some(stats), &traffic, 400, true)[0]["eventType"],
            "connected"
        );
        stats.rtt = Some(std::time::Duration::from_millis(400));
        assert_eq!(
            health.sample(14000, 2, Some(stats), &traffic, 700, true)[0]["eventType"],
            "high_rtt"
        );
    }
}
