# CPP Radar Observations

Public, signed observation channel for the Vozniski-Izpit.com CPP Course Radar.

This repository contains only:

- a reviewed registry of public driving-school course pages;
- a bounded browser harvester that respects `robots.txt`;
- a daily GitHub Actions workflow;
- the latest signed observation manifest derived from public course listings.

It contains no WordPress credentials, private application data, personal data or
remote command channel. The manifest is signed with Ed25519 key
`vzi-cpp-radar-2026-01`; the private key exists only as an encrypted repository
secret. WordPress pins the public key, the exact registry SHA-256 and every
rendered document SHA-256 before parsing.

The canonical private application source remains in
`supero48/vozniski-izpit-release`. This public repository is intentionally a
one-way data publication surface.
