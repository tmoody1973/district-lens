# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.


resource "google_cloud_run_v2_service" "app" {
  name                = var.project_name
  location            = var.region
  project             = var.project_id
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"
  labels = {
    "created-by" = "adk"
  }

  template {
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"
      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }
      }

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
        name  = "LOGS_BUCKET_NAME"
        value = google_storage_bucket.logs_data_bucket.name
      }
      env {
        name  = "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"
        value = "NO_CONTENT"
      }
      env {
        name  = "ALLOW_ORIGINS"
        value = "https://districtlens-web-adewe5kxtq-uc.a.run.app,http://localhost:3000"
      }

      env {
        name = "PERPLEXITY_API_KEY"
        value_source {
          secret_key_ref {
            secret  = "districtlens-perplexity-key"
            version = "latest"
          }
        }
      }
      env {
        name = "MONGODB_URI"
        value_source {
          secret_key_ref {
            secret  = "districtlens-mongodb-uri"
            version = "latest"
          }
        }
      }
      env {
        name = "GEOCODIO_API_KEY"
        value_source {
          secret_key_ref {
            secret  = "districtlens-geocodio-api-key"
            version = "latest"
          }
        }
      }
      env {
        name = "INTERNAL_API_TOKEN"
        value_source {
          secret_key_ref {
            secret  = "districtlens-internal-api-token"
            version = "latest"
          }
        }
      }
      env {
        name = "CONGRESS_API_KEY"
        value_source {
          secret_key_ref {
            secret  = "districtlens-congress-api-key"
            version = "latest"
          }
        }
      }
      env {
        name = "ADDRESS_HASH_SALT"
        value_source {
          secret_key_ref {
            secret  = "districtlens-address-hash-salt"
            version = "latest"
          }
        }
      }
    }

    service_account                  = google_service_account.app_sa.email
    max_instance_request_concurrency = 40

    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }

    session_affinity = true
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  # Ignore attributes that gcloud-based deploys manage out of band, so Terraform
  # owns the declared config (env/secrets/resources/scaling) without fighting the
  # deploy pipeline over the image, source-build metadata, or client stamps.
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      build_config,
      client,
      client_version,
    ]
  }

  # Make dependencies conditional to avoid errors.
  depends_on = [
    resource.google_project_service.services,
  ]
}
