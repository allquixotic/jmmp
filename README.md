# jmmp

jmmp is a minimal, self-hosted music player for people who want one private
library interface across uploaded files, S3-compatible storage, and Qobuz.

The client is a Quasar v2 / Vue 3 PWA. It streams and decodes audio in the
browser and supports real-time pitch, tempo, and speed shifting through
SoundTouchJS in an AudioWorklet. Optional MoQ output moves decoding and that
same DSP to a Bun server worker, with an integrated Rust Opus encoder and relay.
The server stores state in sqlite and uses passkeys for authentication.

## Features

- Passkey-only login with a one-time bootstrap token for first setup.
- Permanent server uploads, from files or a folder picker.
- S3-compatible source support for AWS S3, MinIO, and similar services.
- Qobuz source support through browser OAuth.
- Library browsing, search, playlists, queue, listening history, and album art.
- Browser-side audio cache controls and offline-aware playback behavior.
- Optional Opus broadcast over WebTransport with WebSocket fallback, including
  an ordinary MoQ listener in the controlling browser.
- Optional Tailscale HTTPS auto-detection for tailnet deployments.
- Single-binary builds that embed the production PWA.

## Requirements

- Bun 1.4 or newer.
- Node.js 22.22+, 24, 26, 28, or 30 for Quasar's client build tooling.
- Rust 1.96 or newer and a native compiler toolchain when building jmmp, or
  when first enabling MoQ from a source checkout. Packaged executables include
  the helper and worker; their users need no Rust installation.
- A browser with passkey support.
- WebCodecs and either WebTransport or WebSockets for MoQ playback.
- Chromium for the optional folder picker; ordinary file upload works without it.
- Playwright browsers, if you want to run the end-to-end suite.

## Quick Start

Install dependencies:

```bash
bun install
```

Create the default config:

```bash
bun --cwd=server run init
```

Start the development stack:

```bash
bun run dev
```

Open `http://localhost:9000`. On first launch the server prints a bootstrap
token. Paste that token into the web app, register a passkey, and sign in.

To invite another person, open **Settings → Passkeys → Create invitation**.
Choose an optional label and expiry (24 hours by default), then copy the URL
or share/download its QR code. The recipient opens it without signing in and
chooses **Add my passkey**. Their new passkey grants full control of this jmmp
instance and works with normal passkey sign-in afterward.

Each invitation allows exactly one successful registration. Opening the link,
scanning the QR code or cancelling the passkey prompt does not consume it.
Unused invitations can be revoked from Passkeys, and expire automatically.
Links are shown only when created; the server stores only their hashes.
`wipe-passkeys` also invalidates all outstanding invitations.

If all passkeys are lost, reset passkeys from the server workspace:

```bash
bun --cwd=server run wipe-passkeys
```

## Configuration

By default, jmmp reads:

```text
~/.config/jmmp/jmmp.yml
```

Override the config path with `JMMP_CONFIG`:

```bash
JMMP_CONFIG=/path/to/jmmp.yml bun --cwd=server run start
```

A deployable example is available at `share/jmmp.example.yml`. The most important
settings are:

- `listen.host` and `listen.port`: where the server binds.
- `jwtSecret`: random secret used for session tokens.
- `webauthn.rpId`: host name used for passkey verification, without port.
- `webauthn.origin`: full allowed browser origin or origins.
- `dataDir`: sqlite database, machine key, certificates, and cached art.
- `tailscaleAuto`: whether to use `tailscale cert` and MagicDNS when available.

WebAuthn works on `localhost` over HTTP. For non-localhost hosts, serve jmmp over
HTTPS and set `webauthn.rpId` and `webauthn.origin` to the public host.

## Sources

Local files are uploaded through Sources → Upload music and stored permanently
under the server's data directory. The optional folder picker also uploads the
bytes; its browser handle is only an import convenience. Every playback source
is accessible to the server, even when MoQ is off.

