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

/** Where the phone-URL host (this node's MagicDNS name at deploy time) is recorded, so a later drift is detectable. */
export function urlHostStorePath(): string {
	return path.join(os.homedir(), 'Library', 'Application Support', 'conductor-remote', 'url-host')
}

/** The MagicDNS name the saved phone URL was issued for, or null if never deployed with a drift-aware build. */
export function readUrlHost(): string | null {
	try {
		return fs.readFileSync(urlHostStorePath(), 'utf8').trim() || null
	} catch {
		return null
	}
}

/** Record the name the phone URL uses now, so a future rename can be flagged. Best-effort. */
export function writeUrlHost(name: string): void {
	try {
		fs.mkdirSync(path.dirname(urlHostStorePath()), { recursive: true })
		fs.writeFileSync(urlHostStorePath(), name)
	} catch {
		// non-fatal: drift detection is a convenience, not a correctness requirement
	}
}

/**
 * Has this node's MagicDNS name drifted from the one the saved phone URL points at? Tailscale derives the
 * name from the Mac's hostname unless pinned (see service.ts ▸ pinHostname), and an OS update/reset can move
 * it — silently bricking the installed PWA, which is bolted to the old origin. Returns both names when they
 * disagree so callers can warn; null when there's no baseline yet or they still match.
 */
export function hostDrift(bin: string): { expected: string; current: string } | null {
	const expected = readUrlHost()
	if (!expected) return null
	const current = magicDnsName(bin)
	if (!current || current === expected) return null
	return { expected, current }
}

/** Ready-to-print, actionable warning lines if the phone URL's host drifted; empty when all is well. */
export function driftWarningLines(bin: string): string[] {
	const drift = hostDrift(bin)
	if (!drift) return []
	return [
		`  ⚠ Tailscale device name changed: "${drift.expected}" → "${drift.current}".`,
		`    The saved phone URL https://${drift.expected}/ no longer resolves — the installed PWA will fail to load.`,
		`    Restore the old URL:  conductor-remote service install --hostname ${drift.expected.split('.')[0]}`,
		`    …or re-add the PWA at the new URL:  https://${drift.current}/`
	]
}
