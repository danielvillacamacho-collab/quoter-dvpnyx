#!/usr/bin/env bash
# Dump the current Postgres (on EC2) and restore into Aurora.
#
# Usage (from an operator machine with VPN/peering to both, or from the EC2 box):
#   ./migrate-db.sh <src_conn_string> <aurora_secret_arn> <region>
#
# Safety:
#   - Dump is stored in a local file with a timestamp (keep for 30 days).
#   - Aurora endpoint is read from Secrets Manager so nothing is hardcoded.
#   - Run with EC2 in maintenance mode (API 503) to avoid lost writes.

set -euo pipefail

SRC_CONN="${1:?source conn string (postgres://user:pass@host/db)}"
AURORA_SECRET_ARN="${2:?aurora secret ARN}"
REGION="${3:-us-east-1}"

TS=$(date -u +%Y%m%dT%H%M%SZ)
DUMP="/tmp/dvpnyx-${TS}.dump"

echo "==> [1/4] Dumping source DB to $DUMP ..."
pg_dump -Fc -d "$SRC_CONN" -f "$DUMP"

echo "==> [2/4] Reading Aurora credentials from Secrets Manager..."
AURORA_JSON=$(aws secretsmanager get-secret-value \
  --secret-id "$AURORA_SECRET_ARN" \
  --region "$REGION" \
  --query SecretString --output text)

HOST=$(echo "$AURORA_JSON" | jq -r .host)
PORT=$(echo "$AURORA_JSON" | jq -r .port)
USER=$(echo "$AURORA_JSON" | jq -r .username)
PASS=$(echo "$AURORA_JSON" | jq -r .password)
DB=$(echo "$AURORA_JSON"   | jq -r .dbname)

echo "==> [3/4] Restoring into Aurora at $HOST ..."
PGPASSWORD="$PASS" pg_restore --no-owner --no-acl \
  -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" \
  --clean --if-exists \
  "$DUMP"

echo "==> [4/4] Sanity check..."
PGPASSWORD="$PASS" psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" \
  -c "SELECT count(*) AS quotations FROM quotations;" \
  -c "SELECT count(*) AS users FROM users;" \
  -c "SELECT count(*) AS parameters FROM parameters;"

echo "✅ Migration completed at $(date -u -Iseconds). Dump: $DUMP"
