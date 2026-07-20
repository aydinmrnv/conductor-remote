/**
 * Shared Tailscale helpers used by BOTH the deploy script (scripts/service.ts) and the runtime funnel
 * watchdog (src/funnel-watchdog.ts). They must agree: the watchdog re-establishes Funnel with the same
 * port and posture the deploy configured, so "how do we find tailscale / this node's public name / the
 * expose mode" lives here once rather than drifting between deploy-time and runtime copies.
 *
 * Stdlib only, strip-clean (no transform-requiring syntax — see CLAUDE.md ▸ dev path).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type ExposeMode = 'public' | 'tailnet'

/** The relay's loopback port — what Funnel/Serve proxy to. Mirrors config.ts (`RELAY_PORT ?? 8787`). */
export function relayPort(): string {
	return String(process.env.RELAY_PORT ?? 8787)
}

/** Locate the tailscale CLI: PATH first, then the common macOS install locations. Null if absent. */
export function tailscaleBin(): string | null {
	for (const bin of [
		'tailscale',
		'/opt/homebrew/bin/tailscale',
		'/usr/local/bin/tailscale',
		'/Applications/Tailscale.app/Contents/MacOS/Tailscale'
	]) {
		try {
			execFileSync(bin, ['version'], { stdio: 'pipe' })
			return bin
		} catch {
			// try the next candidate
		}
	}
	return null
}

/** This node's MagicDNS name without the trailing dot, e.g. `mac.taila6dcd6.ts.net`. Null if unknown. */
export function magicDnsName(bin: string): string | null {
	try {
		const out = execFileSync(bin, ['status', '--json'], { encoding: 'utf8', stdio: 'pipe' })
		return (JSON.parse(out)?.Self?.DNSName ?? '').replace(/\.$/, '') || null
	} catch {
		return null
	}
}

/** Where the chosen expose mode is persisted (written by the deploy script; read-only here). */
export function exposeStorePath(): string {
	return path.join(os.homedir(), 'Library', 'Application Support', 'conductor-remote', 'expose')
}

export function normalizeExposeMode(raw: string | undefined): ExposeMode | null {
	const v = raw?.trim().toLowerCase()
	if (v === 'public' || v === 'funnel') return 'public'
	if (v === 'tailnet' || v === 'serve' || v === 'private') return 'tailnet'
	return null
}

/**
 * Read-only resolve of the expose posture: `EXPOSE` env > persisted choice > 'public' default. Unlike the
 * deploy script's resolveExposeMode(), this never writes the persisted file — the runtime only observes.
 */
export function readExposeMode(): ExposeMode {
	const fromEnv = normalizeExposeMode(process.env.EXPOSE)
	if (fromEnv) return fromEnv
	try {
		const saved = normalizeExposeMode(fs.readFileSync(exposeStorePath(), 'utf8'))
		if (saved) return saved
	} catch {
		// no saved choice yet
	}
	return 'public'
}
