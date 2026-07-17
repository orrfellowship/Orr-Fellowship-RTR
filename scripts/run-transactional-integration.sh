#!/bin/sh
set -eu

container="orr-phase18-postgres-$$"
cleanup() {
  docker stop "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run --rm --name "$container" \
  -e POSTGRES_PASSWORD=phase18-test-only \
  -v "$(pwd):/workspace:ro" \
  -d postgres:17-alpine >/dev/null

attempt=0
until docker exec "$container" pg_isready -U postgres -d postgres >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "PostgreSQL test container did not become ready" >&2
    exit 1
  fi
  sleep 1
done

docker exec -w /workspace/scripts "$container" \
  psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f transactional-integration.sql
