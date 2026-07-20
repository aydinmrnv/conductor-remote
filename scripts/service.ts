/**
 * Deploy the relay as a macOS LaunchAgent — the only "deployment" this app has, since it must run
 * on the Mac that runs Conductor (local SQLite DB, git worktrees, and the sidecar unix socket all
 * live there). Installs a per-user agent that starts the relay on login and keeps it alive.
 *
 *   node scripts/service.ts <install|uninstall|status|restart>
 *   (or, once installed globally: `conductor-remote service <...>`)
 *
 * `yarn deploy` builds dist/ first, then runs `install`.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const LABEL = 'no.adluna.conductor-remote'
const projectDir = path.resolve(import.meta.dirname, '..')
const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
const logDir = path.join(os.homedir(), 'Library', 'Logs', 'conductor-remote')
const uid = process.getuid?.() ?? 0
const domain = `gui/${uid}`

function xml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Run launchctl, swallowing the exit code so "already-loaded"/"not-loaded" states aren't fatal. */
function launchctl(...args: string[]): void {
	try {
		execFileSync('launchctl', args, { stdio: 'pipe' })
	} catch {
		// non-zero is expected for bootout-when-absent etc.; state is asserted by the caller's sequence
	}
}

/** Block the main thread briefly — used to let launchd settle between bootout and bootstrap. */
function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Is the agent currently bootstrapped into the user domain? */
function serviceLoaded(): boolean {
	try {
		execFileSync('launchctl', ['print', `${domain}/${LABEL}`], { stdio: 'pipe' })
		return true
	} catch {
		return false
	}
}

/**
 * Reload the agent from the freshly written plist. `bootout` of a *running* instance is asynchronous,
 * so we wait for it to fully unload before `bootstrap` — otherwise bootstrap races the teardown and
 * fails silently, leaving the relay down after a re-deploy. Bootstrap is retried and its failure is fatal.
 */
function reloadAgent(): void {
	launchctl('bootout', `${domain}/${LABEL}`)
	for (let i = 0; i < 30 && serviceLoaded(); i++) sleepSync(100)
	let bootstrapped = false
	for (let i = 0; i < 10 && !bootstrapped; i++) {
		try {
			execFileSync('launchctl', ['bootstrap', domain, plistPath], { stdio: 'pipe' })
			bootstrapped = true
		} catch {
			sleepSync(150)
		}
	}
	if (!bootstrapped) {
		console.error(`✗ launchctl bootstrap failed for ${plistPath}`)
		console.error(`  Inspect with: launchctl print ${domain}/${LABEL}`)
		process.exit(1)
	}
	launchctl('enable', `${domain}/${LABEL}`)
	launchctl('kickstart', '-k', `${domain}/${LABEL}`)
}

/** Node runs the relay via the flag-free CLI shim; the absolute execPath is baked at install time. */
function buildPlist(): string {
	const node = xml(process.execPath)
	const proj = xml(projectDir)
	const out = xml(path.join(logDir, 'relay.log'))
	const err = xml(path.join(logDir, 'relay.err.log'))
	// Optional overrides carried into the daemon's environment.
	const envEntries: Array<[string, string]> = [['PATH', '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin']]
	if (process.env.WRITE_STRATEGY) envEntries.push(['WRITE_STRATEGY', process.env.WRITE_STRATEGY])
	if (process.env.RELAY_HOST) envEntries.push(['RELAY_HOST', process.env.RELAY_HOST])
	if (process.env.RELAY_PORT) envEntries.push(['RELAY_PORT', process.env.RELAY_PORT])
	const envXml = envEntries.map(([k, v]) => `\t\t<key>${xml(k)}</key>\n\t\t<string>${xml(v)}</string>`).join('\n')
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${node}</string>
		<string>${proj}/bin/cli.js</string>
	</array>
	<key>WorkingDirectory</key>
	<string>${proj}</string>
	<key>EnvironmentVariables</key>
	<dict>
${envXml}
	</dict>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>ProcessType</key>
	<string>Background</string>
	<key>StandardOutPath</key>
	<string>${out}</string>
	<key>StandardErrorPath</key>
	<string>${err}</string>
</dict>
</plist>
`
}

function distBuilt(): boolean {
	return fs.existsSync(path.join(projectDir, 'dist', 'index.html'))
}

/** Read the persisted token (or env override) purely to print the phone URL — never mints one. */
function currentToken(): string | null {
	if (process.env.RELAY_TOKEN) return process.env.RELAY_TOKEN
	try {
		return (
			fs
				.readFileSync(path.join(os.homedir(), 'Library', 'Application Support', 'conductor-remote', 'token'), 'utf8')
				.trim() || null
		)
	} catch {
		return null
	}
}

const RELAY_PORT = process.env.RELAY_PORT ?? '8787'

/** Locate the tailscale CLI: PATH first, then the common macOS install locations. Null if absent. */
function tailscaleBin(): string | null {
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

/** This node's MagicDNS name without the trailing dot, e.g. `mac.taila6dcd6.ts.net`. */
function magicDnsName(bin: string): string | null {
	try {
		const out = execFileSync(bin, ['status', '--json'], { encoding: 'utf8', stdio: 'pipe' })
		return (JSON.parse(out)?.Self?.DNSName ?? '').replace(/\.$/, '') || null
	} catch {
		return null
	}
}

/** Is `tailscale serve` already proxying https://<dns>/ to the loopback relay? Keeps the wiring idempotent. */
function serveConfigured(bin: string, dns: string): boolean {
	try {
		const out = execFileSync(bin, ['serve', 'status', '--json'], { encoding: 'utf8', stdio: 'pipe' })
		const proxy = JSON.parse(out)?.Web?.[`${dns}:443`]?.Handlers?.['/']?.Proxy
		return proxy === `http://127.0.0.1:${RELAY_PORT}`
	} catch {
		return false
	}
}

