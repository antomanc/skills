#!/usr/bin/env bash
set -euo pipefail

# Install every skill in this repo at user level, so all projects see it
# without committing anything. Re-run after editing a skill.
#
# Usage: ./bootstrap.sh
# Override the CLI version with: SKILLS_VERSION=1.9.0 ./bootstrap.sh

REPO="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_VERSION="${SKILLS_VERSION:-1.9.0}"

# Drop the agents you do not use. Codex, OpenCode and Cursor read
# ~/.agents/skills directly; Claude Code and Antigravity get symlinks.
AGENTS=(claude-code codex opencode cursor antigravity)

npx -y "skills@${SKILLS_VERSION}" add "$REPO/skills" \
  --skill '*' \
  --agent "${AGENTS[@]}" \
  --global \
  -y

printf '\nInstalled. Verify with:\n  npx -y skills@%s list -g\n' "$SKILLS_VERSION"
