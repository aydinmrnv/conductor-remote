#!/usr/bin/env bash
# conductor-remote installer — thin wrapper around the npm package.
#
#   curl -fsSL https://raw.githubusercontent.com/hyldmo/conductor-remote/main/install.sh | bash
#
# Checks Node, installs the global package (zero runtime deps), and registers the
# login LaunchAgent that serves the relay. macOS only — it controls the local
# Conductor app. Everything it does is available manually:
#   npm i -g conductor-remote && conductor-remote service install
set -euo pipefail

REQUIRED_MAJOR=24

say()  { printf '\033[36m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[33m⚠\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "conductor-remote is macOS only (it controls the local Conductor app)."

node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'; }

ensure_node() {
	local major
	major="$(node_major || true)"
	if [ -n "$major" ] && [ "$major" -ge "$REQUIRED_MAJOR" ]; then
		say "Node $(node -v) OK"
		return
	fi
	if [ -n "$major" ]; then
		warn "Node $(node -v) is too old (need >= ${REQUIRED_MAJOR}: node:sqlite + TS type-stripping)."
	else
		warn "Node not found (need >= ${REQUIRED_MAJOR})."
	fi
	if command -v brew >/dev/null 2>&1; then
		say "Installing Node via Homebrew..."
		brew install node
	else
		die "Install Node >= ${REQUIRED_MAJOR} (https://nodejs.org or 'brew install node') and re-run."
	fi
	local now
	now="$(node_major || true)"
	{ [ -n "$now" ] && [ "$now" -ge "$REQUIRED_MAJOR" ]; } || die "Node >= ${REQUIRED_MAJOR} still unavailable after install."
}

ensure_node
command -v npm >/dev/null 2>&1 || die "npm not found (it ships with Node) — check your Node install."

say "Installing conductor-remote (npm i -g)..."
npm install -g conductor-remote

say "Registering the login service (prints your phone URL)..."
conductor-remote service install
