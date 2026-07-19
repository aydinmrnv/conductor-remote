import { spawn } from 'node:child_process'

// Run the Vite dev server (HMR PWA) and the relay (API + reads) together.
// Vite proxies /api → the relay so the phone hits a single origin on :5173.
const procs = [
	{ name: 'web  ', cmd: 'yarn', args: ['dev:web'], color: '\x1b[35m' },
	{
		name: 'relay',
		cmd: 'node',
		args: ['--experimental-transform-types', '--disable-warning=ExperimentalWarning', '--watch', 'src/server.ts'],
		color: '\x1b[36m'
	}
]

const children = procs.map(p => {
	const child = spawn(p.cmd, p.args, { stdio: ['inherit', 'pipe', 'pipe'], env: process.env })
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
