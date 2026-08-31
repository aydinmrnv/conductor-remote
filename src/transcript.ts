/**
 * Conductor stores each turn's raw Claude Code SDK stream JSON in
 * `session_messages.content`. User-typed prompts are stored as plain text.
 * This turns a row into compact, phone-renderable entries.
 *
 * Classification rule (verified against the whole DB): a JSON frame with
 * `type:"user"` is ALWAYS tool plumbing — every one of them carries
 * tool_result blocks, never the user's own words. Real prompts are the
 * plain-text rows. Never render an SDK user frame as a user bubble.
 */

export interface TranscriptEntry {
	id: string
	rowid: number
	/** Display role: user | assistant | tool | thinking | system */
	role: 'user' | 'assistant' | 'tool' | 'thinking' | 'system'
	/** Human-readable text. For tool rows: the call's description, else the tool name. */
	text: string
	/** Tool name when role === 'tool'. */
	tool?: string
	/** Full mono secondary detail for tool rows (command, path, pattern, …). */
	detail?: string
	/** True when this row is a failed tool result. */
	error?: boolean
	ts: string
	/** True when the message is queued but not yet sent (queue_order set, sent_at null). */
	queued: boolean
}

interface RawRow {
	rowid: number
	id: string
	role: string | null
	content: string | null
	full_message: string | null
	created_at: string
	sent_at: string | null
	queue_order: number | null
}

