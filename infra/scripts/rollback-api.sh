#!/usr/bin/env bash
# One-shot Lambda alias rollback to the previous version.
#
# Usage:
#   ./rollback-api.sh <function-name> <alias-name> <region>
#   e.g. ./rollback-api.sh DvpnyxApiFunction stable us-east-1

set -euo pipefail

FN="${1:?function name}"
ALIAS="${2:-stable}"
REGION="${3:-us-east-1}"

echo "==> Current alias target:"
CURRENT=$(aws lambda get-alias --function-name "$FN" --name "$ALIAS" \
  --region "$REGION" --query FunctionVersion --output text)
echo "   $ALIAS → v$CURRENT"

PREV=$((CURRENT - 1))
if [[ "$PREV" -lt 1 ]]; then
  echo "No previous version to roll back to." >&2; exit 1
fi

read -r -p "Roll $ALIAS back to v$PREV? (yes/no) " ans
[[ "$ans" == "yes" ]] || { echo "Aborted."; exit 1; }

aws lambda update-alias --function-name "$FN" --name "$ALIAS" \
  --function-version "$PREV" --region "$REGION" > /dev/null

echo "✅ $ALIAS now points to v$PREV. Monitor CloudWatch alarms."
