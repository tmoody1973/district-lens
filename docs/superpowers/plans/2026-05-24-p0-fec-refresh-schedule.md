# P0 — Scheduled FEC Refresh Job Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the existing idempotent FEC bulk importer on a weekly Cloud Scheduler cron via a Cloud Run Job, so the frozen 2026-05-14 snapshot stays fresh unattended, with an auditable `refresh_runs` record and a failure alert.

**Architecture:** A thin Python job entrypoint (`app/jobs/refresh_fec.py`) wraps the unchanged `scripts/ingest_fec.py::run_import`, recording a `refresh_runs` audit doc (running → completed/failed) and exiting non-zero on failure. Infrastructure (Cloud Run Job, Cloud Scheduler, Secret Manager secret + IAM, failure alert) is defined in Terraform under `agent/deployment/terraform/single-project/`, matching the existing service/SA/bucket IaC. The container image is built and pushed via gcloud (Terraform ignores image changes, mirroring the existing service).

**Tech Stack:** Python 3.11+ (uv, pytest), pymongo, Google Cloud Run Jobs, Cloud Scheduler, Secret Manager, Cloud Monitoring, Terraform (google provider).

**Design reference:** `docs/plans/2026-05-24-data-refresh-design.md` (this is Phase P0 of that design — Job A only; Job B / nominee resolution is P1).

**Scope boundary:** This plan covers Job A (the `refresh_fec` schedule) ONLY. It does NOT create `race_status`, `primary_calendar`, `results_citations`, `race_status_events`, the Perplexity nominee-resolution step, or any journalist surface — those are P1/P2.

---

## Pre-flight facts (already verified in the worktree)

- `from scripts.ingest_fec import run_import` imports cleanly from `agent/` (pythonpath="."); `run_import(mongo_uri)` returns a counts dict.
- `python-dotenv` resolves (transitive dep); `ingest_fec.py`'s module-level `load_dotenv(...)` no-ops when the file is absent (as in the container).
- The agent `Dockerfile` copies only `./app`, NOT `./scripts` — so the importer is NOT in the deployed image today. Task 2 fixes this.
- Deployment pattern: Terraform owns infra (`deployment/terraform/single-project/service.tf` defines the service with `lifecycle { ignore_changes = [template[0].containers[0].image] }`); the image is deployed via gcloud out of band.
- Baseline: `cd agent && uv run pytest tests/unit -q` → 38 passed.
- Project: `civicsync-440613`, region `us-central1`. Terraform var names in use: `var.project_id`, `var.region`, `var.project_name`, and service account `google_service_account.app_sa`.

---

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `agent/app/jobs/__init__.py` | Create | Package marker for job entrypoints. |
| `agent/app/jobs/refresh_fec.py` | Create | Job entrypoint: wrap `run_import`, write `refresh_runs` audit, exit code semantics. |
| `agent/tests/unit/test_refresh_fec_job.py` | Create | Unit tests (DI fakes, no DB/network). |
| `agent/scripts/__init__.py` | Create | Make `scripts` an explicit package for `import scripts.ingest_fec`. |
| `agent/Dockerfile` | Modify | Add `COPY ./scripts ./scripts` so the image contains the importer. |
| `agent/deployment/terraform/single-project/refresh_job.tf` | Create | Cloud Run Job, job SA, secret + accessor IAM, scheduler, scheduler SA + invoker, failure alert, alert-channel var. |
| `agent/deployment/terraform/single-project/apis.tf` | Modify (if needed) | Ensure secretmanager / cloudscheduler / monitoring APIs enabled. |

---

## Task 0: Verify current MONGODB_URI delivery and enabled APIs

This determines whether Task 3 *creates* the Secret Manager secret or *imports* an existing one. Read-only investigation; no commits.

- [ ] **Step 1: Check whether the running service uses a Secret Manager secret or a plain env var for MONGODB_URI**

