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
- Optional public listener isolated from authenticated control API; outbound managed MoQ publishing hides origin address.
- Vendored librespot fork preserves upstream license/revision; direct crate dependencies latest stable.
- Spotify default login uses librespot browser OAuth; no user-created developer app required.
- Spotify account connection is independent of later playlist URL imports.

- Passkey roles checked server-side; one writer controller, concurrent passive viewers.

## §I INTERFACES
- I.output: authenticated `/api/moq` settings/status/test and listener credentials.
- I.playback: authenticated owner-only `/api/playback` commands; revisioned status.
- I.upload: authenticated streaming `/api/sources/:id/upload` stores audio and metadata.
- I.helper: jmmp-managed Rust process; framed stereo 48 kHz PCM over stdin; JSON events stdout.
- I.build: `bun run build`, development startup, native compile scripts build and ship helper plus worker assets.
- I.typecheck: `bun run typecheck` checks client, PWA, shared/server code, tests, and build tools with strict typing.
- I.public: optional separate listener bind serves public player/subscribe credentials; rejects control/auth/source APIs.
- I.upstream: private publisher URL file, configurable protocol, independent listener WT/WS URLs; credentials never public.
- I.spotify: authenticated Spotify source provisioning, metadata imports and server-owned decrypted audio via bundled librespot.
- I.spotify-import: authenticated `/api/playlists/import/spotify` reuses a saved Spotify connection to create a native jmmp playlist from a URL.
- I.passkey-invite: Settings → Passkeys creates/revokes expiring invitation URL/QR with a selected role; public `/invite` registers one passkey in that role without prior sign-in.

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
V11: Public listener default off; enabled listener exposes only playback metadata, subscribe-only credentials, static player assets and MoQ WebSocket proxy; mutations/control/auth/source routes unreachable.
V12: Managed relay publisher credential read from private server file, never returned to browser; WT and WS URLs independent; reverse proxy needs no origin TLS/UDP exposure.
V13: Spotify credentials encrypted server-side; source audio fetched only by server through pinned vendored librespot; ordinary cache path and shared DSP remain usable.
V14: Default Spotify sign-in needs only Premium account; fixed upstream loopback callback accepted through authenticated, session-bound, single-use PKCE completion; custom developer app optional.
V15: Mutable SPA entry points/service worker revalidate through CDN; only content-hashed bundles immutable; music cache unchanged.
V16: Spotify sign-in requires no collection URLs; later imports reuse encrypted refresh credentials and atomically create editable local snapshots preserving order/duplicates, without binding to Spotify or Qobuz; rescans retain imported tracks.
V17: Playlist metadata imports use bounded background jobs and authenticated, session-bound status polling; no long HTTP request through a tunnel, no partial playlist on failure.
V18: Native helper selects process TLS crypto provider before either Spotify or MoQ initializes HTTPS; compiled provider ambiguity never reaches login.
V19: Spotify import UI shows loaded track count; background failure yields actionable allowlisted error and safe server log; native diagnostics/credentials never enter response; polling has finite deadline.
V20: Mixed Spotify playlists preserve order/duplicates of supported music; local-file/other unsupported references skipped with explicit count and persistent UI notice; never claimed server-playable.
V21: Only full admin sessions mint/list/revoke invitations; 256-bit bearer secret stored only as hash, shared in URL fragment/local QR, never returned by list or cached; expiry and revocation survive restart.
V22: Invitation grants only registration until verified passkey succeeds; challenge bound to invitation and expires in ten minutes; failed/cancelled registration and link previews preserve invitation; atomic consumption plus credential insert permits exactly one winner, including concurrent attempts.
V23: Invited passkeys obey configured WebAuthn RP/origin/user verification; successful recipient can later sign in normally; wipe-passkeys invalidates invitations/challenges; public music listener exposes no invitation API.
V24: Packaged audio worker resolves its sibling bundled helper without a source checkout/toolchain; Spotify source bytes reach shared DSP from that worker.
V25: Playback startup and asynchronous source failures set recoverable player error state and display an error in both compact and desktop transport.
V26: Public now-playing status exposes only selected track title/artist; listener page refreshes metadata before listening and on track changes, preserves paused metadata, and clears idle/ended/error metadata without source audio/control requests.
V27: Spotify playback resolves a supported, account-available file through bounded, deduplicated alternate track lookups and requests its key with that alternate's ID; failure before audio header reports a fixed useful code while worker stack traces remain visible.

