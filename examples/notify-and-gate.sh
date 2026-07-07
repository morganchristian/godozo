#!/usr/bin/env bash
# godozo in 20 lines — the two verbs, both runnable as-is.
#
# Prereqs: a configured .env (GODOZO_TELEGRAM_TOKEN + GODOZO_TELEGRAM_CHAT_ID).
# Verify first:  node bin/godozo.js doctor
#
# Run from the repo root:  bash examples/notify-and-gate.sh
# (Or install globally with `npm link` and drop the `node bin/godozo.js` prefix.)
set -euo pipefail

god() { node bin/godozo.js "$@"; }   # or: god() { godozo "$@"; }

# (a) Fire-and-forget notification — never blocks, returns immediately.
god notify --title "example" "✅ notify works — this is a one-way ping"

# (b) Blocking approval gate — freezes here until you tap Approve/Deny on your
# phone. The EXIT CODE is the decision, so it composes with && / ||:
#   0 approved · 10 denied · 20 timed out · 1 error
if god gate --title "Run the pretend deploy?" \
            --detail "./deploy.sh --prod   # <- this is what you're approving" \
            --timeout 120; then
  echo "→ approved: running the (pretend) deploy"
  # ./deploy.sh --prod
else
  code=$?
  echo "→ not approved (exit $code): stopping. Nothing was deployed."
  exit "$code"
fi
