// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
use std::future::Future;
use std::time::Duration;

pub fn run(future: impl Future<Output = anyhow::Result<()>>) -> anyhow::Result<()> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let result = runtime.block_on(future);
    // Tokio stdin uses an uncancellable blocking read. Do not wait for the
    // parent to send another PCM frame before reporting a fatal network error.
    runtime.shutdown_timeout(Duration::from_millis(250));
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};
    use tokio::io::AsyncReadExt;

    #[test]
    fn v47_fatal_failure_exits_with_parent_pcm_pipe_still_open() {
        if std::env::var_os("JMMP_TEST_PENDING_STDIN").is_some() {
            let result = run(async {
                let mut input = tokio::io::stdin();
                let mut byte = [0];
                tokio::select! {
                    _ = input.read_exact(&mut byte) => panic!("parent must retain an empty open pipe"),
                    _ = tokio::time::sleep(Duration::from_millis(100)) => anyhow::bail!("upstream authentication rejected"),
                }
            });
            assert!(
                result
                    .unwrap_err()
                    .to_string()
                    .contains("authentication rejected")
            );
            return;
        }
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "runtime::tests::v47_fatal_failure_exits_with_parent_pcm_pipe_still_open",
                "--nocapture",
            ])
            .env("JMMP_TEST_PENDING_STDIN", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let started = std::time::Instant::now();
        loop {
            if let Some(status) = child.try_wait().unwrap() {
                assert!(status.success(), "child regression failed: {status}");
                break;
            }
            if started.elapsed() > Duration::from_secs(5) {
                child.kill().unwrap();
                let _ = child.wait();
                panic!("helper runtime hung on a pending PCM pipe after fatal failure");
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}
