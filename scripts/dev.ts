import { spawn } from 'node:child_process'
import net from 'node:net'

// Run the Vite dev server (HMR PWA) and the relay (API + reads) together.
// Vite proxies /api → the relay so the phone hits a single origin.
//
// Dev-only per-workspace ports: inside a Conductor workspace, $CONDUCTOR_PORT is
// unique per workspace, so several `yarn dev`s can run concurrently. Vite (the
// origin a browser/phone opens) takes that port; the relay gets a free ephemeral
// port and Vite proxies /api to it on loopback. Outside Conductor, fall back to
// the classic 5173 (web) / 8787 (relay) pair. Prod (`yarn start`/`deploy`/the
// LaunchAgent) never runs through here, so its Tailscale bind and RELAY_PORT
// default stay untouched — this clutters neither the prod path nor the build.

/** Ask the OS for an unused TCP port so a Conductor workspace's relay never collides. */
function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = net.createServer()
		srv.once('error', reject)
		srv.listen(0, '127.0.0.1', () => {
			const { port } = srv.address() as net.AddressInfo
			srv.close(() => resolve(port))
		})
	})
}

const conductorPort = Number(process.env.CONDUCTOR_PORT) || 0
const webPort = conductorPort || 5173
// Loopback bind + Vite proxy target must match; only prod auto-binds the Tailscale NIC.
const relayPort = conductorPort ? await freePort() : 8787

const relayArgs = [
	'--experimental-transform-types',
	'--disable-warning=ExperimentalWarning',
	'--watch',
	'src/server.ts'
]
const procs = [
	{
		name: 'web  ',
		cmd: 'yarn',
		args: ['dev:web'],
		color: '\x1b[35m',
		env: { ...process.env, WEB_PORT: String(webPort), RELAY_PORT: String(relayPort) }
	},
	{
		name: 'relay',
		cmd: 'node',
		args: relayArgs,
		color: '\x1b[36m',
		env: { ...process.env, RELAY_PORT: String(relayPort), RELAY_HOST: process.env.RELAY_HOST ?? '127.0.0.1' }
	}
]

const children = procs.map(p => {
	const child = spawn(p.cmd, p.args, { stdio: ['inherit', 'pipe', 'pipe'], env: p.env })
	const tag = `${p.color}[${p.name}]\x1b[0m `
	const pipe = (stream: NodeJS.ReadableStream) => {
		let buf = ''
		stream.on('data', (d: Buffer) => {
			buf += d.toString()
			let nl = buf.indexOf('\n')
			while (nl >= 0) {
				console.log(tag + buf.slice(0, nl))
				buf = buf.slice(nl + 1)
				nl = buf.indexOf('\n')
			}
		})
	}
	pipe(child.stdout)
	pipe(child.stderr)
	return child
})

const shutdown = () => {
	for (const c of children) c.kill('SIGTERM')
	process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
for (const c of children) c.on('exit', shutdown)