Run (requires gcloud auth to `civicsync-440613`; if you are not authed, ask the user to run it via `! <command>`):
```bash
gcloud run services describe districtlens-agent --region us-central1 --project civicsync-440613 \
  --format='yaml(spec.template.spec.containers[0].env)' 2>/dev/null
gcloud secrets list --project civicsync-440613 --filter='name~mongodb' --format='value(name)' 2>/dev/null
```
Expected: either an `env` entry named `MONGODB_URI` with a `valueFrom.secretKeyRef` (→ secret already exists, note its `secret_id`), or a plain `value`/`--set-env-vars` (→ no secret yet, Task 3 creates one).

- [ ] **Step 2: Check which APIs are enabled**

Run:
```bash
gcloud services list --enabled --project civicsync-440613 \
  --filter='config.name:(secretmanager.googleapis.com OR cloudscheduler.googleapis.com OR monitoring.googleapis.com OR run.googleapis.com)' \
  --format='value(config.name)'
```
Record which of the four are missing — Task 3/5/6 add any missing ones to `apis.tf`.

- [ ] **Step 3: Record findings inline**

Write a one-line note at the top of `refresh_job.tf` (created in Task 4) stating whether the secret pre-existed (and its id) or is newly created. No commit yet.

---

## Task 1: Job entrypoint module (`app/jobs/refresh_fec.py`) — TDD

**Files:**
- Create: `agent/app/jobs/__init__.py`
- Create: `agent/app/jobs/refresh_fec.py`
- Test: `agent/tests/unit/test_refresh_fec_job.py`

All commands run from `agent/`.

- [ ] **Step 1: Write the failing tests**

Create `agent/tests/unit/test_refresh_fec_job.py`:
```python
"""Unit tests for the scheduled FEC refresh job entrypoint."""

import pytest

from app.jobs import refresh_fec


class FakeCollection:
    """Minimal stand-in for a pymongo collection that records writes."""

    def __init__(self):
        self.docs = []

    def insert_one(self, doc):
        self.docs.append(dict(doc))

    def update_one(self, flt, update):
        for d in self.docs:
            if d["run_id"] == flt["run_id"]:
                d.update(update["$set"])


class FakeDB:
    def __init__(self, col):
        self._col = col

    def __getitem__(self, name):
        assert name == "refresh_runs"
        return self._col


class FakeClient:
    def __init__(self, col):
        self._db = FakeDB(col)
        self.closed = False

    def __getitem__(self, name):
        assert name == "districtlens"
        return self._db

    def close(self):
        self.closed = True


@pytest.mark.unit
def test_execute_refresh_writes_start_then_success():
    col = FakeCollection()
    client = FakeClient(col)
    counts = {"races": 503, "candidates": 3900}

    result = refresh_fec.execute_refresh(
        mongo_uri="mongodb://x",
        import_fn=lambda uri: counts,
        client_factory=lambda uri: client,
    )

    assert result["status"] == "completed"
    assert result["counts"] == counts
    assert len(col.docs) == 1
    doc = col.docs[0]
    assert doc["job_name"] == "refresh_fec"
    assert doc["trigger"] == "scheduled"
    assert doc["status"] == "completed"
    assert doc["counts"] == counts
    assert doc["completed_at"] is not None
    assert client.closed is True


@pytest.mark.unit
def test_execute_refresh_records_failure_and_reraises():
    col = FakeCollection()
    client = FakeClient(col)

    def boom(uri):
        raise RuntimeError("download failed")

    with pytest.raises(RuntimeError, match="download failed"):
        refresh_fec.execute_refresh(
            mongo_uri="mongodb://x",
            import_fn=boom,
            client_factory=lambda uri: client,
        )

    assert len(col.docs) == 1
    doc = col.docs[0]
    assert doc["status"] == "failed"
    assert doc["error"] == "download failed"
    assert doc["completed_at"] is not None
    assert client.closed is True


@pytest.mark.unit
def test_main_returns_1_when_uri_missing(monkeypatch):
    monkeypatch.delenv("MONGODB_URI", raising=False)
    assert refresh_fec.main() == 1


@pytest.mark.unit
def test_main_returns_0_on_success(monkeypatch):
    monkeypatch.setenv("MONGODB_URI", "mongodb://x")
    monkeypatch.setattr(refresh_fec, "execute_refresh", lambda **kw: {"status": "completed"})
    assert refresh_fec.main() == 0


@pytest.mark.unit
def test_main_returns_1_on_failure(monkeypatch):
    monkeypatch.setenv("MONGODB_URI", "mongodb://x")

    def boom(**kw):
        raise RuntimeError("x")

    monkeypatch.setattr(refresh_fec, "execute_refresh", boom)
    assert refresh_fec.main() == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/unit/test_refresh_fec_job.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.jobs'`.

