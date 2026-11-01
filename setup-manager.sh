#!/bin/bash
# setup-manager.sh
# Inserts the azerothcore-manager service into a local copy of the
# AzerothCore WotLK docker-compose.yml so the manager runs alongside
# the server when the manager lives in a subfolder of the WotLK root.
#
# Usage:
#   cd /path/to/azerothcore-wotlk
#   ./azerothcore-manager/setup-manager.sh
#
#   Or from a subfolder:
#   cd /path/to/azerothcore-wotlk/azerothcore-manager
#   ./setup-manager.sh
#
# The script finds docker-compose.yml by walking up from the current
# directory, then inserts the manager service definition before the
# top-level volumes: section (if present) to avoid YAML parsing issues.
# It is idempotent — running it twice will not duplicate the service.

set -euo pipefail

# ── Resolve paths ──────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Walk up from SCRIPT_DIR looking for docker-compose.yml
COMPOSE_FILE=""
SEARCH_DIR="$SCRIPT_DIR"
while [ "$SEARCH_DIR" != "/" ]; do
    if [ -f "$SEARCH_DIR/docker-compose.yml" ]; then
        COMPOSE_FILE="$SEARCH_DIR/docker-compose.yml"
        break
    fi
    SEARCH_DIR="$(dirname "$SEARCH_DIR")"
done

if [ -z "$COMPOSE_FILE" ]; then
    echo "ERROR: docker-compose.yml not found." >&2
    echo "Run this script from within the azerothcore-wotlk tree." >&2
    exit 1
fi

echo "Found docker-compose.yml at: $COMPOSE_FILE"

# ── Load .env file if present ──────────────────────────────────────
# Docker Compose reads .env automatically, but the bash script
# needs it too to know the actual password.
COMPOSE_DIR="$(dirname "$COMPOSE_FILE")"
if [ -f "$COMPOSE_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$COMPOSE_DIR/.env"
    set +a
    echo "Loaded .env from $COMPOSE_DIR"
fi

# ── Check if already inserted ──────────────────────────────────────
if grep -q "azerothcore-manager:" "$COMPOSE_FILE" 2>/dev/null; then
    echo "azerothcore-manager service already present in $COMPOSE_FILE — nothing to do."
    exit 0
fi

# ── Build the service definition ───────────────────────────────────
# Write the YAML block to a temp file so we can insert it at the
# right place without sed escaping issues.
MANAGER_TMPFILE=$(mktemp)
trap 'rm -f "$MANAGER_TMPFILE"' EXIT

cat > "$MANAGER_TMPFILE" << 'MANAGER_YAML'

  azerothcore-manager:
    container_name: azerothcore-manager
    build:
      context: ./azerothcore-manager
      dockerfile: Dockerfile
    networks:
      - ac-network
    ports:
      - ${DOCKER_MANAGER_EXTERNAL_PORT:-8088}:8088
    environment:
      DB_HOST: ac-database
      DB_PORT: "3306"
      DB_USER: root
      DB_PASSWORD: ${DOCKER_DB_ROOT_PASSWORD:-password}
      DB_NAME: acore_auth
      LOG_DIR: /azerothcore/env/dist/logs
      CONFIG_DIR: /azerothcore/env/dist/etc
      BACKUP_DIR: /app/backups
    volumes:
      # Docker socket — needed for container management API
      - /var/run/docker.sock:/var/run/docker.sock
      # Config files (read-write so the manager can edit them)
      - ${DOCKER_VOL_ETC:-./env/dist/etc}:/azerothcore/env/dist/etc
      # Logs (read-only)
      - ${DOCKER_VOL_LOGS:-./env/dist/logs}:/azerothcore/env/dist/logs:ro
      # Backups persistence
      - ${DOCKER_VOL_BACKUPS:-./backups}:/app/backups
    depends_on:
      ac-database:
        condition: service_healthy
MANAGER_YAML

# ── Insert before top-level volumes: (if present) ──────────────────
if grep -q '^volumes:' "$COMPOSE_FILE" 2>/dev/null; then
    # Use awk to insert the temp file contents before the first
    # top-level "volumes:" line.
    awk '
        /^volumes:/ && !inserted {
            while ((getline line < "'"$MANAGER_TMPFILE"'") > 0)
                print line
            inserted = 1
        }
        { print }
    ' "$COMPOSE_FILE" > "${COMPOSE_FILE}.tmp" && mv "${COMPOSE_FILE}.tmp" "$COMPOSE_FILE"
    echo "✓ azerothcore-manager service inserted before volumes: in $COMPOSE_FILE"
else
    # No top-level volumes: — append to end
    cat "$MANAGER_TMPFILE" >> "$COMPOSE_FILE"
    echo "✓ azerothcore-manager service appended to $COMPOSE_FILE"
fi

echo ""
echo "To start everything:"
echo "  docker compose up -d --build"
echo ""
echo "The manager dashboard will be available at:"
echo "  http://localhost:8088"
echo ""
echo "To override the external port, set DOCKER_MANAGER_EXTERNAL_PORT"
echo "before running docker compose up."

# ── Configure caching_sha2_password authentication ─────────────────
# Ensure the root user uses caching_sha2_password so the Node.js mysql2
# driver can connect. The default_authentication_plugin variable only
# exists in MySQL 8.0.27+, not in MariaDB, so we detect the DB type.
echo ""
echo "Configuring caching_sha2_password authentication..."
DB_ROOT_PASSWORD="${DOCKER_DB_ROOT_PASSWORD:-password}"
if docker compose exec ac-database mysql -u root -p"${DB_ROOT_PASSWORD}" -e "SELECT 1" 2>/dev/null; then
    # Detect whether this is MySQL or MariaDB
    DB_VERSION=$(docker compose exec ac-database mysql -u root -p"${DB_ROOT_PASSWORD}" -N -e "SELECT VERSION();" 2>/dev/null || echo "")
    if echo "$DB_VERSION" | grep -qi "mariadb"; then
        DB_TYPE="mariadb"
    else
        DB_TYPE="mysql"
    fi

    if [ "$DB_TYPE" = "mysql" ]; then
        # MySQL 8.0.27+ supports default_authentication_plugin
        docker compose exec ac-database mysql -u root -p"${DB_ROOT_PASSWORD}" -e \
          "SET PERSIST default_authentication_plugin = 'caching_sha2_password';" 2>/dev/null || true
    fi

    # Ensure root uses caching_sha2_password (works on both MySQL and MariaDB)
    docker compose exec ac-database mysql -u root -p"${DB_ROOT_PASSWORD}" -e \
      "ALTER USER 'root'@'%' IDENTIFIED WITH caching_sha2_password BY '${DB_ROOT_PASSWORD}'; FLUSH PRIVILEGES;" 2>/dev/null || \
    docker compose exec ac-database mysql -u root -p"${DB_ROOT_PASSWORD}" -e \
      "ALTER USER 'root'@'localhost' IDENTIFIED WITH caching_sha2_password BY '${DB_ROOT_PASSWORD}'; FLUSH PRIVILEGES;" 2>/dev/null || true
    echo "✓ Database auth plugin configured to caching_sha2_password."
else
    echo "⚠ Database not running yet — run this after docker compose up:"
    echo "  docker compose exec ac-database mysql -u root -p'${DB_ROOT_PASSWORD}' -e \"ALTER USER 'root'@'%' IDENTIFIED WITH caching_sha2_password BY '${DB_ROOT_PASSWORD}'; FLUSH PRIVILEGES;\""
fi