V28: Only typed Spotify unavailability advances the current queue once per attempt; transient/auth failures stay retryable; skipped-track error and full stack remain inspectable after playback continues; finite unavailable queues terminate.
V29: Live Spotify search reuses saved server credentials, bounds queries/results/timeouts, persists playable catalog IDs and respects source/field filters without a developer app.
V30: All track tables expose continuous column dividers, mouse/touch/keyboard resizing and header right-click/long-press visibility menus; validated localStorage preferences restore on startup; hidden columns remain recoverable.
V31: Connected listeners rearm media on accepted playback generations, including repeated same-track selection and seek; idle/ended/source gaps remain subscribed, stale status never rearms, and stalled subscriptions recover without another Listen click.
V32: Each listener independently measures rendered underruns with RTT floor; bounded playout delay rises promptly and falls cautiously, ignores intentional silence/content boundaries, and retains learned delay across media/transport recovery without changing server DSP or other clients.
V33: Versioned, bounded per-origin localStorage retains learned receiver delay and failed-budget floor across refresh; invalid/blocked storage never interrupts playback; quiet evidence restarts after refresh.
V34: Delay decreases require ten uninterrupted minutes of healthy rendering, then at most 5ms/minute above failed-budget safety floor; recovered short gaps restart quiet evidence; one continuous stall counts once; refills never feed estimator; persistent stopped render clock rebuilds full receiver automatically without a Listen click.

V35: Listener Resync clears saved delay, failed-budget floor, RTT and quiet evidence, cancels stale receiver work and reconnects at initial budget; owner playback and other listeners continue unchanged.
V36: Structured service logs identify source/worker, server/helper and helper/upstream gaps, their duration and recovery; deliberate pause/seek/EOF excluded; stalled operations log before returning; native stdout continuously drained; upstream loss/stale-content counters distinct from confirmed receiver underruns; credentials never logged.

V37: Full sessions bind the authenticating passkey; current database role controls each API request and queued playback command; deleted credentials revoke sessions; legacy unbound sessions require sign-in; existing/new credentials default admin unless an invitation assigns another role; last admin cannot be removed/demoted.
V38: Viewers observe without ownership/heartbeat/tab claims or server/shared playback writes; all roles receive MoQ, only DJs/admins receive source audio; player control requires enabled MoQ; read-write roles retain one controller; initial settings/UI hydration never claims ownership or sends shared controls.
V39: MoQ settings, existing source config and passkey/invitation administration require admin; DJs add sources/uploads and CRUD playlists; source/file deletion remains admin; all other role capabilities enforced in API and UI; unclassified API defaults admin.
V40: Safe playback discovery exposes enabled mode and player page only; sidebar Listen to stream opens configured public player or authenticated /listen in a new tab; no MoQ admin settings query by listeners; passkey labels persist server-side; local view preferences never write viewer playback state.
V41: Admin invitation creation validates and persists viewer/player/dj/admin role, default admin for omitted role and legacy invitations; recipient UI displays assigned access; atomic consumption assigns the stored role to the credential and first session; recipient payload cannot elevate it; single-use/expiry/revocation preserved.

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
T8|x|public listener, managed relay publishing and independent transport URLs|V1,V2,V6,V7,V8,V9,V10,V11,V12,I.public,I.upstream
T9|x|vendor librespot, upgrade direct crates and add Spotify source|V3,V8,V10,V13,I.spotify,I.build
T10|x|publish generic features; deploy isolated public/control services and verify CDN playback|V6,V8,V9,V10,V11,V12,V13,I.public,I.upstream,I.spotify
T11|x|default Spotify to built-in browser login; verify and deploy|V8,V10,V13,V14,V15,I.spotify,I.build
T12|x|separate Spotify account connection and native playlist URL import; verify and deploy|V10,V13,V14,V15,V16,V17,I.spotify,I.spotify-import
T13|x|single-use passkey invitation URL/QR, authenticated management, recipient enrollment; verify, push and deploy|V10,V11,V21,V22,V23,I.passkey-invite
T14|x|repair packaged Spotify worker helper lookup and visible playback errors; verify, publish and deploy|V8,V10,V24,V25,I.helper,I.spotify,I.playback
T15|x|public listener current track/artist display; verify, publish and deploy|V10,V11,V15,V26,I.public,I.playback
T16|x|repair Spotify alternate track playback and stream startup error codes; verify, publish and deploy|V10,V13,V24,V25,V27,I.spotify,I.helper

