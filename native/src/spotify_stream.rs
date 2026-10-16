// Copyright 2026 Sean McNamara
// SPDX-License-Identifier: Apache-2.0
//! Resume one pinned Spotify file after transient reads; never retry stdout writes.
use std::io::{self, Read, Write};
use std::time::Duration;

pub const RETRY_DELAYS: [Duration; 3] = [
    Duration::from_millis(250),
    Duration::from_secs(1),
    Duration::from_secs(2),
];

pub fn copy<R: Read, W: Write>(
    source: R,
    mut reopen: impl FnMut(u64) -> io::Result<R>,
    output: &mut W,
    start: u64,
    size: u64,
    delays: &[Duration],
    mut report: impl FnMut(&str, usize, u64, &str),
) -> io::Result<()> {
    let mut source = Some(source);
    let mut copied = 0;
    let mut attempts = 0;
    let mut recovering = false;
    let mut last_reason = "read_failed";
    let mut buffer = [0; 16 * 1024];
    while copied < size {
        let opened = if source.is_none() {
            match reopen(start + copied) {
                Ok(reader) => {
                    source = Some(reader);
                    Ok(())
                }
                Err(error) => Err(error),
            }
        } else {
            Ok(())
        };
        let opening = source.is_none();
        let next = opened.and_then(|_| {
            source
                .as_mut()
                .unwrap()
                .read(&mut buffer[..(size - copied).min(16 * 1024) as usize])
        });
        let next = match next {
            Ok(0) => Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "Spotify audio download truncated",
            )),
            other => other,
        };
        match next {
            Ok(count) => {
                // A failed/partial stdout write means cancellation; never redownload it.
                output.write_all(&buffer[..count])?;
                copied += count as u64;
                if recovering {
                    report("recovered", attempts, start + copied, last_reason);
                    recovering = false;
                }
            }
            Err(error) => {
                drop(source.take()); // Stop the old loader before opening its replacement.
                last_reason = reason(&error);
                let transient = (opening
                    && !matches!(
                        error.kind(),
                        io::ErrorKind::InvalidData
                            | io::ErrorKind::InvalidInput
                            | io::ErrorKind::PermissionDenied
                            | io::ErrorKind::Unsupported
                    ))
                    || matches!(
                        error.kind(),
                        io::ErrorKind::TimedOut
                            | io::ErrorKind::UnexpectedEof
                            | io::ErrorKind::ConnectionReset
                            | io::ErrorKind::ConnectionAborted
                            | io::ErrorKind::NotConnected
                            | io::ErrorKind::BrokenPipe
                            | io::ErrorKind::Interrupted
                    );
                if !transient || attempts == delays.len() {
                    report("failed", attempts, start + copied, last_reason);
                    return Err(error);
                }
                let delay = delays[attempts];
                attempts += 1;
                recovering = true;
                report("retry", attempts, start + copied, last_reason);
                std::thread::sleep(delay);
            }
        }
    }
    output.flush()?;
    Ok(())
}

