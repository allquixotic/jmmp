# jmmp

jmmp is a minimal, self-hosted music player for people who want one private
library interface across local browser files, S3-compatible storage, and Qobuz.

The client is a Quasar v2 / Vue 3 PWA. It streams and decodes audio in the
browser and supports real-time pitch, tempo, and speed shifting through
SoundTouchJS in an AudioWorklet. The server runs on Bun, stores state in sqlite,
and uses passkeys for authentication.

## Features

- Passkey-only login with a one-time bootstrap token for first setup.
- Local browser folder sources using the File System Access API.
- S3-compatible source support for AWS S3, MinIO, and similar services.
- Qobuz source support through browser OAuth.
- Library browsing, search, playlists, queue, listening history, and album art.
- Browser-side audio cache controls and offline-aware playback behavior.
- Optional Tailscale HTTPS auto-detection for tailnet deployments.
- Single-binary builds that embed the production PWA.

## Requirements

- Bun 1.1 or newer.
- A browser with passkey support.
- Chromium-based browser support for local folder sources.
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

Local browser sources are selected from the client and remain bound to that
browser profile. The folder handle never leaves the device.

S3 sources need an endpoint, region, bucket, optional prefix, and access keys.
jmmp can use path-style URLs for MinIO and other S3-compatible services.

Qobuz sources are added through the web UI. jmmp opens Qobuz login in a browser
window and stores only the resulting auth token, encrypted with the local machine
key.

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

The binaries are written to `dist/`, which is ignored by git.

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

## Deployment Helpers

`share/jmmp.service` is a systemd unit example for Linux. `share/com.jmmp.plist`
is a launchd example for macOS. Adjust paths, users, and config locations for
your environment before installing either one.

## License

jmmp is licensed under the Apache License, Version 2.0. See `LICENSE`.
