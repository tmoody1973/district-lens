# resolve_job.tf — P1 daily nominee-resolution job (Job B).
# The MONGODB_URI secret and the shared notification channel are declared in
# refresh_job.tf — they are referenced here, never redeclared.
# The PERPLEXITY_API_KEY secret pre-exists as "districtlens-perplexity-key" and
# is read-only referenced via a data source (the value must never live in git).

data "google_secret_manager_secret" "perplexity" {
  secret_id = "districtlens-perplexity-key"
  project   = var.project_id
}

resource "google_service_account" "resolve_job_sa" {
  account_id   = "resolve-nominees-job"
  display_name = "DistrictLens resolve nominees job"
  project      = var.project_id
}

resource "google_secret_manager_secret_iam_member" "resolve_job_mongodb" {
  secret_id = google_secret_manager_secret.mongodb_uri.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.resolve_job_sa.email}"
}

resource "google_secret_manager_secret_iam_member" "resolve_job_perplexity" {
  secret_id = data.google_secret_manager_secret.perplexity.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.resolve_job_sa.email}"
}

resource "google_cloud_run_v2_job" "resolve_nominees" {
  name                = "${var.project_name}-resolve-nominees"
  location            = var.region
  project             = var.project_id
  deletion_protection = false

  template {
    template {
      service_account = google_service_account.resolve_job_sa.email
      max_retries     = 1
      timeout         = "3600s"

      containers {
        # Placeholder; the real image is pushed via gcloud in the deploy phase.
        image   = "us-docker.pkg.dev/cloudrun/container/hello"
        command = ["uv", "run", "python", "-m", "app.jobs.resolve_nominees"]

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
    google_secret_manager_secret_iam_member.resolve_job_mongodb,
    google_secret_manager_secret_iam_member.resolve_job_perplexity,
  ]
}

resource "google_service_account" "resolve_scheduler_sa" {
  account_id   = "resolve-scheduler"
  display_name = "DistrictLens resolve nominees scheduler"
  project      = var.project_id
}

resource "google_cloud_run_v2_job_iam_member" "resolve_scheduler_invokes_job" {
  name     = google_cloud_run_v2_job.resolve_nominees.name
  location = var.region
  project  = var.project_id
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.resolve_scheduler_sa.email}"
}

resource "google_cloud_scheduler_job" "resolve_nominees_daily" {
  name      = "resolve-nominees-daily"
  project   = var.project_id
  region    = var.region
  schedule  = "0 10 * * *" # Daily 10:00 UTC
  time_zone = "Etc/UTC"
  # Covers only the Admin API round-trip that enqueues the execution, not the
  # job's own runtime (the :run endpoint returns immediately).
  attempt_deadline = "320s"

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.resolve_nominees.name}:run"

    oauth_token {
      service_account_email = google_service_account.resolve_scheduler_sa.email
      # Google-signed access token for the Cloud Run Admin API (*.googleapis.com).
      scope = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [
    google_cloud_run_v2_job_iam_member.resolve_scheduler_invokes_job,
  ]
}

resource "google_monitoring_alert_policy" "resolve_nominees_failed" {
  count        = var.alert_email != "" ? 1 : 0
  project      = var.project_id
  display_name = "Resolve nominees job failed"
  combiner     = "OR"

  conditions {
    display_name = "resolve_nominees failed executions"

    condition_threshold {
      filter          = "resource.type = \"cloud_run_job\" AND resource.labels.job_name = \"${google_cloud_run_v2_job.resolve_nominees.name}\" AND metric.type = \"run.googleapis.com/job/completed_execution_count\" AND metric.labels.result = \"failed\""
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
