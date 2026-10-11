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
- Rust 1.95 or newer and a native compiler toolchain when building jmmp, or
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
