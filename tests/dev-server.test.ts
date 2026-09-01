import http from 'node:http'
import net from 'node:net'
import { afterEach, describe, expect, test } from 'vitest'
import { createDevProxy, parseWorkspacePort, serveProxyAt } from '../src/dev-server.ts'

const closeAfter: Array<() => Promise<void>> = []

afterEach(async () => {
	await Promise.all(closeAfter.splice(0).map(close => close()))
})

function listen(server: http.Server | net.Server): Promise<number> {
	return new Promise((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => {
			const address = server.address()
			if (!address || typeof address === 'string') return reject(new Error('test server did not bind to TCP'))
			resolve(address.port)
		})
	})
}

function closeServer(server: http.Server | net.Server): Promise<void> {
	return new Promise(resolve => server.close(() => resolve()))
}

describe('workspace port discovery', () => {
	test('accepts one exact workspace id and one valid port', () => {
		const snapshot = [
			'node app OTHER=1 CONDUCTOR_WORKSPACE_ID=other CONDUCTOR_PORT=4100',
			'node app CONDUCTOR_WORKSPACE_ID=workspace-1 CONDUCTOR_PORT=55300 TOKEN=secret',
			'child CONDUCTOR_WORKSPACE_ID=workspace-1 CONDUCTOR_PORT=55300'
		].join('\n')
		expect(parseWorkspacePort(snapshot, 'workspace-1')).toBe(55300)
		expect(parseWorkspacePort(snapshot, 'workspace')).toBeNull()
	})

	test('refuses ambiguous or invalid ports', () => {
		expect(
			parseWorkspacePort(
				'one CONDUCTOR_WORKSPACE_ID=workspace-1 CONDUCTOR_PORT=55300\n' +
					'two CONDUCTOR_WORKSPACE_ID=workspace-1 CONDUCTOR_PORT=55301',
				'workspace-1'
			)
		).toBeNull()
		expect(parseWorkspacePort('one CONDUCTOR_WORKSPACE_ID=workspace-1 CONDUCTOR_PORT=99999', 'workspace-1')).toBeNull()
	})
})

describe('dev-server bridge', () => {
	test('rewrites public origins for strict local dev servers and publicises redirects', async () => {
		let targetPort = 0
		const upstream = http.createServer((req, res) => {
			res.writeHead(302, {
				'content-type': 'application/json',
				location: `http://localhost:${targetPort}/next`
			})
			res.end(JSON.stringify({ host: req.headers.host, origin: req.headers.origin, referer: req.headers.referer }))
		})
		targetPort = await listen(upstream)
		closeAfter.push(() => closeServer(upstream))
		const proxy = await createDevProxy(targetPort)
		closeAfter.push(proxy.close)

		const response = await fetch(`http://127.0.0.1:${proxy.port}/from?q=1`, {
			headers: {
				host: 'dev-mac.example.ts.net:55300',
				origin: 'https://dev-mac.example.ts.net:55300',
				referer: 'https://dev-mac.example.ts.net:55300/from?q=1',
				'x-forwarded-host': 'dev-mac.example.ts.net:55300',
				'x-forwarded-proto': 'https'
			},
			redirect: 'manual'
		})
		const body = (await response.json()) as Record<string, string>
		expect(body).toEqual({
			host: `127.0.0.1:${targetPort}`,
			origin: `http://127.0.0.1:${targetPort}`,
			referer: `http://127.0.0.1:${targetPort}/from?q=1`
		})
		expect(response.headers.get('location')).toBe('https://dev-mac.example.ts.net:55300/next')
	})

	test('answers a private ownership challenge without reaching the dev server', async () => {
		let upstreamRequests = 0
		const upstream = http.createServer((_req, res) => {
			upstreamRequests++
			res.end('upstream')
		})
		const targetPort = await listen(upstream)
		closeAfter.push(() => closeServer(upstream))
		const proxy = await createDevProxy(targetPort)
		closeAfter.push(proxy.close)

		const response = await fetch(`http://127.0.0.1:${proxy.port}/`, {
			headers: { 'x-conductor-remote-bridge': proxy.token }
		})
		expect(response.status).toBe(204)
		expect(upstreamRequests).toBe(0)
	})

	test('passes WebSocket upgrades through with a local Host and Origin', async () => {
		let received = ''
		const upstream = net.createServer(socket => {
			socket.once('data', chunk => {
				received = chunk.toString('utf8')
				socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
			})
		})
		const targetPort = await listen(upstream)
		closeAfter.push(() => closeServer(upstream))
		const proxy = await createDevProxy(targetPort)
		closeAfter.push(proxy.close)

		const response = await new Promise<string>((resolve, reject) => {
			const socket = net.connect({ host: '127.0.0.1', port: proxy.port }, () => {
				socket.write(
					'GET /hmr HTTP/1.1\r\n' +
						'Host: dev-mac.example.ts.net:55300\r\n' +
						'Origin: https://dev-mac.example.ts.net:55300\r\n' +
						'Connection: Upgrade\r\n' +
						'Upgrade: websocket\r\n\r\n'
				)
			})
			let body = ''
			socket.on('data', chunk => {
				body += chunk.toString('utf8')
			})
			socket.once('end', () => resolve(body))
			socket.once('error', reject)
		})

		expect(response).toContain('101 Switching Protocols')
		expect(received).toContain(`host: 127.0.0.1:${targetPort}`)
		expect(received).toContain(`origin: http://127.0.0.1:${targetPort}`)
	})

	test('reads only the root proxy for the requested HTTPS port', () => {
		const status = {
			Web: {
				'host.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:8787' } } },
				'host.ts.net:55300': { Handlers: { '/': { Proxy: 'http://127.0.0.1:60000' } } }
			}
		}
		expect(serveProxyAt(status, 55300)).toBe('http://127.0.0.1:60000')
		expect(serveProxyAt(status, 55301)).toBeNull()
	})
})