- [ ] **Step 3: Create the package marker**

Create `agent/app/jobs/__init__.py` (empty file):
```python
```

- [ ] **Step 4: Implement the entrypoint**

Create `agent/app/jobs/refresh_fec.py`:
```python
"""Scheduled Cloud Run Job entrypoint: re-run the FEC bulk import and audit it.

Wraps the existing idempotent importer (scripts/ingest_fec.py::run_import) so a
Cloud Scheduler-triggered Cloud Run Job can refresh the FEC snapshot on a cron
and leave an auditable record in the refresh_runs collection. This is Job A
(P0) of docs/plans/2026-05-24-data-refresh-design.md.
"""

from __future__ import annotations

import logging
import os
import uuid
from collections.abc import Callable
from datetime import UTC, datetime

import pymongo

from scripts.ingest_fec import run_import

logger = logging.getLogger(__name__)

JOB_NAME = "refresh_fec"


def _utcnow() -> datetime:
    return datetime.now(UTC)


def execute_refresh(
    *,
    mongo_uri: str,
    trigger: str = "scheduled",
    import_fn: Callable[[str], dict[str, int]] = run_import,
    client_factory: Callable[[str], pymongo.MongoClient] = pymongo.MongoClient,
    now_fn: Callable[[], datetime] = _utcnow,
) -> dict:
    """Run the FEC import and record a refresh_runs audit doc.

    Writes a `running` doc before the import, then updates it to `completed`
    (with counts) or `failed` (with the error). Re-raises on failure so the
    process exits non-zero and Cloud Run marks the execution failed.
    """
    run_id = uuid.uuid4().hex
    started_at = now_fn()
    client = client_factory(mongo_uri)
    runs_col = client["districtlens"]["refresh_runs"]

    runs_col.insert_one(
        {
            "run_id": run_id,
            "job_name": JOB_NAME,
            "trigger": trigger,
            "status": "running",
            "started_at": started_at,
            "completed_at": None,
            "counts": None,
            "error": None,
        }
    )

    try:
        counts = import_fn(mongo_uri)
    except Exception as exc:
        runs_col.update_one(
            {"run_id": run_id},
            {"$set": {"status": "failed", "completed_at": now_fn(), "error": str(exc)}},
        )
        logger.exception("refresh_fec run %s failed", run_id)
        client.close()
        raise

    runs_col.update_one(
        {"run_id": run_id},
        {"$set": {"status": "completed", "completed_at": now_fn(), "counts": counts}},
    )
    logger.info("refresh_fec run %s completed: %s", run_id, counts)
    client.close()
    return {"run_id": run_id, "status": "completed", "counts": counts}


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    mongo_uri = os.environ.get("MONGODB_URI")
    if not mongo_uri:
        logger.error("MONGODB_URI not set; cannot run refresh_fec job")
        return 1
    trigger = os.environ.get("REFRESH_TRIGGER", "scheduled")
    try:
        execute_refresh(mongo_uri=mongo_uri, trigger=trigger)
    except Exception:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/unit/test_refresh_fec_job.py -q`
Expected: PASS (5 passed).

- [ ] **Step 6: Run the full unit suite + lint**

Run: `uv run pytest tests/unit -q && uvx ruff check app/jobs scripts tests/unit/test_refresh_fec_job.py`
Expected: 43 passed (38 baseline + 5 new); ruff clean.