After upgrading, reimport old browser-only local sources using their Import
action. Their catalog entries remain visible but cannot play until their bytes
have been uploaded. S3/Qobuz tracks already cached in a browser remain playable
with MoQ off even if the upstream track has disappeared.

S3 sources need an endpoint, region, bucket, optional prefix, and access keys.
jmmp can use path-style URLs for MinIO and other S3-compatible services.

Qobuz sources are added through the web UI. jmmp opens Qobuz login in a browser
window and stores only the resulting auth token, encrypted with the local machine
key.

## MoQ Output

MoQ is disabled by default. Open Settings → MoQ output, configure the relay URL,
listen address, port, and Opus bitrate, then use Test connection and Save.
Settings are persisted in sqlite. jmmp starts and stops its own relay; a separate
MoQ installation is unnecessary. The connection test opens a real authenticated
session and subscribes to the audio catalog, and reports the transport used.

For localhost, use an available port (default 4443), listen address 127.0.0.1,
and URL http://localhost:4443. The helper generates a short-lived certificate
for WebTransport and the client pins its fingerprint. WebSocket fallback uses
the same TCP port without TLS. For remote listeners, use an HTTPS relay URL,
a reachable listen address, and PEM certificate/key paths on the server.
Allow both UDP (WebTransport) and TCP (WebSocket fallback) on the relay port.
The relay URL must point to that relay port; a conventional HTTP reverse proxy
alone does not provide the UDP WebTransport endpoint.

When enabled, the controlling browser sends track, seek, pause, pitch, tempo,
speed, ReplayGain, and volume controls. The server reads the source once,
decodes it with the shared decoder code, applies the shared SoundTouch DSP in a
Bun worker, and sends bounded 48 kHz stereo PCM through a private pipe to Rust.
Rust encodes Opus (192 kbps by default) and publishes one broadcast. The browser
uses the upstream MoQ player for buffering and clock adjustment. Extra listeners
can open /listen after signing in with their own jmmp passkey; their credentials
allow subscription only.

All listeners hear the server's processed output, including its volume setting.
Browser source downloads, playback caches, pinning, and offline playback are
unavailable while MoQ is enabled. Disabling it restores the browser audio path
and its existing cache. Server source failures appear as playback errors.
Seeking currently decodes from the beginning and discards audio up to the target,
which can take longer on long tracks or slow sources. The controlling browser
still owns queue advancement; an already started track can finish after it closes.

For a public player behind a reverse proxy or tunnel, add separate loopback
listeners to the server configuration:

```json
{
  "listen": { "host": "127.0.0.1", "port": 8080 },
  "webauthn": { "rpId": "control.example.com", "rpName": "jmmp", "origin": "https://control.example.com" },
  "tailscaleAuto": false,
  "publicListener": { "host": "127.0.0.1", "port": 8081, "origin": "https://radio.example.com" },
  "moqUpstream": { "publisherUrlFile": "/etc/jmmp/publisher-url", "protocol": "moq-transport-16" }
}
```

The example shows the relevant fields; retain the other required server config
fields. Route the control hostname to port 8080 and the public hostname to port
8081. The public socket exposes only the listening page, public playback status,
subscribe credentials, assets, and `/moq` WebSocket forwarding. It has no control,
authentication, library, upload, or source API. Public listening is off by default
and must also be enabled in Settings → MoQ output.
The public listening page shows the current track and artist before listening,
refreshes them automatically, and keeps them visible while playback is paused.
Its status endpoint shares only that track's title/artist, never source details.

For a managed CDN, store its full publish URL in the private `publisherUrlFile`,
readable only by jmmp. Set the GUI's managed WebTransport URL to the CDN's
**subscribe-only** URL, WebSocket fallback URL to `wss://radio.example.com/moq`,
relay URL to `https://radio.example.com`, and enable TLS offload. Keep the embedded
relay bound to loopback. Publishing uses an outbound connection; the browser
receives neither the publish credential nor the origin's network address.
Cloudflare's draft-16 relay uses token paths on
`https://draft-16.cloudflare.mediaoverquic.com/`. The fallback still uses jmmp's
embedded relay through the tunnel. Managed CDN and WebSocket URLs are independent
because not every CDN supports WebSockets. Set Opus bitrate to 128000 for 128 kbps.
The connection test verifies the subscriber path before saving the setting.

