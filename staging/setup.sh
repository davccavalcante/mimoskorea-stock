#!/usr/bin/env bash
# =============================================================================
# Create (or reset) the local staging store and connect the studio to it.
# =============================================================================
# 1. Downloads the latest WooCommerce release zip from GitHub (works even when
#    wordpress.org is not reachable).
# 2. Starts WordPress + MariaDB + WooCommerce with Docker Compose.
# 3. Creates an Application Password for the studio.
# 4. Seeds a mirror of the production catalogue (categories, brands, products).
# 5. Writes ../studio/.env.local for testing (mock AI, real staging store).
#
# Usage:
#   ./setup.sh            # create or update
#   ./setup.sh --reset    # destroy volumes and start from scratch
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p .cache
PORT="${WP_PORT:-8080}"
URL="http://localhost:${PORT}"

# ----------------------------------------------------------------------------- reset
if [[ "${1:-}" == "--reset" ]]; then
  docker compose down -v --remove-orphans
fi

# ----------------------------------------------------------------------------- WooCommerce zip
if [[ ! -s .cache/woocommerce.zip ]]; then
  echo "Downloading WooCommerce (latest GitHub release)..."
  curl -fsSL -o .cache/woocommerce.zip https://github.com/woocommerce/woocommerce/releases/latest/download/woocommerce.zip
fi
chmod a+r .cache/woocommerce.zip
chmod a+rwx .cache

# ----------------------------------------------------------------------------- start
docker compose up -d db wordpress
docker compose run --rm setup

APP_PASSWORD="$(tr -d '[:space:]' < .cache/app-password.txt)"
if [[ -z "$APP_PASSWORD" ]]; then
  echo "Could not create the application password" >&2
  exit 1
fi

# ----------------------------------------------------------------------------- wait for the REST API
for _ in $(seq 1 60); do
  if curl -fsS --noproxy '*' -u "admin:${APP_PASSWORD}" "${URL}/wp-json/wc/v3/products?per_page=1" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# ----------------------------------------------------------------------------- seed
STAGING_URL="$URL" STAGING_USER=admin STAGING_APP_PASSWORD="$APP_PASSWORD" python3 seed_from_snapshot.py

# ----------------------------------------------------------------------------- studio config
ENV_FILE=../studio/.env.local
if [[ -f "$ENV_FILE" ]] && ! grep -q "^# managed-by: staging/setup.sh" "$ENV_FILE"; then
  echo "Keeping your existing $ENV_FILE (not managed by this script)."
  echo "Staging credentials: WC_BASE_URL=${URL} WP_USERNAME=admin WP_APPLICATION_PASSWORD=${APP_PASSWORD}"
else
  cat > "$ENV_FILE" <<EOF
# managed-by: staging/setup.sh (test configuration: mock AI + local staging store)
STUDIO_PROVIDERS=mock
STUDIO_CATALOG=woocommerce
STUDIO_DATA_DIR=.data
WC_BASE_URL=${URL}
WP_USERNAME=admin
WP_APPLICATION_PASSWORD=${APP_PASSWORD}
EOF
  echo "Wrote ${ENV_FILE}"
fi

echo
echo "Staging store: ${URL}  (wp-admin: admin / admin-staging-only)"
