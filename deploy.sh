#!/usr/bin/env bash
# One-command deploy: rebuild index.html, commit everything, push to GitHub.
# Vercel auto-redeploys from the pushed commit.
#
# Usage (in Git Bash):
#   ./deploy.sh                 -> commits with a default message
#   ./deploy.sh "your message"  -> commits with your message

cd "$(dirname "$0")" || exit 1

# 1) Rebuild the self-contained index.html from the modular source (if available)
if command -v powershell >/dev/null 2>&1 && [ -f build-inline.ps1 ]; then
  echo "Rebuilding index.html..."
  powershell -ExecutionPolicy Bypass -File build-inline.ps1
fi

# 2) Commit + push
msg="${1:-update site}"
git add -A
if git diff --cached --quiet; then
  echo "No changes to commit."
else
  git commit -m "$msg"
fi
git push && echo "Pushed. Vercel will redeploy in ~1 minute."
