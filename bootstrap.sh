#!/usr/bin/env bash
set -euo pipefail

# Install the global skill set at user level: the shared engineering
# methodology plus every skill maintained in this repo. Nothing is committed
# to a project. Re-run after editing a skill.
#
# Usage: ./bootstrap.sh
# Override the CLI version with: SKILLS_VERSION=1.9.0 ./bootstrap.sh

REPO="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_VERSION="${SKILLS_VERSION:-1.9.0}"

# Drop the agents you do not use. Codex, OpenCode and Cursor read
# ~/.agents/skills directly; Claude Code and Antigravity get symlinks.
AGENTS=(claude-code codex opencode cursor antigravity)

install() {
  npx -y "skills@${SKILLS_VERSION}" add "$@" \
    --agent "${AGENTS[@]}" \
    --global \
    -y
}

# Engineering methodology: the full set used by the projects.
install mattpocock/skills --skill \
  ask-matt \
  code-review \
  codebase-design \
  diagnosing-bugs \
  domain-modeling \
  grill-with-docs \
  implement \
  implement-spec \
  improve-codebase-architecture \
  pr \
  prototype \
  research \
  retro \
  setup-matt-pocock-skills \
  tdd \
  to-spec \
  to-tickets \
  triage \
  wayfinder \
  wizard \
  grill-me \
  grilling \
  handoff \
  teach \
  to-questionnaire \
  wait-what \
  writing-for-agents

# Discipline.
install blader/humanizer --skill humanizer
install multica-ai/andrej-karpathy-skills --skill karpathy-guidelines

# UI and browser tooling. These are global but only used where relevant.
install pbakaus/impeccable --skill impeccable
install vercel-labs/agent-browser --skill agent-browser
install callstack/agent-device --skill agent-device

# Skills maintained in this repo.
install "$REPO/skills" --skill '*'

printf '\nInstalled. Verify with:\n  npx -y skills@%s list -g\n' "$SKILLS_VERSION"
