import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { stateDir } from './config.ts'

/**
 * MCP server: the same relay, addressed by an agent instead of a phone.
 *
 * **Every tool is an HTTP call to the running relay.** Nothing here reads
 * `conductor.db` and nothing here drives AppleScript, and that is the load-bearing
 * decision rather than a convenience. Conductor has one shared window, so the only
 * thing that makes writes safe is `writes.ts` ▸ `uiTurn`, and that lock is
 * *process-local*. An MCP server that drove the UI itself would be a second process
 * outside it, and two agents focusing different workspaces would land each other's
 * prompts — the exact failure every fail-closed assertion cannot catch. Routed
 * through the relay, the phone, the delivery queues and every agent share one lock.
 *
 * Requests carry `x-relay-client: mcp`, which the relay turns into `background`
 * priority: an agent never makes a human tap wait behind it.
 *
 * Hand-rolled rather than built on `@modelcontextprotocol/sdk` because stdio MCP is
 * newline-delimited JSON-RPC 2.0 and the SDK is 91 packages / 24 MB (express, hono,
 * cors, jose) for a server that speaks neither HTTP nor OAuth. This file is the
 * whole protocol. The relay's tarball keeps its zero runtime dependencies, which
 * matters more than usual here: it auto-updates itself while holding a token that
 * drives your Mac.
 */

/** Versions we know how to speak. The client's choice wins when we know it. */
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

/**
 * stdout is the wire. A stray `console.log` from anywhere in this process would be
 * parsed as a protocol message and kill the session, so the one shared mistake is
 * made impossible up front rather than guarded against per call site.
 */
console.log = (...args: unknown[]) => console.error(...args)
console.info = (...args: unknown[]) => console.error(...args)

function relayBase(): string {
	const port = process.env.RELAY_PORT ?? '8787'
	// The relay binds loopback (see config.ts); RELAY_HOST only widens who else can
	// reach it, so 127.0.0.1 is always right for a client on the same Mac.
	return `http://127.0.0.1:${port}`
}

function relayToken(): string {
	if (process.env.RELAY_TOKEN) return process.env.RELAY_TOKEN
	try {
		return readFileSync(path.join(stateDir(), 'token'), 'utf8').trim()
	} catch {
		throw new Error(
			`no relay token at ${path.join(stateDir(), 'token')} — start the relay once (conductor-remote service install), or set RELAY_TOKEN`
		)
	}
}

/** Reads are quick; a UI write is measured in tens of seconds (writes.ts ▸ SEND_ATTEMPT_MS). */
const READ_TIMEOUT_MS = 10_000
const WRITE_TIMEOUT_MS = 75_000

interface RelayOptions {
	method?: string
	body?: unknown
	timeoutMs?: number
}

async function relay<T>(route: string, opts: RelayOptions = {}): Promise<T> {
	const timeoutMs = opts.timeoutMs ?? READ_TIMEOUT_MS
	let res: Response
	try {
		res = await fetch(`${relayBase()}${route}`, {
			method: opts.method ?? 'GET',
			signal: AbortSignal.timeout(timeoutMs),
			headers: {
				authorization: `Bearer ${relayToken()}`,
				'content-type': 'application/json',
				// Marks this caller as an agent: the relay drops it to background priority on
				// the UI lock, behind anyone using the phone (server.ts ▸ withUiPriority).
				'x-relay-client': 'mcp',
				// The relay retries a failed send inside this budget and never past it, so
				// stating it here is what stops it outliving us — see server.ts ▸ sendBudget.
				'x-client-timeout-ms': String(timeoutMs)
			},
			body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
		})
	} catch (err) {
		if (err instanceof DOMException && err.name === 'TimeoutError')
			throw new Error(`the relay did not answer within ${Math.round(timeoutMs / 1000)}s`)
		throw new Error(
			`cannot reach the relay at ${relayBase()} (${err instanceof Error ? err.message : err}). Is it running? \`conductor-remote service status\``
		)
	}
	const payload = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string }
	if (!res.ok) {
		// 503 is the UI lock refusing a deep queue, and it is worth naming as such: it
		// means "retry shortly", not "this failed".
		const busy = res.status === 503 ? ' (Conductor’s UI is busy — retry shortly)' : ''
		throw new Error(`${payload.error || `HTTP ${res.status}`}${busy}`)
	}
	return payload as T
}

// ── formatting ──────────────────────────────────────────────────────────────────
// Tool results are text an agent reads, so they are formatted rather than dumped as
// JSON: half the tokens, and every id an agent needs to chain the next call stays
// visible instead of buried in a nested object.

