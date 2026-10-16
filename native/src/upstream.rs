// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
use anyhow::Context;
use std::time::Duration;

pub fn config(url: &str, protocol: &str) -> anyhow::Result<moq_tokio::connect::Config> {
    let mut connect = moq_tokio::connect::Config::default();
    connect.url = Some(
        url.parse()
            .map_err(|_| anyhow::anyhow!("Invalid upstream URL"))?,
    );
    connect.version = vec![
        protocol
            .parse()
            .map_err(|_| anyhow::anyhow!("Invalid upstream protocol"))?,
    ];
    // This is a process-lifetime publisher, not a short-lived connection test.
    // Zero removes the ten-second give-up window; retry delays stay capped/jittered.
    connect.backoff.timeout = Duration::ZERO;
    Ok(connect)
}

pub fn stopped(result: moq_tokio::Result<()>) -> anyhow::Error {
    result
        .context("Upstream MoQ connection stopped")
        .err()
        .unwrap_or_else(|| anyhow::anyhow!("Upstream MoQ connection stopped without a reason"))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn server(
        port: u16,
    ) -> (
        u16,
        moq_net::origin::Consumer,
        tokio::sync::mpsc::UnboundedReceiver<moq_net::Session>,
        tokio::task::JoinHandle<()>,
    ) {
        let mut config = moq_tokio::listen::Config::default();
        config.bind = Some(format!("127.0.0.1:{port}").parse().unwrap());
        config.tls.generate = vec!["localhost".into()];
        let mut listener = config
            .init(Default::default())
            .unwrap()
            .listen()
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        let origin = moq_tokio::origin::spawn();
        let consumer = origin.consume();
        let (send, recv) = tokio::sync::mpsc::unbounded_channel();
        let task = tokio::spawn(async move {
            while let Some(request) = listener.accept().await {
                if let Ok(session) = request.with_subscriber(origin.clone()).ok().await {
                    if send.send(session).is_err() {
                        break;
                    }
                }
            }
        });
        (port, consumer, recv, task)
    }

    #[tokio::test]
    async fn v46_publisher_recovers_after_outage_longer_than_default_retry_budget() {
        crate::initialize_crypto();
        let (port, _, mut sessions, task) = server(0).await;
        let source = moq_tokio::origin::spawn();
        let broadcast = source.create_broadcast("recovery").unwrap();
        broadcast.announce(Default::default()).unwrap();
        let track = broadcast.create_track("audio", None).unwrap();
        let mut config = config(&format!("https://127.0.0.1:{port}"), "moq-transport-16").unwrap();
        config.tls.insecure = Some(true);
        // Keep retries quick; retain the production retry budget.
        config.backoff.initial = Duration::from_millis(100);
        config.backoff.max = Duration::from_millis(250);
        let connection = tokio::time::timeout(
            Duration::from_secs(5),
            config
                .init(Default::default())
                .unwrap()
                .publish(source.consume())
                .unwrap()
                .established(),
        )
        .await
        .unwrap()
        .unwrap();
        let session = sessions.recv().await.unwrap();
        tokio::time::sleep(Duration::from_millis(150)).await;
        task.abort();
        let _ = task.await;
        drop(session);
        drop(sessions);
        // Wait for the actual transport disconnect before starting the outage window.
        tokio::time::timeout(Duration::from_secs(5), async {
            while connection.monitor().stats().is_some() {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        assert!(
            tokio::time::timeout(Duration::from_secs(12), connection.closed())
                .await
                .is_err(),
            "publisher permanently stopped during a temporary outage"
        );
        let (_, received, mut sessions, task) = server(port).await;
        tokio::time::timeout(Duration::from_secs(10), async {
            while connection.epoch() < 2 {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("publisher failed to reconnect");
        let session = sessions.recv().await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            let broadcast = received.routed_broadcast("recovery").await.unwrap();
            let mut reader = broadcast
                .track("audio")
                .unwrap()
                .subscribe(None)
                .await
                .unwrap()
                .ordered();
            let mut group = track.append_group().unwrap();
            group
                .write_frame(moq_net::Timestamp::ZERO, b"after outage".as_ref())
                .unwrap();
            group.finish().unwrap();
            let mut group = reader.next_group().await.unwrap().unwrap();
            assert_eq!(
                &group.read_frame().await.unwrap().unwrap().payload[..],
                b"after outage"
            );
        })
        .await
        .expect("reconnected publication did not deliver media");
        drop(connection);
        drop(session);
        drop(sessions);
        task.abort();
        let _ = task.await;
    }

    #[tokio::test]
    async fn v46_authentication_rejection_remains_terminal() {
        crate::initialize_crypto();
        let (port, _, mut sessions, task) = server(0).await;
        let mut config = config(&format!("https://127.0.0.1:{port}"), "moq-transport-16").unwrap();
        config.tls.insecure = Some(true);
        let url = config.url.clone().unwrap();
        let connection = tokio::time::timeout(
            Duration::from_secs(5),
            config
                .init(Default::default())
                .unwrap()
                .connect(url)
                .established(),
        )
        .await
        .unwrap()
        .unwrap();
        let session = sessions.recv().await.unwrap();
        session.abort(moq_net::Error::Unauthorized);
        let error = tokio::time::timeout(Duration::from_secs(5), connection.closed())
            .await
            .expect("authentication failure retried forever")
            .unwrap_err();
        assert!(error.is_auth(), "lost authentication failure: {error}");
        assert!(
            sessions.try_recv().is_err(),
            "authentication failure redialed"
        );
        drop(connection);
        drop(session);
        drop(sessions);
        task.abort();
        let _ = task.await;
    }

    #[test]
    fn v46_terminal_error_preserves_underlying_cause() {
        let error = stopped(Err(moq_tokio::Error::Reconnect(
            "retry exhausted: connection refused".into(),
        )));
        assert!(format!("{error:#}").contains("connection refused"));
        assert!(format!("{error:#}").contains("Upstream MoQ connection stopped"));
    }
}