- [ ] **Step 7: Commit**

```bash
git add app/jobs/__init__.py app/jobs/refresh_fec.py tests/unit/test_refresh_fec_job.py
git commit -m "feat(agent): refresh_fec job entrypoint with refresh_runs audit"
```

---

## Task 2: Package the importer into the container image

**Files:**
- Create: `agent/scripts/__init__.py`
- Modify: `agent/Dockerfile`

- [ ] **Step 1: Make `scripts` an explicit package**

Create `agent/scripts/__init__.py` (empty file):
```python
```

- [ ] **Step 2: Verify the direct CLI invocation still imports**

Run: `uv run python -c "import scripts.ingest_fec as m; print(hasattr(m, 'run_import'))"`
Expected: `True`.

- [ ] **Step 3: Add scripts to the image**

In `agent/Dockerfile`, find the line:
```dockerfile
COPY ./app ./app
```
Add immediately after it:
```dockerfile
COPY ./scripts ./scripts
```

- [ ] **Step 4: Smoke-test the entrypoint locally (missing URI path)**

Run: `env -u MONGODB_URI uv run python -m app.jobs.refresh_fec; echo "exit=$?"`
Expected: logs `MONGODB_URI not set; cannot run refresh_fec job` and `exit=1`.

- [ ] **Step 5: Commit**

```bash
git add scripts/__init__.py Dockerfile
git commit -m "build(agent): package scripts/ into the image for the refresh job"
```

---

## Task 3: Secret Manager secret for MONGODB_URI (Terraform)

Branch on Task 0 Step 1:
- **If a `mongodb`-related secret already exists**, you will reference it and `terraform import` it (Step 4 below).
- **If no secret exists**, Terraform creates the container; you add the value out of band.

**Files:**
- Create (part of): `agent/deployment/terraform/single-project/refresh_job.tf`
- Modify (if Task 0 found it missing): `agent/deployment/terraform/single-project/apis.tf`

All Terraform commands run from `agent/deployment/terraform/single-project/`.

- [ ] **Step 1: Ensure the Secret Manager API is enabled in Terraform**