Configure a CDN to respect jmmp's origin cache headers. In Cloudflare, set
**Caching → Configuration → Browser Cache TTL → Respect Existing Headers**.
jmmp revalidates mutable app entry points and the browser's PWA service worker;
content-hashed assets are immutable. A minimum browser TTL can keep an old
service worker active after deployment. Purge its previously cached `/sw.js`
when adopting this policy. This does not clear the browser's music cache.

## Build

Build the client and server:

```bash
bun run build
```

Build single-file binaries:

```bash
bash build/compile-macos-arm64.sh
bash build/compile-linux-amd64.sh
```

Both builds automatically compile Rust and embed the helper and bundled Bun
worker. Single-file binaries extract these assets into a versioned directory
under dataDir when MoQ is first enabled. Use the matching Rust target and native
linker for cross compilation. The binaries are written to `dist/`, which is
ignored by git.

## Tests

Check all TypeScript, Vue components, tests, PWA code, and build tooling:

```bash
bun run typecheck
```

This uses TypeScript 7 for ordinary TypeScript and Microsoft's maintained
TypeScript 6 compatibility package for `vue-tsc`, whose released compiler API
integration still requires it. Strict checking stays enabled in both.

Run all unit tests:

```bash
bun run test
```

Run server or client tests separately:

```bash
bun --cwd=server run test
bun --cwd=client run test
```

Run the end-to-end suite:

```bash
bun run e2e
```

The e2e suite uses isolated config and data under `e2e/`, and its runtime data is
ignored by git.

Verify the default Spotify sign-in UI separately against a fresh server database:

```bash
bun run e2e:spotify
```

This uses the real jmmp OAuth start endpoint and mocks Spotify's external
authorization/token completion. Run it sequentially with the standard suite;
both use the same development ports and temporary data directory.

Verify the production bundle with real browser Opus decoding over WebTransport
and forced WebSocket fallback:

```bash
bun run e2e:moq
```

To run the same test against a compiled executable, build it first and set
JMMP_E2E_EXECUTABLE to its path when running Playwright with e2e/moq.config.ts.
This suite uses a temporary database and synthesized audio, and does not access
your library.

## Deployment Helpers

`share/jmmp.service` is a systemd unit example for Linux. `share/com.jmmp.plist`
is a launchd example for macOS. Adjust paths, users, and config locations for
your environment before installing either one.

## License

jmmp is licensed under the Apache License, Version 2.0. See `LICENSE`.

### Spotify source

Add Spotify from **Sources → Add source → Spotify**. Use a Spotify Premium
account; no developer application or API key is required. Choose
**Sign in to Spotify** to connect the account once. jmmp uses the
same built-in OAuth client as librespot. After signing in, Spotify redirects to
`http://127.0.0.1:8898/login`. On a remote jmmp server that address may show an
“Unable to connect” page. Copy the entire final URL from the browser address bar
into jmmp's **Final redirect URL** field and choose **Finish connection**.
This is librespot's [headless OAuth flow](https://github.com/librespot-org/librespot/wiki/Options#headless-oauth);
direct username/password login is no longer supported upstream. The server
stores encrypted access/refresh credentials for later imports and playback.

Later, open **Playlists → Import Spotify playlist**, paste a playlist URL and
choose **Import playlist**. If several Spotify connections are saved, select the
one to use. jmmp copies the name and ordered tracks into a native, editable
playlist stored on the jmmp server, preserving duplicates. It does not write
back to Spotify or bind the new playlist to Qobuz. Changes to Spotify's playlist
after the import do not change this snapshot; importing again creates a new copy.
Metadata loads in a background job so large imports work through a tunnel;
the completed playlist is published atomically, and failures leave no partial
playlist. The import dialog shows how many tracks have loaded. Spotify local-file
references and other unsupported items are skipped with a visible count; upload
local audio to jmmp separately so the server has its actual bits. Saved
credentials refresh automatically; no second sign-in is needed
unless Spotify revokes the authorization. Audio is fetched only when played.
Playback follows Spotify's available alternate track entries when an imported
entry has no supported audio file, while preserving the playlist's track identity.