T17|x|typed unavailable Spotify skipping and retained playback diagnostics|V10,V25,V27,V28,I.playback,I.spotify
T18|x|saved-account live Spotify search|V10,V13,V29,I.spotify
T19|x|shared resizable/hideable table columns with persisted browser preferences|V10,V30
T20|x|repair listener discontinuity recovery and add per-client adaptive playout; verify, push and deploy|V9,V10,V31,V32,I.public,I.playback
T21|x|persist learned delay, stabilize adaptive probes and automatically recover stuck receivers; verify, push and deploy|V10,V33,V34,I.public
T22|x|listener Resync and pipeline dropout diagnostics; verify, push and deploy|V10,V12,V35,V36,I.public,I.helper,I.upstream

T23|x|passkey roles/labels, concurrent observers and stream shortcut; verify|V10,V37,V38,V39,V40
T24|x|select and persist invitation role; verify|V10,V21,V22,V23,V37,V41,I.passkey-invite

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
B12|2026-10-11|MoQ protocol parser returns String rather than StdError; anyhow context bound fails|Map protocol parse error explicitly; compile native helper (V10,V12)
B13|2026-10-11|Stable librespot APIs use older digest, RNG, XML, decoder, HTTP, CPAL and rodio interfaces; latest ALSA crates conflict on native links|Preserve cryptographic encoding and adapt source APIs; vendor minimal CPAL/rodio patches, verify headless/rodio builds and workspace tests (V10,V13)
B14|2026-10-11|Bun fetch mock lacks preconnect member; source-worker termination can orphan Spotify login before audio starts|Retain fetch mock signature and add parent heartbeats bounding native child lifetime (V4,V10,V13)
B15|2026-10-11|vergen 10 omits git keys in source archives; vendored core expects compile-time keys|Supply explicit archive metadata when git worktree unavailable; verify Linux archive build (V8,V13)
B16|2026-10-11|Upgraded vergen requires Rust 1.96 above declared helper/fork minimum|Raise manifests, build diagnostics and documentation to actual minimum (V8,V10)
B17|2026-10-11|Permanent outbound publisher failure unobserved; optional native diagnostics can contain relay tokens|Observe upstream termination and redact diagnostic URL/JWT credentials before returning errors; regression check (V8,V12)
B18|2026-10-11|New MoQ clients use joining FETCH, unsupported by Cloudflare beta; cached catalog join stalls|Publish periodic catalog revisions without audio; verify idle snapshot refresh and managed WT catalog (V7,V12)
B19|2026-10-11|Cloudflare retains withdrawn publication state across quick same-name restarts|Use unique helper broadcast names/instance IDs and drain outbound connection on shutdown; verify restarted managed catalog (V8,V12)
B20|2026-10-11|Spotify/Qobuz callbacks derived from Bun HTTP scheme fail behind TLS offload|Use configured public origin matching request host/browser Origin; reject foreign hosts/origins; regression checks (V13)
B21|2026-10-11|Spotify GUI requires user-created developer app despite librespot built-in OAuth support|Default upstream client/loopback flow, authenticated pasted callback, optional custom app; state/PKCE/encryption tests (V14)
B22|2026-10-11|Dev API proxy rewrites Host to backend, failing configured OAuth origin checks|Preserve browser-facing Host; real browser default sign-in regression (V8,V14)
B23|2026-10-11|Mutable sw.js lacks origin cache policy; CDN minimum browser TTL pins old PWA for four hours|Revalidate entry points, immutable hashed bundles, respect origin headers and purge previously cached worker; freshness regression (V15)
B24|2026-10-11|New playlist-import test fixture omits WebAuthn origin required by session cookie creation|Provide configured controller origin in authenticated fixtures (V10,V16)
B25|2026-10-11|Browser test expects an exact text node on a storage label containing an icon|Assert the displayed storage label within its container (V10,V16)
B26|2026-10-11|Desktop sidebar exposes individual playlists but no link to the playlist index/import page|Add All playlists navigation and exercise it in the import browser test (V16)
B27|2026-10-11|Bundled MoQ and librespot enable both Rustls providers; Spotify mode starts before selecting a default and panics before metadata|Select shared provider before mode dispatch; offline native TLS regression and real saved-account playlist import (V18)
B28|2026-10-11|Spotify helper stderr ignored and import jobs discard errors; UI shows only an indefinite spinner|Typed native error codes, safe job logging/status errors, track progress and bounded client polling; regression checks (V19)
B29|2026-10-11|Native metadata aborts entire playlist on first Spotify local file or other unsupported item|Filter unsupported references, preserve remaining music order, report skipped count; mixed native/server/browser tests (V20)
B30|2026-10-11|Bundled audio worker imports empty asset placeholders; Spotify fetch searches for source checkout instead of extracted helper|Reuse sibling packaged helper; isolated bundled-worker source/DSP regression (V24)
B31|2026-10-11|Transport hides backend failures; rejected playback startup leaves state unchanged|Expose playback errors and handle startup rejection; store/browser regressions (V25)
B32|2026-10-11|Root browser tests cannot resolve workspace-only shared package alias|Use relative shared type import; tools typecheck covers browser regressions (V10)
B33|2026-10-11|Spotify stream picks only requested track files and discards native startup cause; relinked tracks fail despite playable alternatives|Bounded available alternate resolution, matched audio-key ID, fixed stream error codes; preserve worker stacks (V27)

