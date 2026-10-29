#!/usr/bin/env bash
# Commit monitor output and push, rebasing on top of anything pushed meanwhile.
set -euo pipefail
git config user.name "dip-monitor"
git config user.email "bot@users.noreply.github.com"
if [ "$#" -gt 0 ]; then git add "$@" 2>/dev/null || true; else git add data.json state.json research.json history/ 2>/dev/null || true; fi
if git diff --staged --quiet; then echo "Nothing to commit."; exit 0; fi
git commit -q -m "${COMMIT_MSG:-Update monitor data}${SLOT:+ ($SLOT)}"
for i in 1 2 3 4 5; do
  if git pull -q --rebase -X theirs origin main && git push -q origin HEAD:main; then echo "Pushed."; exit 0; fi
  echo "Push attempt $i failed; retrying."; sleep $((i * 5))
done
echo "Could not push monitor data." >&2; exit 1