/**
 * Wire the relay to a stable HTTPS tailnet URL via `tailscale serve` (tailnet-only — NOT Funnel).
 * Idempotent and non-fatal: the relay binds loopback regardless, so a failure here just means the phone
 * URL isn't set up yet, and we print how to do it by hand. Real TLS also satisfies the PWA's secure-context
 * requirement (a service worker won't register over plain http on a 100.x IP).
 */
function ensureServe(): void {
	const bin = tailscaleBin()
	if (!bin) {
		console.info('\n  ⚠ tailscale CLI not found — skipped serve setup. Once Tailscale is installed, run:')
		console.info(`      tailscale serve --bg ${RELAY_PORT}`)
		return
	}
	const dns = magicDnsName(bin)
	if (dns && serveConfigured(bin, dns)) {
		console.info(`✓ tailscale serve already fronts https://${dns}/ → 127.0.0.1:${RELAY_PORT}`)
		return
	}
	try {
		execFileSync(bin, ['serve', '--bg', RELAY_PORT], { stdio: 'pipe' })
		console.info(`✓ tailscale serve → https://${dns ?? '<node>'}/ now proxies 127.0.0.1:${RELAY_PORT} (tailnet-only)`)
	} catch (err) {
		console.info(
			`\n  ⚠ could not configure tailscale serve (${err instanceof Error ? err.message : err}). Run by hand:`
		)
		console.info(`      tailscale serve --bg ${RELAY_PORT}`)
	}
}

function printUrl(): void {
	const frag = `#token=${currentToken() ?? '<starts on first run>'}`
	const bin = tailscaleBin()
	const dns = bin ? magicDnsName(bin) : null
	if (bin && dns && serveConfigured(bin, dns)) {
		console.info(`\n  Phone URL (same Tailnet, HTTPS):\n    https://${dns}/${frag}`)
		return
	}
	// Serve not wired yet — the relay is only on loopback.
	console.info(`\n  Local URL:\n    http://127.0.0.1:${RELAY_PORT}/${frag}`)
	console.info(
		`\n  ⚠ Not reachable from your phone yet. Run \`tailscale serve --bg ${RELAY_PORT}\`${dns ? ` → https://${dns}/` : ''}, then \`yarn service status\`.`
	)
}

/** npx unpacks into a throwaway cache that gets purged; a LaunchAgent baked against it would rot. */
function isEphemeralInstall(dir: string): boolean {
	return /[\\/]_npx[\\/]|[\\/]\.npm[\\/]_npx[\\/]/.test(dir)
}

function install(): void {
	if (isEphemeralInstall(projectDir)) {
		console.error(
			`✗ refusing to install from an npx cache path:\n    ${projectDir}\n` +
				'  That directory is temporary and gets purged, which would break the LaunchAgent.\n' +
				'  Install globally first: `npm i -g conductor-remote`, then `conductor-remote service install`.'
		)
		process.exit(1)
	}
	if (!distBuilt()) {
		console.error('✗ dist/ not built. Run `yarn build` first (or use `yarn deploy`, which builds).')
		process.exit(1)
	}
	fs.mkdirSync(path.dirname(plistPath), { recursive: true })
	fs.mkdirSync(logDir, { recursive: true })
	fs.writeFileSync(plistPath, buildPlist())
	reloadAgent()
	console.info(`✓ installed LaunchAgent ${LABEL}`)
	console.info(`  plist: ${plistPath}`)
	console.info(`  logs:  ${logDir}/relay.log`)
	console.info(`  node:  ${process.execPath}`)
	ensureServe()
	printUrl()
	console.info(
		'\n  Note: a node version change (nvm) invalidates the baked path — re-run `yarn deploy` after upgrading node.'
	)
	console.info(
		'  Note: the AppleScript write path needs Accessibility permission granted to this node binary (System Settings ▸ Privacy).'
	)
}

function uninstall(): void {
	launchctl('bootout', `${domain}/${LABEL}`)
	try {
		fs.rmSync(plistPath)
	} catch {
		// already gone
	}
	console.info(`✓ removed LaunchAgent ${LABEL}`)
}

function restart(): void {
	launchctl('kickstart', '-k', `${domain}/${LABEL}`)
	console.info(`✓ restarted ${LABEL}`)
	printUrl()
}

function status(): void {
	const installed = fs.existsSync(plistPath)
	console.info(`plist:     ${installed ? plistPath : '(not installed)'}`)
	if (!installed) return
	try {
		const out = execFileSync('launchctl', ['print', `${domain}/${LABEL}`], { encoding: 'utf8', stdio: 'pipe' })
		const state = out.match(/state = (\S+)/)?.[1] ?? 'unknown'
		const pid = out.match(/pid = (\d+)/)?.[1] ?? '—'
		console.info(`state:     ${state}  (pid ${pid})`)
	} catch {
		console.info('state:     loaded but not running (check logs)')
	}
	printUrl()
}

const cmd = process.argv[2] ?? 'status'
switch (cmd) {
	case 'install':
		install()
		break
	case 'uninstall':
		uninstall()
		break
	case 'restart':
		restart()
		break
	case 'status':
		status()
		break
	default:
		console.error(`unknown command: ${cmd}\nusage: service.ts <install|uninstall|restart|status>`)
		process.exit(1)
}
