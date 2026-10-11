# SPEC

## §G GOAL
jmmp serves shared-DSP server playback through optional integrated Opus/MoQ relay; ordinary browser playback retains source caching.

## §C CONSTRAINTS
- MoQ disabled by default; GUI settings persist server-side.
- Browser sends controls only during MoQ playback; server sole source reader.
- Local uploads persist server-side before catalog publication; browser-only handles cease playback sources.
- Shared TypeScript decoder/DSP, Bun audio worker, bundled Rust encoder/relay.
- Existing S3/Qobuz credentials, passkeys, cached offline playback preserved.
- Direct dependencies use latest stable npm/crates.io releases; lockfiles updated.

## §I INTERFACES
- I.output: authenticated `/api/moq` settings/status/test and listener credentials.
- I.playback: authenticated owner-only `/api/playback` commands; revisioned status.
- I.upload: authenticated streaming `/api/sources/:id/upload` stores audio and metadata.
- I.helper: jmmp-managed Rust process; framed stereo 48 kHz PCM over stdin; JSON events stdout.
- I.build: `bun run build`, development startup, native compile scripts build and ship helper plus worker assets.
- I.typecheck: `bun run typecheck` checks client, PWA, shared/server code, tests, and build tools with strict typing.

## §V INVARIANTS
V1: Disabled MoQ spawns no helper, worker, or source fetch.
V2: MoQ browser backend never reads source/cache; commands accepted only from current playback owner.
V3: Decoder/DSP same implementation in browser and server; finite bounded stereo output, gain/pitch/tempo/speed honored.
V4: Source decoding bounded; output paced by monotonic sample clock; seek/stop invalidate stale work.
V5: Local upload atomic, server-owned, path-safe; missing legacy browser-only tracks fail explicitly.
V6: Relay listener tokens subscribe-only, expiring; native publisher uses in-process origin.
V7: Settings validated before persistence; connection test exercises helper and relay session.
V8: Development and packaged builds locate helper/worker automatically; process failure surfaces playback error.
V9: MoQ subscribers share one source reader; pause/resume/seek and track changes reach all listeners.
V10: Repository type checking succeeds without suppressing project errors or weakening strictness; dependency upgrades preserve playback/auth/build tests.

## §T TASKS
id|status|task|cites
--|--|--|--
T1|x|shared decoder/DSP plus bounded Bun audio worker|V3,V4,I.helper
T2|x|integrated Rust Opus encoder/relay and build packaging|V6,V8,I.build,I.helper
T3|x|server settings, owner controls, lifecycle and connection test|V1,V2,V7,V9,I.output,I.playback
T4|x|server local uploads; retire browser-only audio source path|V5,I.upload
T5|x|ordinary MoQ browser playback and GUI configuration|V2,V7,V9,I.output,I.playback
T6|x|integration tests, builds and deployment docs|V1,V2,V3,V4,V5,V6,V7,V8,V9
T7|x|upgrade stable dependencies, fix all type errors, verify builds and browser playback|V1,V2,V3,V4,V5,V6,V7,V8,V9,V10,I.typecheck,I.build

## §B BUGS
id|date|cause|fix
--|--|--|--
B1|2026-10-11|MoQ docs expose fingerprint method absent from pinned public API; timestamp constructor fallible|Read fingerprint through relay HTTP; compile against locked revision (V8)
B2|2026-10-11|Migration test hard-coded schema version; compiler lacks Quasar ambient types; EOF decoder queue could flush twice|Update migration assertion; verify generated client config; drain EOF chunks once (V4)
B3|2026-10-11|Tests treated MoQ discontinuity marker as audio and omitted decoder flush; pre-existing client cache downloads survive output switch|Skip marker frames, flush decoder, cancel existing source streams before enabling MoQ (V2,V3,V9)
B4|2026-10-11|Bun DCE drops decoder worker classes but leaves assignNames references despite source-mode success|Bundle worker with esbuild and retained exports; run MoQ integration against embedded worker assets (V8)
B5|2026-10-11|Settings hydration overwrites early GUI edits; relay restart loses current playback and subscriber connection|Disable edits until settings load; preserve server playback and reconnect browser after save (V7,V9)
B6|2026-10-11|Chromium QUIC resolves localhost to IPv6 without retrying IPv4 relay bind|Return a literal loopback WebTransport endpoint matching bind family; assert actual WT in browser tests (V7,V8)
B7|2026-10-11|Rust HEAD adds per-track archive metadata incompatible with released browser catalog schema|Omit archive discovery on this live broadcast, retain media cache; validate catalog in connection test and decode real Opus in browser (V7,V8,V9)
B8|2026-10-11|Opaque browser WS authentication failures keep retrying old relay credentials after server restart; late polls can apply old ended events|Detect server instance changes, renew credentials/certificate pin, reject older revisions/generations, preserve ended deduplication across reconnects (V4,V6,V9)
B9|2026-10-11|No repository typecheck command; generated Quasar strict types, Bun test types, and ArrayBuffer ownership unchecked|Add complete typecheck command and fix source/config/test typing (V10)
B10|2026-10-11|Git MoQ encoder exposes unreleased grouping knob; latest vue-tsc requires old compiler API; Quasar v3 changes env/wrappers/PWA packaging|Use stable crates' per-packet groups, official TypeScript 6 compatibility API beside TypeScript 7, migrate Quasar v3 interfaces (V8,V10)
B11|2026-10-11|Concurrent Playwright suites clean shared report directory and delete another suite's traces|Use separate standard, bundled MoQ, and compiled MoQ output directories (V10)
