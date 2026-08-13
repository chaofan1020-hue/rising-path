#!/bin/bash
set -Eeuo pipefail
cd "$(pwd)"
echo "Running validate..."
pnpm validate
echo "Validate passed!"
