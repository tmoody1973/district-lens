# Runbook — Activate district↔city geography (import + deploy)

**Goal:** flip the two new geography features from `not_found` to live:
`find_district_by_city` (reverse city→district) and the `Covers (approx.): …`
line on `lookup_district`.

**Why two steps:** the **data** (`districts` collection) and the **code** (the new
tool + lookup enrichment, committed in `48c6a9b`/`14cc49c`, pushed) are independent.
Both must land. Order doesn't matter, but import-then-deploy means it's live the
moment the deploy finishes.

**Env (from handoffs):** project `civicsync-440613`, region `us-central1`.
`MONGODB_URI` lives in **Secret Manager** (no local `.env`).

---

## Pre-flight

```bash
gcloud auth list                 # authenticated?
gcloud config set project civicsync-440613
ls -lh /Users/tarikmoody/Downloads/us_congressional_districts_2026_cities.json   # source file present
```

---

## Step 1 — Populate the `districts` collection (writes to live Atlas)

The importer is idempotent (upsert by `_id`) and additive (a new collection), so
re-running is safe. It also creates the reverse-lookup indexes.

```bash
# Pull the Mongo URI from Secret Manager into the shell (don't echo it).
# Confirm the secret name first if unsure:  gcloud secrets list | grep -i mongo
export MONGODB_URI="$(gcloud secrets versions access latest \
  --secret=districtlens-mongodb-uri --project=civicsync-440613)"

cd agent

# 1a. Dry-run first — builds all 435 docs, writes nothing.
.venv/bin/python -m scripts.import_district_cities \
  --file /Users/tarikmoody/Downloads/us_congressional_districts_2026_cities.json --dry-run
# expect:  built: 435 ... dry_run: True

# 1b. Real import (writes + creates indexes).
.venv/bin/python -m scripts.import_district_cities \
  --file /Users/tarikmoody/Downloads/us_congressional_districts_2026_cities.json
# expect:  built: 435 ... upserted: 435 (first run) / modified: N (re-run)
```

> If `gcloud secrets list` shows a different name (e.g. `MONGODB_URI`,
> `districtlens-mongo-uri`), use that. The Terraform resource is
> `google_secret_manager_secret.mongodb_uri`.

### Verify the data
```bash
.venv/bin/python - <<'PY'
import os, pymongo
db = pymongo.MongoClient(os.environ["MONGODB_URI"])["districtlens"]
col = db["districts"]
print("docs:", col.count_documents({}))                       # expect 435
print("WI-04:", col.find_one({"_id": "WI-04"}, {"primary_city":1,"correlated_cities.name":1}))
print("Milwaukee in:", [d["_id"] for d in col.find(
    {"correlated_cities.ascii_name": {"$regex":"^Milwaukee$","$options":"i"}}, {"_id":1})])
print("indexes:", list(col.index_information().keys()))       # expect city_ascii_name, state
PY
```

---

## Step 2 — Deploy the agent code

Manual `gcloud` (no CI/CD). Builds from the local `agent/` source — so make sure the
geography commits are in your working tree (they are, on `main`). The `beautifulsoup4`
dep added earlier is already in `pyproject.toml`/`uv.lock`, so the build picks it up.

```bash
cd /Users/tarikmoody/Documents/Projects/districtlens
gcloud run deploy districtlens-agent --source agent \
  --region us-central1 --project civicsync-440613 --quiet
```
This preserves existing env vars + service account (incl. the `MONGODB_URI` secret
binding Terraform set), so no Terraform apply is needed for this change.

---

## Step 3 — Post-deploy smoke test

In the deployed chat (journalist/inline mode):

1. **Reverse lookup:** *"Which congressional district is Milwaukee in?"*
   → expect `find_district_by_city` to return `ok` with WI-04 (+ the approximate-geography warning surfaced). No longer `not_found`.
2. **Coverage line:** run an address lookup (e.g. a Milwaukee street address)
   → the district result should now end with `Covers (approx.): Milwaukee, …`.
3. **Guardrail intact:** the warning text ("a city may span multiple districts") should appear — confirm the agent surfaces it.

---

## Rollback / notes

- **Data:** harmless to leave. To remove: `db.districts.drop()` (the features simply
  revert to `not_found` / no coverage line — no crash).
- **Code:** redeploy the previous revision —
  `gcloud run services update-traffic districtlens-agent --to-revisions=PREVIOUS=100 --region us-central1`.
- **Governance reminder:** this data is approximate context (`is_approximate_geography`),
  never a citable representation claim. The tool labels every response accordingly.
- The data step does **not** need a redeploy; the code step does **not** need the data —
  but the user-visible feature needs both.
```
