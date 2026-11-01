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

# ── Check if already inserted ──────────────────────────────────────
if grep -q "azerothcore-manager:" "$COMPOSE_FILE" 2>/dev/null; then
    echo "azerothcore-manager service already present in $COMPOSE_FILE — nothing to do."
    exit 0
fi

# ── Build the service definition ───────────────────────────────────
# We use a temp file to hold the YAML block so we can insert it at
# the right place.  The heredoc is NOT single-quoted so that
# ${VAR:-default} references are expanded at runtime.
MANAGER_YAML=$(cat <<EOF

  azerothcore-manager:
    container_name: azerothcore-manager
    build:
      context: ./azerothcore-manager
      dockerfile: Dockerfile
    networks:
      - ac-network
    ports:
      - \${DOCKER_MANAGER_EXTERNAL_PORT:-8088}:8088
    environment:
      DB_HOST: ac-database
      DB_PORT: "3306"
      DB_USER: root
      DB_PASSWORD: \${DOCKER_DB_ROOT_PASSWORD:-password}
      DB_NAME: acore_auth
      LOG_DIR: /azerothcore/env/dist/logs
      CONFIG_DIR: /azerothcore/env/dist/etc
      BACKUP_DIR: /app/backups
    volumes:
      # Docker socket — needed for container management API
      - /var/run/docker.sock:/var/run/docker.sock
      # Config files (read-write so the manager can edit them)
      - \${DOCKER_VOL_ETC:-./env/dist/etc}:/azerothcore/env/dist/etc
      # Logs (read-only)
      - \${DOCKER_VOL_LOGS:-./env/dist/logs}:/azerothcore/env/dist/logs:ro
      # Backups persistence
      - \${DOCKER_VOL_BACKUPS:-./backups}:/app/backups
    depends_on:
      ac-database:
        condition: service_healthy
EOF
)

# ── Insert before top-level volumes: (if present) ──────────────────
if grep -q '^volumes:' "$COMPOSE_FILE" 2>/dev/null; then
    # Insert the YAML block before the first top-level "volumes:" line
    sed -i "0,/^volumes:/{/^volumes:/i\\${MANAGER_YAML}}" "$COMPOSE_FILE"
    echo "✓ azerothcore-manager service inserted before volumes: in $COMPOSE_FILE"
else
    # No top-level volumes: — append to end
    printf '%s\n' "$MANAGER_YAML" >> "$COMPOSE_FILE"
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
# Ensure MariaDB uses caching_sha2_password as the default auth plugin
# and that the root user is configured to use it. The Node.js mysql2
# driver supports caching_sha2_password natively.
echo ""
echo "Configuring caching_sha2_password authentication..."
DB_ROOT_PASSWORD="${DOCKER_DB_ROOT_PASSWORD:-password}"
if docker compose exec ac-database mariadb -u root -p"${DB_ROOT_PASSWORD}" -e "SELECT 1" 2>/dev/null; then
    # Set default auth plugin globally
    docker compose exec ac-database mariadb -u root -p"${DB_ROOT_PASSWORD}" -e \
      "SET PERSIST default_authentication_plugin = 'caching_sha2_password';" 2>/dev/null || true
    # Ensure root uses caching_sha2_password
    docker compose exec ac-database mariadb -u root -p"${DB_ROOT_PASSWORD}" -e \
      "ALTER USER 'root'@'%' IDENTIFIED WITH caching_sha2_password BY '${DB_ROOT_PASSWORD}'; FLUSH PRIVILEGES;" 2>/dev/null || \
    docker compose exec ac-database mariadb -u root -p"${DB_ROOT_PASSWORD}" -e \
      "ALTER USER 'root'@'localhost' IDENTIFIED WITH caching_sha2_password BY '${DB_ROOT_PASSWORD}'; FLUSH PRIVILEGES;" 2>/dev/null || true
    echo "✓ Database auth plugin configured to caching_sha2_password."
else
    echo "⚠ Database not running yet — run this after docker compose up:"
    echo "  docker compose exec ac-database mariadb -u root -p'${DB_ROOT_PASSWORD}' -e \"SET PERSIST default_authentication_plugin = 'caching_sha2_password';\""
    echo "  docker compose exec ac-database mariadb -u root -p'${DB_ROOT_PASSWORD}' -e \"ALTER USER 'root'@'%' IDENTIFIED WITH caching_sha2_password BY '${DB_ROOT_PASSWORD}'; FLUSH PRIVILEGES;\""
fi
