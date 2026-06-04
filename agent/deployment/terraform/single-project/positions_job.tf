# positions_job.tf — T3 weekly candidate-positions refresh (Job C).
# Precomputes the priority set's positions into the candidate_positions cache.
# The MONGODB_URI secret + shared notification channel are declared in
# refresh_job.tf; the PERPLEXITY_API_KEY data source is declared in resolve_job.tf.
# Both are referenced here, never redeclared. The FIRECRAWL_API_KEY secret
# pre-exists as "districtlens-firecrawl-api-key" (wired into the service in Phase
# 1 T6) and is read-only referenced via a data source (value never lives in git).

data "google_secret_manager_secret" "firecrawl" {
  secret_id = "districtlens-firecrawl-api-key"
  project   = var.project_id
}

resource "google_service_account" "positions_job_sa" {
  account_id   = "refresh-positions-job"
  display_name = "DistrictLens refresh positions job"
  project      = var.project_id
}

resource "google_secret_manager_secret_iam_member" "positions_job_mongodb" {
  secret_id = google_secret_manager_secret.mongodb_uri.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.positions_job_sa.email}"
}

resource "google_secret_manager_secret_iam_member" "positions_job_perplexity" {
  secret_id = data.google_secret_manager_secret.perplexity.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.positions_job_sa.email}"
}

resource "google_secret_manager_secret_iam_member" "positions_job_firecrawl" {
  secret_id = data.google_secret_manager_secret.firecrawl.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.positions_job_sa.email}"
}

# The position extractor calls Gemini via Vertex AI; the job SA needs the same
# aiplatform.user role the agent service SA has (iam.tf app_sa_roles). Without it
# Gemini returns 403 PERMISSION_DENIED and every candidate degrades to empty.
resource "google_project_iam_member" "positions_job_aiplatform" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.positions_job_sa.email}"
}

resource "google_cloud_run_v2_job" "refresh_positions" {
  name                = "${var.project_name}-refresh-positions"
  location            = var.region
  project             = var.project_id
  deletion_protection = false

  template {
    template {
      service_account = google_service_account.positions_job_sa.email
      max_retries     = 1
      timeout         = "3600s"

      containers {
        # Placeholder; the real image is pushed via gcloud in the deploy phase.
        image   = "us-docker.pkg.dev/cloudrun/container/hello"
        command = ["uv", "run", "python", "-m", "app.jobs.refresh_positions"]

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
          name = "PERPLEXITY_API_KEY"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.perplexity.secret_id
              version = "latest"
            }
          }
        }

        env {
          name = "FIRECRAWL_API_KEY"
          value_source {
            secret_key_ref {
              secret  = data.google_secret_manager_secret.firecrawl.secret_id
              version = "latest"
            }
          }
        }

        # Firecrawl budget guard (see app/jobs/refresh_positions.py): deep→shallow
        # downgrade once monthly spend crosses downgrade_pct of the cap. The cap
        # tracks the $20/mo plan (5,000 credits); override without a redeploy.
        env {
          name  = "FIRECRAWL_MONTHLY_CAP"
          value = "5000"
        }

        env {
          name  = "FIRECRAWL_DOWNGRADE_PCT"
          value = "0.8"
        }

        # Gemini (Vertex) config for the per-issue position extractor — without
        # these the extract step raises "GOOGLE_CLOUD_PROJECT not set" and every
        # candidate degrades to no_positions_found. Mirrors the service (service.tf).
        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }

        env {
          name  = "GOOGLE_CLOUD_LOCATION"
          value = "global"
        }

        env {
          name  = "GOOGLE_GENAI_USE_VERTEXAI"
          value = "True"
        }

        env {
          name  = "REFRESH_TRIGGER"
          value = "scheduled"
        }
      }
    }
  }

  # The image is deployed out of band via gcloud (mirrors the existing service).
  # client/client_version are metadata gcloud stamps on every `--image` update;
  # ignore them so out-of-band image deploys don't show as perpetual TF drift.
  lifecycle {
    ignore_changes = [
      template[0].template[0].containers[0].image,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_project_service.services,
    google_secret_manager_secret_iam_member.positions_job_mongodb,
    google_secret_manager_secret_iam_member.positions_job_perplexity,
    google_secret_manager_secret_iam_member.positions_job_firecrawl,
    google_project_iam_member.positions_job_aiplatform,
  ]
}

resource "google_service_account" "positions_scheduler_sa" {
  account_id   = "positions-scheduler"
  display_name = "DistrictLens refresh positions scheduler"
  project      = var.project_id
}

resource "google_cloud_run_v2_job_iam_member" "positions_scheduler_invokes_job" {
  name     = google_cloud_run_v2_job.refresh_positions.name
  location = var.region
  project  = var.project_id
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.positions_scheduler_sa.email}"
}

resource "google_cloud_scheduler_job" "refresh_positions_weekly" {
  name      = "refresh-positions-weekly"
  project   = var.project_id
  region    = var.region
  schedule  = "0 11 * * 1" # Mondays 11:00 UTC
  time_zone = "Etc/UTC"
  # Covers only the Admin API round-trip that enqueues the execution, not the
  # job's own runtime (the :run endpoint returns immediately).
  attempt_deadline = "320s"

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.refresh_positions.name}:run"

    oauth_token {
      service_account_email = google_service_account.positions_scheduler_sa.email
      # Google-signed access token for the Cloud Run Admin API (*.googleapis.com).
      scope = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [
    google_cloud_run_v2_job_iam_member.positions_scheduler_invokes_job,
  ]
}

resource "google_monitoring_alert_policy" "refresh_positions_failed" {
  count        = var.alert_email != "" ? 1 : 0
  project      = var.project_id
  display_name = "Refresh positions job failed"
  combiner     = "OR"

  conditions {
    display_name = "refresh_positions failed executions"

    condition_threshold {
      filter          = "resource.type = \"cloud_run_job\" AND resource.labels.job_name = \"${google_cloud_run_v2_job.refresh_positions.name}\" AND metric.type = \"run.googleapis.com/job/completed_execution_count\" AND metric.labels.result = \"failed\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period   = "3600s"
        per_series_aligner = "ALIGN_COUNT"
      }
    }
  }

  notification_channels = google_monitoring_notification_channel.refresh_alert_email[*].id
}
