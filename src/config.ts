import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { WriteStrategy } from './writes.ts'

const home = os.homedir()

export interface Config {
	/** Path to Conductor's live SQLite state DB (read-only source of truth for reads). */
	dbPath: string
	/** Root under which Conductor lays out per-workspace git worktrees. */
	workspacesRoot: string
	/** TCP port the relay listens on. */
	port: number
	/** Host to bind. Defaults to the Tailscale interface if found, else loopback. */
	host: string
	/** Shared secret required on every /api/* request. Auto-generated if unset. */
	token: string
	/** Prompt delivery strategy: 'applescript' (default, focused session) or 'sidecar' (precise per-session IPC). */
	writeStrategy: WriteStrategy
	/** Directory of built PWA assets to serve. */
	publicDir: string
}

/** Tailscale hands out addresses in the 100.64.0.0/10 CGNAT range. Prefer that NIC. */
function detectTailscaleHost(): string | null {
	const nics = os.networkInterfaces()
	for (const addrs of Object.values(nics)) {
		for (const a of addrs ?? []) {
			if (a.family === 'IPv4' && !a.internal && a.address.startsWith('100.')) return a.address
		}
	}
	return null
}

/** Where a generated token is persisted so a phone's saved URL stays valid across relay restarts. */
function tokenStorePath(): string {
	return path.join(home, 'Library', 'Application Support', 'conductor-remote', 'token')
}

/**
 * Stable shared secret. Explicit `RELAY_TOKEN` wins; otherwise reuse a persisted token (or mint and
 * persist one). Persistence matters for the daemon: a KeepAlive restart must not invalidate the URL
 * the user added to their home screen.
 */
function resolveToken(): string {
	if (process.env.RELAY_TOKEN) return process.env.RELAY_TOKEN
	const file = tokenStorePath()
	try {
		const existing = fs.readFileSync(file, 'utf8').trim()
		if (existing) return existing
	} catch {
		// no persisted token yet — mint one below
	}
	const token = crypto.randomBytes(16).toString('hex')
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true })
		fs.writeFileSync(file, token, { mode: 0o600 })
	} catch (err) {
		console.warn(`⚠ could not persist token (${err instanceof Error ? err.message : err}); it will rotate on restart`)
	}
	return token
}

/** The relay serves the Vite build. Warn early if it hasn't been built yet. */
function resolvePublicDir(): string {
	const dist = path.join(import.meta.dirname, '..', 'dist')
	if (!fs.existsSync(path.join(dist, 'index.html'))) {
		console.warn(
			'⚠ dist/ not built — run `yarn build` (or `yarn preview`). The API works; the PWA will 404 until then.'
		)
	}
	return dist
}

export function loadConfig(): Config {
	const explicitHost = process.env.RELAY_HOST
	const host = explicitHost ?? detectTailscaleHost() ?? '127.0.0.1'
	const writeStrategy: WriteStrategy = process.env.WRITE_STRATEGY === 'sidecar' ? 'sidecar' : 'applescript'
	return {
		dbPath:
			process.env.CONDUCTOR_DB ??
			path.join(home, 'Library', 'Application Support', 'com.conductor.app', 'conductor.db'),
		workspacesRoot: process.env.CONDUCTOR_WORKSPACES ?? path.join(home, 'conductor', 'workspaces'),
		port: Number(process.env.RELAY_PORT ?? 8787),
		host,
		token: resolveToken(),
		writeStrategy,
		publicDir: resolvePublicDir()
	}
}
