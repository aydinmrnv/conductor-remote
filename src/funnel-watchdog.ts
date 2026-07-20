/**
 * Keeps the phone's public URL actually reachable.
 *
 * Tailscale Funnel exposes the loopback relay to the internet by having tailscaled hold a registration
 * with Tailscale's Funnel *ingress* relays; public clients hit those relays, which forward the TLS stream
 * to this node. That registration goes STALE after a network transition (Wi-Fi ⇄ iPhone hotspot, a new
 * DHCP lease, sleep/wake) — especially behind the symmetric NAT common at offices, where the node's
 * public endpoint keeps moving. When it does, `tailscale funnel status` still cheerfully reports "Funnel
 * on" and tailscaled keeps its local :443 listener up, but the ingress can no longer reach the node: the
 * phone (and any desktop tab) sits on "Offline — retrying" until someone manually re-runs `funnel reset`.
 * Nothing self-heals it. (See FINDINGS / the funnel-ingress-stale note.)
 *
 * So this watchdog does NOT trust any local funnel status. It probes the REAL public path end-to-end —
 * resolving the node's MagicDNS name against a *public* resolver to get the ingress IPs (never the tailnet
 * 100.x address, which would mask the break exactly like a `--resolve` to the node does), then an HTTPS
 * GET /health pinned to an ingress IP with the node's SNI. A healthy funnel answers; a stale one fails the
 * TLS/HTTP exchange entirely. After a few consecutive failures — and only when the ingress is TCP-reachable,
 * so a plain internet outage doesn't trigger a pointless reset — it re-registers with
 * `tailscale funnel reset && tailscale funnel --bg --yes <port>`, then waits for propagation. The periodic
 * probe doubles as keepalive traffic through the ingress, which also helps hold the mapping open.
 *
 * Gated like the self-updater: only the launchd-managed daemon (`CONDUCTOR_REMOTE_MANAGED=1`) in public
 * (Funnel) posture runs it. `FUNNEL_WATCHDOG=off` disables; `on` forces it where a tailscale CLI + Funnel
 * posture exist. Stdlib + global fetch/dns/https only — no runtime deps, strip-clean.
 */
import { execFile } from 'node:child_process'
import { Resolver } from 'node:dns/promises'
import https from 'node:https'
import net from 'node:net'
import { promisify } from 'node:util'
import { magicDnsName, readExposeMode, relayPort, tailscaleBin } from './tailscale.ts'

const execFileP = promisify(execFile)

const PROBE_PATH = '/health' // unauthenticated 200 on the relay — no token needed to prove reachability
const PROBE_TIMEOUT_MS = 8000
const TCP_TIMEOUT_MS = 4000
const FIRST_DELAY_MS = 20 * 1000 // let the relay + funnel settle after a (re)start before the first probe
// Consecutive failed probes before we re-register. A single miss is often a transient blip; a stale ingress
// stays broken until reset, so waiting for N in a row costs a little detection latency to avoid a needless
// funnel reset (which itself briefly drops clients). ~N×interval of confirmed-down before acting.
const FAIL_THRESHOLD = 3
const HEAL_COOLDOWN_MS = 120 * 1000 // min gap between re-registrations, so a persistent fault can't hammer funnel
const POST_HEAL_MS = 60 * 1000 // after a reset, give the control plane time to propagate before re-probing

/** Probe cadence. Frequent enough to detect a stale ingress within a couple minutes and to keep the mapping warm. */
function resolveIntervalMs(): number {
	const raw = Number(process.env.FUNNEL_WATCHDOG_INTERVAL_SECONDS)
	const seconds = Number.isFinite(raw) && raw > 0 ? raw : 60
	return Math.max(seconds, 15) * 1000
}

function log(msg: string): void {
	console.info(`[funnel-watchdog] ${msg}`)
}

function wantEnabled(): boolean {
	const raw = process.env.FUNNEL_WATCHDOG?.trim().toLowerCase()
	if (raw === 'off' || raw === 'false' || raw === '0') return false
	if (raw === 'on' || raw === 'true' || raw === '1') return true
	return process.env.CONDUCTOR_REMOTE_MANAGED === '1' // default: only the managed daemon
}

/**
 * Public A records for `host` — the Funnel ingress IPs. Queried against public resolvers so MagicDNS on
 * this node can't answer with the tailnet 100.x address (which would make every probe hit the node directly
 * and never see an ingress break). Falls back to the system resolver only if the public query fails.
 */
async function ingressIps(host: string): Promise<string[]> {
	try {
		const r = new Resolver({ timeout: 4000, tries: 2 })
		r.setServers(['1.1.1.1', '8.8.8.8'])
		const ips = await r.resolve4(host)
		if (ips.length) return ips
	} catch {
		// public resolver blocked/unreachable — fall through to the system resolver
	}
	try {
		const { lookup } = await import('node:dns/promises')
		const all = await lookup(host, { all: true, family: 4 })
		return all.map(a => a.address)
	} catch {
		return []
	}
}