pub fn reason(error: &io::Error) -> &'static str {
    match error.kind() {
        io::ErrorKind::TimedOut => "timeout",
        io::ErrorKind::UnexpectedEof => "truncated",
        io::ErrorKind::ConnectionReset => "connection_reset",
        io::ErrorKind::ConnectionAborted => "connection_aborted",
        io::ErrorKind::NotConnected => "not_connected",
        io::ErrorKind::BrokenPipe => "broken_pipe",
        _ => "read_failed",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;

    struct Reader {
        data: Vec<u8>,
        position: usize,
        fail_at: Option<usize>,
        active: Rc<Cell<usize>>,
    }
    impl Reader {
        fn new(
            data: &[u8],
            position: usize,
            fail_at: Option<usize>,
            active: Rc<Cell<usize>>,
        ) -> Self {
            assert_eq!(active.get(), 0, "previous source reader remains alive");
            active.set(1);
            Self {
                data: data.to_vec(),
                position,
                fail_at,
                active,
            }
        }
    }
    impl Drop for Reader {
        fn drop(&mut self) {
            self.active.set(self.active.get() - 1);
        }
    }
    impl Read for Reader {
        fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
            if self.fail_at == Some(self.position) {
                return Err(io::ErrorKind::TimedOut.into());
            }
            let end = (self.position + out.len())
                .min(self.data.len())
                .min(self.fail_at.unwrap_or(usize::MAX));
            let n = end - self.position;
            out[..n].copy_from_slice(&self.data[self.position..end]);
            self.position = end;
            Ok(n)
        }
    }

    #[test]
    fn v48_reopens_at_exact_offset_without_duplicate_bytes_or_concurrent_readers() {
        let active = Rc::new(Cell::new(0));
        let data: Vec<_> = (0..128).collect();
        let mut offsets = Vec::new();
        let mut output = Vec::new();
        let mut events = Vec::new();
        let initial = Reader::new(&data, 7, Some(55), active.clone());
        copy(
            initial,
            |offset| {
                offsets.push(offset);
                Ok(Reader::new(&data, offset as usize, None, active.clone()))
            },
            &mut output,
            7,
            100,
            &[Duration::ZERO; 3],
            |event, attempt, offset, reason| {
                events.push((event.to_owned(), attempt, offset, reason.to_owned()))
            },
        )
        .unwrap();
        assert_eq!(output, data[7..107]);
        assert_eq!(offsets, [55]);
        assert_eq!(active.get(), 0);
        assert_eq!(events[0], ("retry".into(), 1, 55, "timeout".into()));
        assert_eq!(events.last().unwrap().0, "recovered");
    }

    #[test]
    fn v48_retries_are_bounded_and_keep_last_download_cause() {
        let active = Rc::new(Cell::new(0));
        let attempts = Cell::new(0);
        let mut output = Vec::new();
        let initial = Reader::new(b"abcdef", 0, Some(2), active.clone());
        let error = copy(
            initial,
            |offset| {
                attempts.set(attempts.get() + 1);
                Ok(Reader::new(
                    b"abcdef",
                    offset as usize,
                    Some(2),
                    active.clone(),
                ))
            },
            &mut output,
            0,
            6,
            &[Duration::ZERO; 3],
            |_, _, _, _| {},
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert_eq!(attempts.get(), 3);
        assert_eq!(output, b"ab");
        assert_eq!(active.get(), 0);
    }

    #[test]
    fn v48_truncated_download_resumes_but_changed_file_is_terminal() {
        let mut output = Vec::new();
        copy(
            io::Cursor::new(b"ab".to_vec()),
            |offset| {
                assert_eq!(offset, 2);
                Ok(io::Cursor::new(b"cdef".to_vec()))
            },
            &mut output,
            0,
            6,
            &[Duration::ZERO; 3],
            |_, _, _, _| {},
        )
        .unwrap();
        assert_eq!(output, b"abcdef");
        let mut attempts = 0;
        let error = copy(
            io::Cursor::new(b"ab".to_vec()),
            |_| {
                attempts += 1;
                Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Spotify audio file size changed",
                ))
            },
            &mut Vec::new(),
            0,
            6,
            &[Duration::ZERO; 3],
            |_, _, _, _| {},
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
        assert_eq!(attempts, 1);
    }

    #[test]
    fn v48_cancelled_output_never_reopens_spotify() {
        struct Closed;
        impl Write for Closed {
            fn write(&mut self, _: &[u8]) -> io::Result<usize> {
                Err(io::ErrorKind::BrokenPipe.into())
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let attempts = RefCell::new(Vec::new());
        assert_eq!(
            copy(
                io::Cursor::new(b"audio".to_vec()),
                |offset| {
                    attempts.borrow_mut().push(offset);
                    Ok(io::Cursor::new(b"audio".to_vec()))
                },
                &mut Closed,
                0,
                5,
                &[Duration::ZERO; 3],
                |_, _, _, _| {}
            )
            .unwrap_err()
            .kind(),
            io::ErrorKind::BrokenPipe
        );
        assert!(attempts.borrow().is_empty());
    }
}