/** Search snippets arrive with control-character hit markers (search.ts ▸ HIT_OPEN). */
const HIT_OPEN = '\u0001'
const HIT_CLOSE = '\u0002'

function unmark(text: string): string {
	return text.replaceAll(HIT_OPEN, '«').replaceAll(HIT_CLOSE, '»').replace(/\s+/g, ' ').trim()
}

function clip(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}… [${text.length - max} more chars]` : text
}

interface WorkspaceLike {
	id: string
	workspace_name?: string | null
	pr_title?: string | null
	branch?: string | null
	directory_name?: string | null
	repo_name?: string | null
	state?: string | null
	archived?: boolean
}

/** Conductor's own title precedence, third copy — see reads.ts ▸ workspaceTitle for why. */
function label(w: WorkspaceLike): string {
	const branch = w.branch ?? ''
	const slug = branch.includes('/') ? branch.slice(branch.indexOf('/') + 1) : branch
	const words = slug.replace(/[-_]/g, ' ').trim()
	const humanized = words ? words[0].toUpperCase() + words.slice(1) : ''
	return w.workspace_name || w.pr_title || humanized || w.directory_name || w.id.slice(0, 8)
}

// ── tools ───────────────────────────────────────────────────────────────────────

interface Tool {
	name: string
	description: string
	inputSchema: Record<string, unknown>
	run: (args: Record<string, unknown>) => Promise<string>
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function need(args: Record<string, unknown>, key: string): string {
	const v = str(args[key])
	if (!v) throw new Error(`${key} is required`)
	return v
}

const TOOLS: Tool[] = [
	{
		name: 'search_chats',
		description:
			'Full-text search every Conductor chat on this Mac, archived workspaces included, and get back the workspaces that discussed it with the matching excerpts. Use this to answer "which workspace did I do X in" or "what did we decide about X". Searches the prompts the user typed and the agent replies, not tool output. Results carry workspace_id and session_id for read_chat.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Plain words. Punctuation and operators are ignored, not parsed.' },
				limit: { type: 'number', description: 'Max workspaces to return (default 12, max 50).' }
			},
			required: ['query']
		},
		run: async args => {
			const query = need(args, 'query')
			const limit = num(args.limit)
			const data = await relay<{
				results: {
					workspace: WorkspaceLike & { updated_at: string }
					sessionId: string | null
					sessionTitle: string | null
					hits: number
					byName: boolean
					snippets: { role: string; at: string; text: string }[]
				}[]
				index: { ready: boolean; progress: number; chunks: number; error?: string }
			}>(`/api/search?q=${encodeURIComponent(query)}${limit ? `&limit=${limit}` : ''}`)

			const lines: string[] = []
			if (data.index.error) lines.push(`! chat index unavailable (${data.index.error}) — names matched only`)
			else if (!data.index.ready)
				lines.push(`! still indexing (${Math.round(data.index.progress * 100)}%) — older chats not searchable yet`)
			if (!data.results.length) return [...lines, `no workspace or chat matches ${JSON.stringify(query)}`].join('\n')

			for (const r of data.results) {
				const w = r.workspace
				const tags = [w.repo_name, w.branch, w.archived ? 'ARCHIVED' : w.state].filter(Boolean).join(' · ')
				lines.push('')
				lines.push(`## ${label(w)}`)
				lines.push(`${tags}${r.byName ? ' · name match' : ''}`)
				lines.push(`workspace_id: ${w.id}${r.sessionId ? `  session_id: ${r.sessionId}` : ''}`)
				if (r.hits) lines.push(`${r.hits} matching message${r.hits === 1 ? '' : 's'}:`)
				for (const s of r.snippets) lines.push(`  [${s.role}] ${clip(unmark(s.text), 400)}`)
			}
			return lines.join('\n').trim()
		}
	},
	{
		name: 'read_chat',
		description:
			'Read a Conductor chat transcript by session_id, newest messages last. Works for archived workspaces, which is how you read work that has been put away. Tool calls and tool output are summarised to one line each; the prose is verbatim.',
		inputSchema: {
			type: 'object',
			properties: {
				session_id: { type: 'string', description: 'From search_chats or list_chats.' },
				limit: { type: 'number', description: 'How many trailing entries to return (default 40, max 400).' },
				include_tools: { type: 'boolean', description: 'Include tool-call and thinking rows (default false).' }
			},
			required: ['session_id']
		},
		run: async args => {
			const sessionId = need(args, 'session_id')
			const limit = Math.min(400, Math.max(1, num(args.limit) ?? 40))
			const includeTools = args.include_tools === true
			const data = await relay<{ entries: { role: string; text: string; tool?: string; detail?: string }[] }>(
				`/api/sessions/${encodeURIComponent(sessionId)}/messages?after=0`,
				{ timeoutMs: 30_000 }
			)
			const wanted = includeTools ? data.entries : data.entries.filter(e => e.role === 'user' || e.role === 'assistant')
			if (!wanted.length) return `no messages in session ${sessionId}`
			const tail = wanted.slice(-limit)
			const head = tail.length < wanted.length ? [`(last ${tail.length} of ${wanted.length} entries)`] : []
			return [
				...head,
				...tail.map(e => {
					if (e.role === 'tool') return `[tool ${e.tool ?? ''}] ${clip(e.text, 200)}${e.detail ? ` — ${e.detail}` : ''}`
					return `[${e.role}] ${clip(e.text, 4000)}`
				})
			].join('\n\n')
		}
	},
	{
		name: 'list_workspaces',
		description:
			'List the live (non-archived) Conductor workspaces with what each one is doing right now: agent status, model, branch, PR state. Use this to see what is running before starting or steering anything.',
		inputSchema: {
			type: 'object',
			properties: {
				status: {
					type: 'string',
					description: 'Filter by live agent status: working | idle | error. Omit for all.'
				}
			}
		},
		run: async args => {
			const status = str(args.status)
			const data = await relay<{
				workspaces: (WorkspaceLike & {
					session_status?: string | null
					model?: string | null
					active_session_id?: string | null
					updated_at: string
					pr_number?: number | null
					pr_status?: string | null
				})[]
			}>('/api/state')
			const shown = status ? data.workspaces.filter(w => w.session_status === status) : data.workspaces
			if (!shown.length) return status ? `no workspace is ${status}` : 'no live workspaces'
			return shown
				.map(w =>
					[
						`${w.session_status === 'working' ? '▶' : '·'} ${label(w)}`,
						`    ${[w.repo_name, w.branch, w.model, w.pr_number ? `PR #${w.pr_number} ${w.pr_status ?? ''}`.trim() : null].filter(Boolean).join(' · ')}`,
						`    workspace_id: ${w.id}${w.active_session_id ? `  session_id: ${w.active_session_id}` : ''}`
					].join('\n')
				)
				.join('\n')
		}
	},
	{
		name: 'list_chats',
		description:
			'List the chat tabs in a workspace, with each one’s status and when its current turn started. A workspace can hold several conversations; send_prompt and read_chat address one of them.',
		inputSchema: {
			type: 'object',
			properties: { workspace_id: { type: 'string' } },
			required: ['workspace_id']
		},
		run: async args => {
			const id = need(args, 'workspace_id')
			const data = await relay<{
				sessions: { id: string; title: string | null; status: string | null; model: string | null }[]
			}>(`/api/workspaces/${encodeURIComponent(id)}/sessions`)
			if (!data.sessions.length) return `no chats in workspace ${id}`
			return data.sessions
				.map(
					s =>
						`${s.status === 'working' ? '▶' : '·'} ${s.title ?? '(untitled)'} — ${s.status ?? '?'} · ${s.model ?? '?'}\n    session_id: ${s.id}`
				)
				.join('\n')
		}
	},
	{
		name: 'workspace_diff',
		description: 'The git diff of a live workspace against its target branch, untracked files included.',
		inputSchema: {
			type: 'object',
			properties: { workspace_id: { type: 'string' } },
			required: ['workspace_id']
		},
		run: async args => {
			const id = need(args, 'workspace_id')
			const data = await relay<{ files?: { path: string; additions: number; deletions: number }[]; diff?: string }>(
				`/api/workspaces/${encodeURIComponent(id)}/diff`,
				{ timeoutMs: 30_000 }
			)
			if (!data.files?.length) return 'no changes against the target branch'
			return data.files.map(f => `${f.path}  +${f.additions} -${f.deletions}`).join('\n')
		}
	},
	{
		name: 'list_repos',
		description:
			'The repos Conductor can create a workspace in. Use before create_workspace to get an exact repo name.',
		inputSchema: { type: 'object', properties: {} },
		run: async () => {
			const data = await relay<{ repos: { name: string; default_branch: string | null; root_path: string | null }[] }>(
				'/api/repos'
			)
			return data.repos.map(r => `${r.name}  (${r.default_branch ?? '?'})  ${r.root_path ?? ''}`).join('\n')
		}
	},
	{
		name: 'create_workspace',
		description:
			'Start a new Conductor workspace in a repo, optionally with a first prompt. This is the one write that touches no UI: it opens a Conductor deep link, so it needs no Accessibility and steals no focus. Returns as soon as the workspace row exists (~2s); the worktree may still be setting up and the relay delivers the first prompt on its own schedule once it is ready.',
		inputSchema: {
			type: 'object',
			properties: {
				repo: { type: 'string', description: 'Exact name from list_repos.' },
				prompt: { type: 'string', description: 'First prompt for the new agent. Omit to open an empty workspace.' },
				wait_for_send: {
					type: 'boolean',
					description: 'Block until the first prompt is actually delivered (can take 30s+). Default false.'
				}
			},
			required: ['repo']
		},
		run: async args => {
			const repo = need(args, 'repo')
			const prompt = str(args.prompt)
			const send = args.wait_for_send === true
			const data = await relay<{
				workspaceId: string
				workspace?: WorkspaceLike
				pendingPrompt?: string
				sent?: boolean
				warning?: string
			}>('/api/workspaces', {
				method: 'POST',
				body: { repo, prompt, send },
				timeoutMs: send ? WRITE_TIMEOUT_MS : 30_000
			})
			const lines = [
				`created ${data.workspace ? label(data.workspace) : data.workspaceId}`,
				`workspace_id: ${data.workspaceId}`
			]
			if (data.warning) lines.push(`! ${data.warning}`)
			else if (data.pendingPrompt && !data.sent)
				lines.push('the first prompt is queued — the relay sends it once the worktree is ready')
			else if (data.sent) lines.push('the first prompt was delivered')
			return lines.join('\n')
		}
	},
	{
		name: 'send_prompt',
		description:
			'Send a prompt into an existing Conductor chat, exactly as typing it on the Mac would. This DRIVES THE REAL UI: it focuses the workspace, selects the chat tab and presses Enter, so it steals focus for a few seconds. If that chat is already working, the message STEERS the running agent rather than starting a new turn — do not use it to poll or test. Ask the user before sending into a chat they did not name.',
		inputSchema: {
			type: 'object',
			properties: {
				session_id: { type: 'string', description: 'The chat to send to (list_chats / search_chats).' },
				workspace_id: {
					type: 'string',
					description: 'Its workspace. Strongly recommended: it is what the relay asserts against before typing.'
				},
				text: { type: 'string' }
			},
			required: ['session_id', 'text']
		},
		run: async args => {
			const sessionId = need(args, 'session_id')
			const text = need(args, 'text')
			const data = await relay<{ ok: boolean; parked?: boolean; error?: string; warning?: string }>(
				`/api/sessions/${encodeURIComponent(sessionId)}/prompt`,
				{ method: 'POST', body: { text, workspaceId: str(args.workspace_id) }, timeoutMs: WRITE_TIMEOUT_MS }
			)
			if (data.parked) return 'the Mac is locked — the prompt is parked and will be sent on unlock'
			if (!data.ok) throw new Error(data.error ?? 'the send did not land')
			return data.warning ? `sent (${data.warning})` : 'sent'
		}
	},
	{
		name: 'stop_turn',
		description:
			'Cancel the answer a chat is currently streaming — Conductor’s own "Cancel agent". Drives the real UI. A chat that already finished answers alreadyIdle, which is a success. This destroys the in-flight work of another agent, so ask the user first.',
		inputSchema: {
			type: 'object',
			properties: {
				session_id: { type: 'string' },
				workspace_id: {
					type: 'string',
					description: 'Required in practice — the relay asserts the pane against it before pressing.'
				}
			},
			required: ['session_id']
		},
		run: async args => {
			const sessionId = need(args, 'session_id')
			const data = await relay<{ ok: boolean; alreadyIdle?: boolean; error?: string }>(
				`/api/sessions/${encodeURIComponent(sessionId)}/stop`,
				{ method: 'POST', body: { workspaceId: str(args.workspace_id) }, timeoutMs: WRITE_TIMEOUT_MS }
			)
			if (data.alreadyIdle) return 'that chat had already finished — nothing to stop'
			if (!data.ok) throw new Error(data.error ?? 'the stop did not land')
			return 'stopped'
		}
	},
	{
		name: 'set_workspace_status',
		description:
			'Set a workspace’s status in Conductor’s sidebar (backlog, in-progress, in-review, done, canceled). Drives the real UI through the sidebar row menu, but changes nothing on screen. Fails if the sidebar section holding that row is collapsed, because a collapsed row is invisible to Accessibility and there is no fallback.',
		inputSchema: {
			type: 'object',
			properties: {
				workspace_id: { type: 'string' },
				status: { type: 'string', enum: ['backlog', 'in-progress', 'in-review', 'done', 'canceled'] }
			},
			required: ['workspace_id', 'status']
		},
		run: async args => {
			const id = need(args, 'workspace_id')
			const status = need(args, 'status')
			const data = await relay<{ ok: boolean; error?: string }>(`/api/workspaces/${encodeURIComponent(id)}/status`, {
				method: 'POST',
				body: { status },
				timeoutMs: WRITE_TIMEOUT_MS
			})
			if (!data.ok) throw new Error(data.error ?? 'the status change did not land')
			return `status set to ${status}`
		}
	}
]

