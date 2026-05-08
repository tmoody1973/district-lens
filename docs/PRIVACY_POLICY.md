# DistrictLens Privacy Policy

> Canonical decisions live in [DECISIONS_LOG.md](./DECISIONS_LOG.md) §4.3. This document is the public-facing explanation of what DistrictLens does with your address when you ask "what district am I in?"

**Last updated:** 2026-05-08

DistrictLens is a civic-information tool. Tools that ask for addresses can become surveillance vectors if the addresses are handled carelessly, so this policy describes what the tool actually stores, what it does not store, and how long it keeps things.

## What you give us

To look up a congressional district, you can enter a full street address, a ZIP code, or geographic coordinates. The tool uses that input to identify which 2026 congressional race applies to your location.

## What we store

Each district lookup creates a record in a MongoDB collection called `district_lookups`. The record contains:

| Field | What it is |
|---|---|
| `lookup_hash` | A salted SHA-256 hash of your normalized address. The salt is held server-side and is not in the codebase. The hash cannot be reversed to recover your address. |
| `field_set` | Which Geocod.io boundary fields were requested (`cd120` for 2026-election boundaries, `cd` for current 119th Congress boundaries). |
| `cycle` | The election cycle, for example `2026`. |
| `returned_districts` | The congressional districts and their proportions for ZIP-only lookups. |
| `boundary_source` | Whether the result used 2026-election boundaries or current boundaries. |
| `retrieved_at` | When the lookup was made. |
| Truncated coordinates | Latitude and longitude rounded to 2 decimal places, roughly 1 km precision. Used only as a cache key, not for personal identification. |

## What we do not store

Raw street addresses are never stored. Addresses are normalized (lowercase, USPS-style standardization), salted, and SHA-256 hashed before any database write. Precise coordinates are never stored either; latitude and longitude are truncated to 2 decimals before storage.

Logs do not contain address fields. A logging filter strips any field matching the patterns `address`, `street`, `zip`, `coordinates`, or `email` from log output. Logs may reference `lookup_hash`, which is opaque.

## What signed-in users can save

If you create an optional account through Clerk, you can save districts and briefs. A saved-district record stores a reference to the resolved race (for example, `2026-H-NY-04`) and your account ID with a label you choose. It does not store the address you used to resolve the race. When you come back later, the saved race renders directly. The original address is never needed again and is never persisted on your account.

## How long we keep things

| Record type | Retention |
|---|---|
| District lookup with current 2026 boundaries (`cd120`) | 30 days |
| District lookup where 2026 boundaries weren't yet published | 7 days, so the lookup retries weekly as states publish maps |
| Saved districts (signed-in users) | Until you delete them |
| Logs | Per platform default (Cloud Logging) |

## What we do not do

The tool does not sell or share lookup data with third parties. It does not track which races you read about. It does not associate lookup activity with identity for anonymous public users. It does not run analytics that identify individual users.

## Contact

If you have a privacy concern, file an issue on the public GitHub repository or contact the maintainer (see [MAINTAINER_DISCLOSURE.md](./MAINTAINER_DISCLOSURE.md)).
