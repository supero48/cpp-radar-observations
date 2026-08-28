# CPP Radar Observations

Public, signed observation channel for the Vozniski-Izpit.com CPP Course Radar.

This repository contains only:

- a reviewed, versioned registry of public driving-school course pages;
- a bounded browser harvester that respects `robots.txt`;
- a daily GitHub Actions workflow;
- the latest signed observation manifest derived from public course listings.

Manifest v2 binds the canonical source registry and every observation under one
Ed25519 signature using key `vzi-cpp-radar-2026-01`. WordPress 0.1.13 pins the
public key, verifies the registry SHA-256, validates the bounded schema and the
exact observation-to-registry identity, and only then performs audited
create/update/unchanged upserts for approved and enabled sources.

The harvester processes at most 20 approved and enabled sources in one run. At
larger registry sizes it advances through a deterministic daily UTC rotation,
so every source is revisited without allowing one workflow to grow without a
bound. `VZI_CPP_ROTATION_SLOT` can select a deterministic batch for diagnostics.
The signed manifest always carries the full reviewed registry and observations
only for the batch harvested in that run.

The channel cannot delete WordPress sources, execute remote commands, or publish
unreviewed sources. It contains no WordPress credentials, private application
data or personal data. The private signing key exists only as an encrypted
repository secret.

The canonical private application source remains in
`supero48/vozniski-izpit-release`. This public repository is intentionally a
one-way data publication surface.
