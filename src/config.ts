import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

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
	/** Enable the experimental raw-DB-insert write path (see FINDINGS.md). Off by default. */
	unsafeDbWrite: boolean
	/** Directory of static PWA assets. */
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

export function loadConfig(): Config {
	const explicitHost = process.env.RELAY_HOST
	const host = explicitHost ?? detectTailscaleHost() ?? '127.0.0.1'
	return {
		dbPath:
			process.env.CONDUCTOR_DB ??
			path.join(home, 'Library', 'Application Support', 'com.conductor.app', 'conductor.db'),
		workspacesRoot: process.env.CONDUCTOR_WORKSPACES ?? path.join(home, 'conductor', 'workspaces'),
		port: Number(process.env.RELAY_PORT ?? 8787),
		host,
		token: process.env.RELAY_TOKEN ?? crypto.randomBytes(16).toString('hex'),
		unsafeDbWrite: process.env.UNSAFE_DB_WRITE === '1',
		publicDir: path.join(import.meta.dirname, '..', 'public')
	}
}