// ── JSON-RPC 2.0 over newline-delimited stdio ───────────────────────────────────

interface Request {
	jsonrpc: '2.0'
	id?: string | number | null
	method: string
	params?: Record<string, unknown>
}

function write(message: unknown): void {
	process.stdout.write(`${JSON.stringify(message)}\n`)
}

function reply(id: Request['id'], result: unknown): void {
	if (id === undefined || id === null) return
	write({ jsonrpc: '2.0', id, result })
}

function fail(id: Request['id'], code: number, message: string): void {
	if (id === undefined || id === null) return
	write({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handle(req: Request): Promise<void> {
	switch (req.method) {
		case 'initialize': {
			const asked = str(req.params?.protocolVersion)
			return reply(req.id, {
				// Echo the client's version when we know it, else name our newest. A client
				// that can't live with the answer disconnects, which is the spec's own path.
				protocolVersion: asked && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
				capabilities: { tools: {} },
				serverInfo: { name: 'conductor-remote', version: '1' },
				instructions:
					'Drives local Conductor agents through the conductor-remote relay. search_chats and read_chat reach archived workspaces, which is where most finished work lives. create_workspace touches no UI. send_prompt, stop_turn and set_workspace_status drive the real Mac UI and steal focus for a few seconds — confirm with the user before using them on a chat they did not name.'
			})
		}
		// Notifications carry no id and take no response.
		case 'notifications/initialized':
		case 'notifications/cancelled':
			return
		case 'ping':
			return reply(req.id, {})
		case 'tools/list':
			return reply(req.id, {
				tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
			})
		case 'tools/call': {
			const name = str(req.params?.name)
			const tool = TOOLS.find(t => t.name === name)
			if (!tool) return fail(req.id, -32602, `unknown tool: ${name}`)
			const args = (req.params?.arguments as Record<string, unknown> | undefined) ?? {}
			try {
				const text = await tool.run(args)
				return reply(req.id, { content: [{ type: 'text', text: text || '(no output)' }] })
			} catch (err) {
				// A tool failure is a result the model should see and can act on, not a
				// protocol error that would hide the reason behind a transport code.
				const message = err instanceof Error ? err.message : String(err)
				return reply(req.id, { content: [{ type: 'text', text: message }], isError: true })
			}
		}
		default:
			return fail(req.id, -32601, `method not found: ${req.method}`)
	}
}

/**
 * In-flight calls, so end-of-stdin doesn't kill work that hasn't answered.
 *
 * A tool call is an await on the relay, and a UI write can take tens of seconds.
 * Exiting straight from the `close` event drops every one of those on the floor —
 * which is silent, because the reply that never came looks exactly like a client
 * that stopped listening.
 */
const inFlight = new Set<Promise<unknown>>()
let stdinClosed = false

function exitWhenDrained(): void {
	if (stdinClosed && inFlight.size === 0) process.exit(0)
}

const lines = createInterface({ input: process.stdin })
lines.on('line', line => {
	const trimmed = line.trim()
	if (!trimmed) return
	let req: Request
	try {
		req = JSON.parse(trimmed) as Request
	} catch {
		// JSON-RPC 2.0: a parse error is answered with a null id, because there is no id
		// to echo. `fail` refuses null on purpose (that is how notifications stay silent),
		// so this one case is written directly.
		return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })
	}
	// Concurrent by design: sequencing is the client's job, and the writes that truly
	// cannot overlap are serialized by the relay's own UI lock, not by this loop.
	const done = handle(req)
		.catch(err => fail(req.id, -32603, err instanceof Error ? err.message : String(err)))
		.finally(() => {
			inFlight.delete(done)
			exitWhenDrained()
		})
	inFlight.add(done)
})
lines.on('close', () => {
	stdinClosed = true
	exitWhenDrained()
})

console.error(`conductor-remote mcp — ${TOOLS.length} tools, relay at ${relayBase()}`)