B34|2026-10-11|Animated header menu refocus races immediate keyboard reopen after hiding a header|Instant header menu transitions and no stale refocus; mouse/touch/keyboard browser regression (V30)
B35|2026-10-11|Playback generations never rearm ended audio subscriptions; auto latency tracks minimum RTT without underrun feedback|Rearm media independently of transport, keep idle listeners waiting, bounded receiver jitter/underrun adaptation and rendered-audio regression (V31,V32)
B36|2026-10-11|Browser seek test observes retained analyser frequency before queued Play reaches server|Wait for new public track metadata before issuing seek (V31)
B37|2026-10-11|Jitter observation after decoder backpressure feeds target latency back into its own estimator|Observe transport-buffered live edge before decode pacing; assert stable receiver stays low while another receives delayed bursts (V32)
B38|2026-10-11|Listener retains current source error after successful generation recovery|Clear active error on recovered status; preserve original diagnostic event/history (V31)
B39|2026-10-11|Full player replacement churns catalog subscriptions during reconnect and exposes upstream cancellation races|Rearm media demand with supported enabled/reset signals; retain catalog, transport and audio context (V31)
B40|2026-10-11|Browser jitter route misses native WebSocketStream, leaving delay simulation inactive|Route supported WebSocket ponyfill and assert repeated real delivery pauses plus rendered continuity (V32)
B41|2026-10-11|Upstream shared ring leaves stalled=false on exhaustion, hiding rendered underruns|Observe stopped render playhead too; validate generation/state after status poll and exclude deliberate refills (V32)
B42|2026-10-11|Delayed main-thread playhead delivery can resemble a speaker underrun|Confirm lost render time against advancing worklet clock; exclude caught-up signals and pending intentional refills (V32)
B43|2026-10-11|Cold-start decay immediately removes latency learned from jitter unless an underrun was counted|Apply thirty-second cooldown to proactive jitter growth too; quantize growth to avoid repeated tiny refills (V32)
B44|2026-10-11|Arrival-only decay ignores recovered render gaps; failed budgets retried and client learning discarded on refresh|Persist validated delay/safety floor; require render-clock health; ten-minute quiet period and 5ms/minute probes (V33,V34)
B45|2026-10-11|Repeated observations multiply one ongoing stall; watchdog only rearms existing decoder/ring and cannot repair broken receiver|One increase per gap episode; exclude refill feedback; rebuild full connection/player after bounded stalled-clock deadline; rendered high-delay/blackhole regression (V34)
B46|2026-10-11|Short browser fixture reaches EOF before slower learning checks; worklet console output not delivered consistently to page|Lengthen fixture through ordinary shared DSP; inspect actual worklet init messages and speaker output (V10,V34)
B47|2026-10-11|Route-fulfilled isolated browser document lacks local address space; Chromium blocks fixture relay access|Grant local-network permission only in isolated localhost test context (V10,V34)
B48|2026-10-11|Merged buffered ranges include decode pacing/reconnect backlog; apparent arrival jitter raises 1875ms to 4025ms after only one underrun|Use actual render-clock loss and RTT floor; high-delay recovery regression asserts one increase per continuous gap (V32,V34)
B49|2026-10-11|Jitter regression requires guessed delay despite continuous output; pre-reconnect render count can mask failed recovery|Assert growth plus seamless subsequent pauses; require fresh rendered output after replacement connection (V32,V34)
B50|2026-10-11|Helper stdout stops draining at ready; worker and pipe waits have no live diagnostics; upstream only reports terminal failure|Continuous bounded diagnostic stream, stage-specific gap/recovery events and upstream transport/stale-content summaries (V36)
B51|2026-10-11|Worker regression treats startup recovery as later streaming-gap recovery and exits before pipe test|Match steady-playback recovery phase and startup flag before asserting all stages (V36)