/** GET https://host<PROBE_PATH> but pinned to `ip` (an ingress relay) with SNI=host. Resolves the HTTP status
 *  code; rejects if the TLS/HTTP exchange never completes — the signature of a stale ingress. */
function probeVia(ip: string, host: string, timeoutMs: number): Promise<number> {
	return new Promise((resolve, reject) => {
		const req = https.request(
			{
				host: ip,
				port: 443,
				servername: host, // SNI so the ingress routes to this node and the node's cert validates
				path: PROBE_PATH,
				method: 'GET',
				headers: { host, 'user-agent': 'conductor-remote-funnel-watchdog' },
				timeout: timeoutMs
			},
			res => {
				res.resume() // drain so the socket can close
				resolve(res.statusCode ?? 0)
			}
		)
		req.on('timeout', () => req.destroy(new Error('probe timeout')))
		req.on('error', reject)
		req.end()
	})
}

/** True if a bare TCP connection to `ip:port` opens — i.e. the internet + ingress are reachable, isolating
 *  "stale funnel stream" (heal-worthy) from "no connectivity" (nothing to fix, don't churn). */
function tcpOpen(ip: string, port: number, timeoutMs: number): Promise<boolean> {
	return new Promise(resolve => {
		const socket = net.connect({ host: ip, port })
		const finish = (ok: boolean) => {
			socket.destroy()
			resolve(ok)
		}
		socket.setTimeout(timeoutMs)
		socket.once('connect', () => finish(true))
		socket.once('timeout', () => finish(false))
		socket.once('error', () => finish(false))
	})
}

async function reRegisterFunnel(bin: string, port: string): Promise<void> {
	await execFileP(bin, ['funnel', 'reset'], { timeout: 15_000 })
	await execFileP(bin, ['funnel', '--bg', '--yes', port], { timeout: 20_000 })
}

let fails = 0
let lastHealAt = 0

function schedule(fn: () => void, delayMs: number): void {
	setTimeout(fn, delayMs).unref()
}

async function tick(host: string, bin: string, port: string, intervalMs: number): Promise<void> {
	const again = (delay: number) => schedule(() => void tick(host, bin, port, intervalMs), delay)
	const ips = await ingressIps(host)
	if (ips.length === 0) {
		// Can't resolve the ingress at all (DNS down / offline) — can't confirm a fault, so never heal.
		return again(intervalMs)
	}
	const ip = ips[0]

	let healthy = false
	try {
		const status = await probeVia(ip, host, PROBE_TIMEOUT_MS)
		healthy = status > 0 && status < 500 // any real HTTP answer means the ingress reached the node
	} catch {
		healthy = false
	}

	if (healthy) {
		if (fails > 0) log(`ingress healthy again after ${fails} failed probe(s)`)
		fails = 0
		return again(intervalMs)
	}

	fails++
	if (fails < FAIL_THRESHOLD) return again(intervalMs)

	// Confirmed down. Only re-register if the ingress is actually reachable (internet up) — otherwise it's a
	// connectivity outage that will clear on its own, and a funnel reset would just churn.
	const reachable = await tcpOpen(ip, 443, TCP_TIMEOUT_MS)
	if (!reachable) {
		log(`ingress ${ip} unreachable after ${fails} probes — looks offline, not re-registering`)
		return again(intervalMs)
	}
	if (Date.now() - lastHealAt < HEAL_COOLDOWN_MS) return again(intervalMs)

	log(
		`funnel ingress stale (${fails} failed probes, ingress TCP-reachable) — re-registering: funnel reset && funnel --bg ${port}`
	)
	try {
		await reRegisterFunnel(bin, port)
		lastHealAt = Date.now()
		fails = 0
		log(`re-registered funnel; waiting ${POST_HEAL_MS / 1000}s for the ingress to propagate`)
		return again(POST_HEAL_MS)
	} catch (err) {
		log(`funnel re-register failed: ${err instanceof Error ? err.message.trim() : String(err)} — will retry`)
		return again(intervalMs)
	}
}

/** Start the funnel watchdog. Safe to call unconditionally — no-ops unless the gates pass. */
export function startFunnelWatchdog(): void {
	if (!wantEnabled()) return
	if (readExposeMode() !== 'public') {
		// Funnel-specific: in tailnet (serve) posture there's no public ingress to keep alive.
		if (process.env.FUNNEL_WATCHDOG) log('skipped: expose posture is tailnet (serve), not public (funnel)')
		return
	}
	const bin = tailscaleBin()
	if (!bin) {
		log('skipped: tailscale CLI not found')
		return
	}
	const host = magicDnsName(bin)
	if (!host) {
		log('skipped: no MagicDNS name for this node')
		return
	}
	const port = relayPort()
	const intervalMs = resolveIntervalMs()
	log(
		`enabled; probing https://${host}${PROBE_PATH} via the public ingress every ${intervalMs / 1000}s (heal after ${FAIL_THRESHOLD} fails)`
	)
	schedule(() => void tick(host, bin, port, intervalMs), FIRST_DELAY_MS)
}