Open `apis.tf`. If `secretmanager.googleapis.com` is not in the enabled-services list, add it to that list (follow the existing list's exact syntax — likely a `for_each`/`toset` of service strings or repeated `google_project_service` blocks). Do the same for `cloudscheduler.googleapis.com` and `monitoring.googleapis.com` (needed by Tasks 5–6).

- [ ] **Step 2: Declare the secret resource**

Create `agent/deployment/terraform/single-project/refresh_job.tf` with this header note (fill in the Task 0 finding) and the secret block:
```hcl
# refresh_job.tf — P0 scheduled FEC refresh (Job A).
# Task 0 finding: MONGODB_URI secret pre-existed = <YES: secret_id=... | NO: created here>.

resource "google_secret_manager_secret" "mongodb_uri" {
  secret_id = "mongodb-uri"
  project   = var.project_id

  replication {
    auto {}
  }
}
```
> The secret VERSION (the real Atlas connection string) is never committed. Add it out of band:
> `printf '%s' "<ATLAS_URI>" | gcloud secrets versions add mongodb-uri --data-file=- --project=civicsync-440613`

- [ ] **Step 3: Format and validate**

Run: `terraform fmt && terraform validate`
Expected: validation succeeds.

- [ ] **Step 4: If the secret already existed, import it instead of creating a duplicate**

Only if Task 0 found an existing secret whose id differs from `mongodb-uri`: change `secret_id` to match the existing one, then:
```bash
terraform import google_secret_manager_secret.mongodb_uri projects/civicsync-440613/secrets/<existing-secret-id>
```
Expected: import succeeds, subsequent `terraform plan` shows no destroy/recreate of the secret.

- [ ] **Step 5: Commit (Terraform source only — no secret value)**

```bash
git add deployment/terraform/single-project/refresh_job.tf deployment/terraform/single-project/apis.tf
git commit -m "infra: declare mongodb-uri secret + enable refresh-job APIs"
```

---

## Task 4: Cloud Run Job + job service account + secret IAM (Terraform)

**Files:**
- Modify: `agent/deployment/terraform/single-project/refresh_job.tf`

- [ ] **Step 1: Add the job service account and secret accessor binding**

Append to `refresh_job.tf`:
```hcl
resource "google_service_account" "refresh_job_sa" {
  account_id   = "refresh-fec-job"
  display_name = "DistrictLens FEC refresh job"
  project      = var.project_id
}

resource "google_secret_manager_secret_iam_member" "refresh_job_mongodb" {
  secret_id = google_secret_manager_secret.mongodb_uri.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.refresh_job_sa.email}"
}
```

- [ ] **Step 2: Add the Cloud Run Job**

Append to `refresh_job.tf`:
```hcl
resource "google_cloud_run_v2_job" "refresh_fec" {
  name                = "${var.project_name}-refresh-fec"
  location            = var.region
  project             = var.project_id
  deletion_protection = false

  template {
    template {
      service_account = google_service_account.refresh_job_sa.email
      max_retries     = 1
      timeout         = "1800s"

      containers {
        # Placeholder; the real image is pushed via gcloud (see Task 7).
        image   = "us-docker.pkg.dev/cloudrun/container/hello"
        command = ["uv", "run", "python", "-m", "app.jobs.refresh_fec"]

        resources {
          limits = {
            cpu    = "1"
            memory = "2Gi"
          }
        }

        env {
          name = "MONGODB_URI"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.mongodb_uri.secret_id
              version = "latest"
            }
          }
        }

        env {
          name  = "REFRESH_TRIGGER"
          value = "scheduled"
        }
      }
    }
  }

  # Mirror the service: image is deployed out of band via gcloud.
  lifecycle {
    ignore_changes = [
      template[0].template[0].containers[0].image,
    ]
  }

  depends_on = [
    google_project_service.services,
    google_secret_manager_secret_iam_member.refresh_job_mongodb,
  ]
}
```
> Note: `google_project_service.services` is the assumed name of the existing API-enablement resource. If `apis.tf` names it differently, match that name here.

- [ ] **Step 3: Format and validate**

Run: `terraform fmt && terraform validate`
Expected: validation succeeds.

- [ ] **Step 4: Commit**

```bash
git add deployment/terraform/single-project/refresh_job.tf
git commit -m "infra: refresh_fec Cloud Run Job + job SA + secret accessor"
```

---

## Task 5: Cloud Scheduler + scheduler SA + job invoker (Terraform)

**Files:**
- Modify: `agent/deployment/terraform/single-project/refresh_job.tf`

- [ ] **Step 1: Add the scheduler service account and job-invoke IAM**

Append to `refresh_job.tf`:
```hcl
resource "google_service_account" "refresh_scheduler_sa" {
  account_id   = "refresh-scheduler"
  display_name = "DistrictLens refresh scheduler"
  project      = var.project_id
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_invokes_job" {
  name     = google_cloud_run_v2_job.refresh_fec.name
  location = var.region
  project  = var.project_id
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.refresh_scheduler_sa.email}"
}
```
> If, during Task 7 verification, the scheduler-triggered execution is denied with a permissions error on `run.jobs.run`, change `roles/run.invoker` to `roles/run.developer` and re-apply. (`run.invoker` at the job level normally grants execution; this is the documented fallback.)

- [ ] **Step 2: Add the weekly scheduler job**

Append to `refresh_job.tf`:
```hcl
resource "google_cloud_scheduler_job" "refresh_fec_weekly" {
  name             = "refresh-fec-weekly"
  project          = var.project_id
  region           = var.region
  schedule         = "0 9 * * 1" # Mondays 09:00 UTC
  time_zone        = "Etc/UTC"
  attempt_deadline = "320s"

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.refresh_fec.name}:run"

    oauth_token {
      service_account_email = google_service_account.refresh_scheduler_sa.email
    }
  }

  depends_on = [
    google_cloud_run_v2_job_iam_member.scheduler_invokes_job,
  ]
}
```

- [ ] **Step 3: Format and validate**

Run: `terraform fmt && terraform validate`
Expected: validation succeeds.

- [ ] **Step 4: Commit**

```bash
git add deployment/terraform/single-project/refresh_job.tf
git commit -m "infra: weekly Cloud Scheduler trigger for refresh_fec job"
```

---

## Task 6: Failure alert (Terraform, optional channel)

**Files:**
- Modify: `agent/deployment/terraform/single-project/refresh_job.tf`

- [ ] **Step 1: Add the alert-channel variable and alert policy**

Append to `refresh_job.tf`:
```hcl
variable "alert_notification_channels" {
  description = "Monitoring notification channel IDs for refresh-job failure alerts. Empty disables the alert."
  type        = list(string)
  default     = []
}

resource "google_monitoring_alert_policy" "refresh_fec_failed" {
  count        = length(var.alert_notification_channels) > 0 ? 1 : 0
  project      = var.project_id
  display_name = "FEC refresh job failed"
  combiner     = "OR"

  conditions {
    display_name = "refresh_fec failed executions"

    condition_threshold {
      filter          = "resource.type = \"cloud_run_job\" AND resource.labels.job_name = \"${google_cloud_run_v2_job.refresh_fec.name}\" AND metric.type = \"run.googleapis.com/job/completed_execution_count\" AND metric.labels.result = \"failed\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period   = "3600s"
        per_series_aligner = "ALIGN_COUNT"
      }
    }
  }

  notification_channels = var.alert_notification_channels
}
```
> To enable: create/locate a notification channel (`gcloud beta monitoring channels list --project civicsync-440613`) and pass its id via `-var='alert_notification_channels=["projects/civicsync-440613/notificationChannels/<id>"]'` or a tfvars entry. With the default empty list, the policy is simply not created (count = 0) — apply still succeeds.

- [ ] **Step 2: Format and validate**

Run: `terraform fmt && terraform validate`
Expected: validation succeeds.

- [ ] **Step 3: Commit**

```bash
git add deployment/terraform/single-project/refresh_job.tf
git commit -m "infra: optional failure alert for refresh_fec job"
```

---

## Task 7: Deploy and verify end-to-end (PROD-AFFECTING — confirm with user before each apply/execute)

This task applies Terraform to `civicsync-440613`, pushes the job image, and runs the importer against the production MongoDB. **Stop and get the user's explicit go-ahead before Steps 2, 4, and 6.** Requires gcloud + terraform authed to the project; if the worker is not authed, hand the exact command to the user via `! <command>`.

- [ ] **Step 1: Plan the Terraform changes**

Run (from `agent/deployment/terraform/single-project/`): `terraform plan`
Expected: shows creation of the secret (or no-op if imported), job SA, secret IAM, Cloud Run Job, scheduler SA, job invoker IAM, scheduler job, and (only if a channel var is set) the alert policy. No destroy of existing resources.

- [ ] **Step 2: Apply Terraform (CONFIRM WITH USER FIRST)**

Run: `terraform apply`
Expected: all resources created. The Cloud Run Job exists with the placeholder image.

- [ ] **Step 3: Ensure the secret has a value**

If Task 3 created a new secret, confirm a version exists:
```bash
gcloud secrets versions list mongodb-uri --project civicsync-440613 --format='value(name,state)'
```
Expected: at least one ENABLED version. If none, add it:
`printf '%s' "<ATLAS_URI>" | gcloud secrets versions add mongodb-uri --data-file=- --project=civicsync-440613`

- [ ] **Step 4: Build + push the job image and point the job at it (CONFIRM WITH USER FIRST)**

From `agent/`:
```bash
IMAGE="us-central1-docker.pkg.dev/civicsync-440613/districtlens/refresh-fec:$(git rev-parse --short HEAD)"
gcloud builds submit . --tag "$IMAGE" --project civicsync-440613
gcloud run jobs update districtlens-agent-refresh-fec \
  --image "$IMAGE" --region us-central1 --project civicsync-440613
```
> `gcloud run jobs update --image` changes only the image, so it does not fight Terraform (which ignores image changes). Confirm the Artifact Registry repo path `districtlens` exists; if your repo name differs, adjust `$IMAGE`. (`gcloud artifacts repositories list --project civicsync-440613`.)

- [ ] **Step 5: Capture the pre-run freshness timestamp (to prove the snapshot un-freezes)**

```bash
# Replace with your actual mongosh/Atlas connection; read-only check.
# Note the current max last_checked_at across races BEFORE running the job.
```
Expected: races currently show `last_checked_at` around 2026-05-14.

- [ ] **Step 6: Execute the job once and verify (CONFIRM WITH USER FIRST)**

```bash
gcloud run jobs execute districtlens-agent-refresh-fec \
  --region us-central1 --project civicsync-440613 --wait
```
Expected: execution succeeds (exit 0). Then verify in MongoDB:
- `refresh_runs` has a doc with `job_name="refresh_fec"`, `trigger="scheduled"`, `status="completed"`, non-null `counts`.
- `official_import_batches` has a new batch dated today.
- `races` `last_checked_at` has advanced to today's date (the frozen snapshot is now refreshed — **this is the P0 success criterion**).

- [ ] **Step 7: Verify the scheduler can trigger the job**

```bash
gcloud scheduler jobs run refresh-fec-weekly --location us-central1 --project civicsync-440613
gcloud run jobs executions list --job districtlens-agent-refresh-fec \
  --region us-central1 --project civicsync-440613 --limit 2
```
Expected: a new execution appears, triggered by the scheduler, and completes successfully. (If denied on `run.jobs.run`, apply the Task 5 Step 1 fallback role and retry.)

- [ ] **Step 8: Final commit (if any var files or repo-path adjustments changed)**

```bash
git add -A
git commit -m "infra: wire refresh_fec image build + scheduler verification notes"
```

---

## Self-Review

**Spec coverage (against P0 scope in the design doc):**
- "Job A on Cloud Scheduler" → Tasks 4 (Job) + 5 (Scheduler). ✓
- "Cloud Run Job wrapper" → Task 1 (entrypoint) + Task 2 (image packaging). ✓
- "Secret Manager wiring" → Task 3 (secret) + Task 4 (accessor IAM + secret env). ✓
- "refresh_runs audit" → Task 1 (`execute_refresh` writes running→completed/failed). ✓
- "Tests" → Task 1 Step 1 (5 unit tests, DI fakes, no I/O). ✓
- "Kills the frozen snapshot" → Task 7 Step 6 success criterion (`last_checked_at` advances). ✓
- Failure monitoring (design §Failure handling) → Task 6. ✓

**Out of scope (correctly absent):** race_status / primary_calendar / results_citations / race_status_events, Perplexity nominee resolution, journalist surface — all P1/P2.

**Placeholder scan:** No TBD/TODO/"add error handling" placeholders; every code step shows complete code; every command shows expected output. The two intentional fill-ins (Task 0 secret finding, `$IMAGE`/AR repo path) are explicit verification points, not vague placeholders.

**Type/name consistency:** `execute_refresh(**kwargs)` signature matches its call in `main()` and in the tests' `monkeypatch.setattr`. Collection name `refresh_runs`, db `districtlens`, `JOB_NAME="refresh_fec"`, job resource name `${var.project_name}-refresh-fec` (= `districtlens-agent-refresh-fec`), and scheduler `refresh-fec-weekly` are used consistently across Python, Terraform, and gcloud commands.

**Known assumptions to confirm during execution (not blockers):**
- Terraform var names (`var.project_id`, `var.region`, `var.project_name`) and the API-enablement resource name (`google_project_service.services`) — confirm against `variables.tf`/`apis.tf` and adjust references if they differ.
- `run.invoker` suffices to trigger job runs (fallback `run.developer` documented).
- Artifact Registry repo path in `$IMAGE` (confirm via `gcloud artifacts repositories list`).