B52|2026-10-11|Role migration changes schema count; authenticated player fixtures now reach real tab-lock network calls|Update migration expectation and bind/mock authenticated fixture sessions; keep strict checks (V10,V37)
B53|2026-10-11|Playlist import fixtures omitted an authenticated role; old controllers could reclaim ownership while auto-advancing shared EOF|Bind fixtures to DJ; recheck ownership before automatic advance and never claim control implicitly; passive release stops local audio only (V10,V38)
B54|2026-10-11|Browser fixture reused an excluded authenticator for a second passkey; credential creation previously switched the admin principal|Use a separate virtual authenticator; preserve existing admin binding; recheck admin scope before credential/invitation writes; verify real browser role editing (V37,V39)
B55|2026-10-11|New label validator rejected optional null nickname; mode discovery no longer uses admin endpoint; observer cached mode could overwrite local playback after disable|Accept null nickname; update playback fixtures to safe discovery/full observer metadata; synchronize discovered mode immediately (V10,V37,V40)
B56|2026-10-11|Touch menu test reopens keyboard menu before focus trap releases the prior popup|Wait for popup removal and focused header before keyboard reopen (V10,V30)
B57|2026-10-11|New controller routes pause/seek/volume to idle local backend until first track selection; parameters require an audio subscription|Route explicit controls by observed MoQ mode, claim ownership only for deliberate user actions, and send parameters without requiring audio subscription; cold-controller regression (V38)
B58|2026-10-11|Long upload retained permissions from request start after a credential downgrade|Revalidate role/source immediately before synchronous permanent file/catalog commit; streaming-upload downgrade regression (V37,V39)
B59|2026-10-11|Pitch panels apply default DSP on mount/hydration, claiming shared playback from a newly signed-in controller|Send DSP only from user input; initialize pitch/tempo/speed when deliberately selecting a track; cold-controller browser regression rejects unsolicited parameters (V38)
B60|2026-10-11|Invitation browser fixture reads text content from a Quasar combobox input|Assert the input value; verify admin default and real viewer enrollment (V10,V41)
B61|2026-10-11|RBAC scope fixture starts a real relay with empty settings and times out compiling Rust on a fresh host|Use invalid bitrate to reach admin validation without native startup; assert admin 400 versus other roles 403 (V10,V39)
