#!/usr/bin/env bash
set -euo pipefail

echo "Running smoke test..."
node -e "
import('./dist/app.js').then(m => {
  console.log('Successfully imported dist/app.js');
  process.exit(0);
}).catch(err => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
"
echo "Smoke test passed."
