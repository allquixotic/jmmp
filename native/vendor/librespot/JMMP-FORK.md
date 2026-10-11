# jmmp internal librespot fork

Upstream: https://github.com/librespot-org/librespot
Baseline: v0.8.0, commit d36f9f1907e8cc9d68a93f8ebc6b627b1bf7267d.
License: MIT (original LICENSE retained).

Maintained in this repository. Changes are restricted to direct dependency
upgrades and source compatibility repairs required by those upgrades. jmmp's
integration lives outside this tree. No credentials or deployment settings
belong here.

All direct registry dependencies, including optional, development and build
dependencies, were upgraded to their latest stable releases on 2026-10-11.

Compatibility repairs cover rand 0.10, reqwest 0.13 / oauth2 5, digest 0.11,
AES 0.9, Quick XML 0.42, Symphonia 0.6, vergen 10 and rodio 0.22 / CPAL 0.18.
SHA-1 RSA verification retains the original DER DigestInfo prefix despite
rsa's older digest trait version. Headless and rodio builds and workspace
library tests are checked. jmmp uses only core/audio/metadata, with Rustls.

The sibling CPAL and rodio copies are minimal compatibility patches: CPAL's
Linux ALSA dependencies must match librespot's upgraded ALSA 0.12, and rodio
must use CPAL 0.18's current stream/error interfaces. Cargo patches in this
workspace select those copies. Cargo.toml.orig files retain upstream archive
provenance; Cargo.toml is the effective patched manifest.
