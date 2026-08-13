#!/usr/bin/env bash
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -d "$REPO" ] || exit 0
echo "AUDIT_RAN $REPO"
