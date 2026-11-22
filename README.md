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

The daily workflow processes up to 100 approved and enabled sources in one run. At
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

## Complete school coverage and weekly discovery

The candidate inventory includes every known directory school, including schools
without a verified official website. The public audit reads up to eight relevant
pages per school daily and up to 24 every Monday (UTC). The budget can be
overridden for diagnostics, with an absolute ceiling of 32 pages per school.
It follows public CPP pages, news indexes, registration forms, and text PDFs.
An existing future course never stops exploration of the school's other links.

Unvisited same-site links are persisted under `pending_pages` in
`data/cpp-source-audit.json` and resumed on the next run. School identity and
canonical site URL must still match; authentication links, private parameters,
other schools on a shared Wix host, and blocked hosts cannot enter that queue.
External registration links require a fresh link from a public page.

`data/cpp-coverage.json` and `.csv` record a worklist for every candidate school:
missing websites, unpublished date evidence, missing or stale observations,
unread pages, and access limits. These are discovery leads, not permission to
publish an unverified date. The weekly review refreshes the full directory
roster, finds official websites, checks image-only notices and missing dates,
and adds validated parsers/sources to the signed channel.

The signed-source refresh runs before the longer discovery audit, so discovery
failures do not delay publication of an otherwise valid daily manifest. A
successful manifest is still verified against the actual WordPress public
response and school profiles by the weekly review.