interface SdkBlock {
	type: string
	text?: string
	thinking?: string
	name?: string
	input?: unknown
	content?: unknown
	is_error?: boolean
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** Make tool details repo-relative: absolute worktree paths waste the whole line on a phone. */
function stripWorktree(s: string, worktree: string | null): string {
	if (!worktree) return s
	// Conductor prefixes commands with `cd <worktree>` (newline- or &&-joined) — drop the whole clause.
	if (s.startsWith(`cd ${worktree}`)) s = s.slice(`cd ${worktree}`.length).replace(/^\s*(&&)?\s*/, '')
	return s.replaceAll(`${worktree}/`, '').replaceAll(worktree, '.')
}

/**
 * Mirror Conductor's tool rows: the human description as the title (Bash always
 * has one), the primary input as mono detail. The phone truncates that detail in
 * the closed row and reveals this full value on demand. Tools without a recognizable
 * primary input get the title alone — dumping raw JSON is noise.
 */
function summarizeToolUse(name: string, input: unknown, worktree: string | null): { text: string; detail?: string } {
	if (!input || typeof input !== 'object') return { text: name }
	const o = input as Record<string, unknown>
	const text = str(o.description) ?? name
	const detail =
		str(o.command) ?? str(o.file_path) ?? str(o.path) ?? str(o.pattern) ?? str(o.url) ?? str(o.skill) ?? str(o.prompt)
	if (!detail || detail === text) return { text }
	return { text, detail: stripWorktree(detail, worktree) }
}

function resultText(content: unknown): string {
	let s = ''
	if (typeof content === 'string') s = content
	else if (Array.isArray(content)) {
		s = content
			.map(c => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
			.join('')
	}
	return clip(s.replace(/<\/?tool_use_error>/g, '').trim(), 400)
}

export function parseMessage(row: RawRow, worktree: string | null = null): TranscriptEntry[] {
	const queued = row.queue_order !== null && row.sent_at === null
	const base = { rowid: row.rowid, ts: row.created_at, queued }
	const content = row.content ?? ''

	// Plain user prompt (not SDK JSON) — the only source of real user bubbles.
	if (!content.startsWith('{')) {
		if (!content.trim()) return []
		return [{ ...base, id: row.id, role: 'user', text: content }]
	}

	let parsed: { type?: string; subtype?: string; message?: { content?: SdkBlock[] } }
	try {
		parsed = JSON.parse(content)
	} catch {
		return [{ ...base, id: row.id, role: 'system', text: clip(content, 200) }]
	}

	// Bookkeeping frames: hooks, init, token accounting, end-of-turn results.
	if (parsed.type === 'system' || parsed.type === 'result') return []

	// How a stopped turn ends: `{"type":"error","content":"aborted by user"}`, and it
	// carries no `message.content`, so without this it fell through to the raw-JSON
	// dump below. That was tolerable while stopping needed a Mac; the phone can do it
	// now (`POST /api/sessions/:id/stop`), so it is the last line of every stopped
	// chat. The SDK's own wording is kept rather than reworded — "aborted by user" is
	// already plain, and inventing a phrase here would drift from what the desktop shows.
	if (parsed.type === 'error') {
		const said = str((parsed as { content?: unknown }).content)
		if (said) return [{ ...base, id: row.id, role: 'system', text: clip(said, 200) }]
	}

	const blocks = parsed.message?.content
	if (!Array.isArray(blocks)) {
		if (parsed.type === 'user' || parsed.type === 'assistant') return []
		// Unknown frame shape — keep a dim raw dump so Conductor drift stays visible.
		return [{ ...base, id: row.id, role: 'system', text: clip(content, 200) }]
	}

	const entries: TranscriptEntry[] = []
	const push = (e: Pick<TranscriptEntry, 'role' | 'text'> & Partial<TranscriptEntry>) =>
		entries.push({ ...base, ...e, id: `${row.id}:${entries.length}` })

	let pending: string[] = []
	const flush = () => {
		const text = pending.join('\n').trim()
		if (text) push({ role: 'assistant', text })
		pending = []
	}

	for (const b of blocks) {
		if (b.type === 'text' && typeof b.text === 'string') {
			// Text inside an SDK user frame would be injected context, not the user.
			if (parsed.type !== 'user') pending.push(b.text)
		} else if (b.type === 'thinking') {
			flush()
			const text = str(b.thinking) ?? str(b.text)
			if (text) push({ role: 'thinking', text })
		} else if (b.type === 'tool_use' && typeof b.name === 'string') {
			flush()
			push({ role: 'tool', tool: b.name, ...summarizeToolUse(b.name, b.input, worktree) })
		} else if (b.type === 'tool_result' && b.is_error) {
			// Successful results are noise on a phone; surface only failures.
			flush()
			push({ role: 'tool', error: true, text: resultText(b.content) || '(tool error)' })
		}
	}
	flush()
	return entries
}

// ── rendering ───────────────────────────────────────────────────────────────────

/**
 * What a rendered transcript carries beyond the prose.
 *
 * The base is what Conductor's own "Copy concise transcript" produces: the user's
 * prompts and the agent's replies, verbatim, with a marker where anything was left
 * out. The two flags are the cuts Conductor cannot make. Its concise copy drops
 * thinking, which is the half of a long chat that explains *why*, and its full copy
 * brings the tool churn back with it — 98.8% of the bytes and the least re-readable
 * part. `include_tools` on `read_chat` already means exactly this, so the words are
 * reused rather than invented.
 */
export interface TranscriptFormat {
	thinking: boolean
	tools: boolean
}

/** What a render left out, so the caller can say so instead of implying completeness. */
export interface TranscriptElisions {
	thinking: number
	tools: number
}

const HEADINGS: Record<TranscriptEntry['role'], string> = {
	user: 'User',
	assistant: 'Assistant',
	thinking: 'Thinking',
	tool: 'Tools',
	system: 'System'
}

/** One tool row per line, the shape `read_chat` prints: what it did, then what it did it to. */
function toolLine(e: TranscriptEntry): string {
	if (e.error) return `- [error] ${e.text}`
	return `- [${e.tool ?? 'tool'}] ${e.text}${e.detail ? ` — \`${e.detail}\`` : ''}`
}

function plural(n: number, one: string): string {
	return `${n} ${one}${n === 1 ? '' : 's'}`
}

/**
 * A chat as markdown, in Conductor's own transcript layout.
 *
 * The layout is copied from the files Conductor writes (`Transcript of <chat>.md`):
 * an `##` heading per role, prose verbatim under it, and an elision marker for what
 * was dropped. The heading comes *before* the marker — a run of tool calls between a
 * prompt and its answer prints as `## Assistant`, then the marker, then the reply —
 * which is what makes the result read like Conductor's own file rather than a log.
 *
 * The marker says what kind of thing went missing rather than only how many, because
 * this render is configurable and Conductor's is not: "12 tool calls elided" tells
 * you a flag was off, where a bare count reads as noise nobody wanted.
 *
 * `system` rows are always kept. They are rare, short, and one of them is how a
 * cancelled turn ends ("aborted by user") — the single line that explains why an
 * answer stops mid-thought, and dropping it would leave the next agent to guess.
 */
export function renderTranscript(
	entries: TranscriptEntry[],
	format: TranscriptFormat
): { text: string; kept: number; elided: TranscriptElisions } {
	const out: string[] = []
	const elided: TranscriptElisions = { thinking: 0, tools: 0 }
	const pending: TranscriptElisions = { thinking: 0, tools: 0 }
	let heading: string | null = null
	let kept = 0

	const flushElisions = () => {
		const parts: string[] = []
		if (pending.tools) parts.push(plural(pending.tools, 'tool call'))
		if (pending.thinking) parts.push(plural(pending.thinking, 'thinking block'))
		pending.tools = 0
		pending.thinking = 0
		if (parts.length) out.push(`[${parts.join(', ')} elided]`)
	}

	for (const e of entries) {
		if (e.role === 'thinking' && !format.thinking) {
			pending.thinking++
			elided.thinking++
			continue
		}
		if (e.role === 'tool' && !format.tools) {
			pending.tools++
			elided.tools++
			continue
		}
		const want = HEADINGS[e.role]
		if (want !== heading) {
			out.push(`## ${want}`)
			heading = want
		}
		flushElisions()
		out.push(e.role === 'tool' ? toolLine(e) : e.text)
		kept++
	}
	// Anything dropped after the last kept entry still has to be admitted to.
	flushElisions()

	// Tool rows are a list, so consecutive ones share a paragraph; everything else is
	// separated by a blank line, which is what makes the markdown render as prose.
	const text = out
		.map((line, i) => (line.startsWith('- ') && out[i + 1]?.startsWith('- ') ? `${line}\n` : `${line}\n\n`))
		.join('')
		.trim()
	return { text: `${text}\n`, kept, elided }
}
