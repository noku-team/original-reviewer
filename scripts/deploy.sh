#!/bin/sh
# Usage: bun run deploy [auto|patch|minor|major]   (auto = from conventional commits)
set -e
INCREMENT=${1:-auto}

gh workflow run new_release.yml --ref main -f increment="$INCREMENT"
sleep 5
RUN_ID=$(gh run list --workflow new_release.yml --branch main --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RUN_ID" --exit-status
git pull