An existing developer application can instead be used through **Advanced: use
your own Spotify application**. Register the displayed jmmp callback in the
[Spotify developer dashboard](https://developer.spotify.com/dashboard) and enter
its client ID. This optional flow returns directly to jmmp after sign-in.
Its registered callback must use HTTPS or an explicit loopback IP;
`localhost` redirect URIs are not accepted.
Existing configured collections remain supported through the source API's
`uris` list and **Rescan** button. Rescanning keeps tracks imported into native
jmmp playlists.

Authorization uses [PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow).
Access and refresh tokens remain encrypted on the server. The integrated Rust
helper fetches and decrypts Vorbis audio through librespot, and passes a bounded
byte stream to jmmp's shared decoder/DSP. MoQ playback uses one server reader;
ordinary playback downloads through jmmp and retains the existing browser cache.
Cancellation stops the helper; parent heartbeats also bound its lifetime if a
Bun audio worker is terminated while authentication or downloading is pending.

jmmp vendors **librespot v0.8.0** under `native/vendor/librespot`, with its direct
registry dependencies upgraded to stable releases and the corresponding API
repairs. libspotify is a retired proprietary SDK; spotifyd builds on librespot
and adds a daemon/audio-device layer that jmmp does not need. The internal fork
therefore uses librespot's core/audio/metadata libraries directly. Provenance and
licenses remain in each vendor directory. Minimal CPAL/rodio compatibility
patches allow the upgraded fork's desktop backend to compile alongside ALSA 0.12;
jmmp's shipped helper uses the headless Rustls configuration.

Actual Spotify sign-in and playback require a Spotify Premium account.
The automated checks exercise credential refresh/storage, OAuth
session binding/replay rejection, byte ranges, pipe cancellation, migration and
source builds without logging into a real Spotify account.

For a managed relay, a headless catalog check is available in the source tree:
`cargo run --locked --manifest-path native/Cargo.toml --example relay_probe -- --catalog`.
Supply a **subscriber** URL on stdin, followed by the listener's broadcast name
on a second line. Omit `--catalog` to read five media packets
while a broadcast is playing. The example uses WebTransport and draft 16;
normal jmmp listeners negotiate WebTransport and fall back to WebSockets.
The helper republishes catalog snapshots every three seconds so relays without
joining FETCH support can serve new listeners while playback is idle. This sends
metadata only. Set `RUST_LOG` to enable native relay diagnostics; credentials in
diagnostics returned by jmmp are redacted.
Each helper lifetime uses a fresh broadcast name and playback instance ID;
listeners renew their connection after a restart, and upstream relay caches
cannot confuse the previous publication with the new one.

### Spotify search and playback diagnostics

Search includes live Spotify tracks using an already connected Spotify account,
with the same source and field filters used for Qobuz. Search results can be
played or added to native jmmp playlists without importing a Spotify playlist
first. A failed live search shows its source error while keeping local results.

Explicitly unavailable Spotify tracks advance to the next queued track in both
ordinary and MoQ playback. Account, network, audio-key and decoder failures remain
retryable errors. Skipped tracks retain their full error/stack in **Skipped tracks**
under the transport; the current session retains the latest 50 failures until
cleared. If no playable entries remain, playback stops with the final error.

### Table columns

Track tables share browser-local column preferences. Drag a vertical divider
anywhere down the table with a mouse or touch to resize its left column; focused
dividers also accept arrow keys (Shift for larger steps). Right-click or hold a
header to hide it, restore another column, or reset the layout. Widths and
visibility restore from localStorage on startup, including playlist and search
**Columns** menus. At least one data column stays visible. Preferences belong to
this browser and do not change another listener's layout.
