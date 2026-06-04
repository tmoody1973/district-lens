# refresh_job.tf — P0 scheduled FEC refresh (Job A).
# The MONGODB_URI secret PRE-EXISTS as "districtlens-mongodb-uri" (replication
# automatic, version 1 enabled). It is imported into Terraform state during the
# deploy phase, not created here. No secret version is declared (the value must
# never live in git).

resource "google_secret_manager_secret" "mongodb_uri" {
  secret_id = "districtlens-mongodb-uri"
  project   = var.project_id

  replication {
    auto {}
  }
}

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
        # Placeholder; the real image is pushed via gcloud in the deploy phase.
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
    google_secret_manager_secret_iam_member.refresh_job_mongodb,
  ]
}

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

resource "google_cloud_scheduler_job" "refresh_fec_weekly" {
  name      = "refresh-fec-weekly"
  project   = var.project_id
  region    = var.region
  schedule  = "0 9 * * 1" # Mondays 09:00 UTC
  time_zone = "Etc/UTC"
  # Covers only the Admin API round-trip that enqueues the execution, not the
  # job's own runtime (the :run endpoint returns immediately).
  attempt_deadline = "320s"

  http_target {
    http_method = "POST"
    uri         = "https://${var.region}-run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.refresh_fec.name}:run"

    oauth_token {
      service_account_email = google_service_account.refresh_scheduler_sa.email
      # Google-signed access token for the Cloud Run Admin API (*.googleapis.com).
      scope = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [
    google_cloud_run_v2_job_iam_member.scheduler_invokes_job,
  ]
}

variable "alert_email" {
  description = "Email for 'FEC refresh job failed' alerts. Empty disables the alert + channel."
  type        = string
  default     = ""
}

resource "google_monitoring_notification_channel" "refresh_alert_email" {
  count        = var.alert_email != "" ? 1 : 0
  project      = var.project_id
  display_name = "DistrictLens refresh alerts"
  type         = "email"

  labels = {
    email_address = var.alert_email
  }
}

resource "google_monitoring_alert_policy" "refresh_fec_failed" {
  count        = var.alert_email != "" ? 1 : 0
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

  notification_channels = google_monitoring_notification_channel.refresh_alert_email[*].id
}
