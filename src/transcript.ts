/**
 * Conductor stores each turn's raw Claude Code SDK stream JSON in
 * `session_messages.content`. User-typed prompts are stored as plain text.
 * This turns a row into a compact, phone-renderable entry.
 */

export interface TranscriptEntry {
	id: string
	rowid: number
	/** Display role: user | assistant | tool | thinking | system */
	role: 'user' | 'assistant' | 'tool' | 'thinking' | 'system'
	/** Human-readable text (may be empty for pure tool rows). */
	text: string
	/** Tool name when role === 'tool'. */
	tool?: string
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
	name?: string
	input?: unknown
	content?: unknown
}

function textFromBlocks(blocks: SdkBlock[]): { text: string; tool?: string } {
	const parts: string[] = []
	let tool: string | undefined
	for (const b of blocks) {
		if (b.type === 'text' && b.text) parts.push(b.text)
		else if (b.type === 'thinking' && typeof b.text === 'string') parts.push(b.text)
		else if (b.type === 'tool_use') {
			tool = b.name
			const inputStr = summarizeToolInput(b.input)
			parts.push(inputStr ? `▸ ${b.name}: ${inputStr}` : `▸ ${b.name}`)
		} else if (b.type === 'tool_result') {
			parts.push(summarizeToolResult(b.content))
		}
	}
	return { text: parts.join('\n').trim(), tool }
}

function summarizeToolInput(input: unknown): string {
	if (!input || typeof input !== 'object') return ''
	const o = input as Record<string, unknown>
	const key = o.command ?? o.file_path ?? o.path ?? o.pattern ?? o.description ?? o.prompt
	const s = typeof key === 'string' ? key : JSON.stringify(o)
	return s.length > 140 ? `${s.slice(0, 140)}…` : s
}

function summarizeToolResult(content: unknown): string {
	let s = ''
	if (typeof content === 'string') s = content
	else if (Array.isArray(content)) {
		s = content
			.map(c => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
			.join('')
	}
	s = s.trim()
	if (!s) return '↳ (result)'
	return `↳ ${s.length > 200 ? `${s.slice(0, 200)}…` : s}`
}

export function parseMessage(row: RawRow): TranscriptEntry | null {
	const queued = row.queue_order !== null && row.sent_at === null
	const base = { id: row.id, rowid: row.rowid, ts: row.created_at, queued }
	const content = row.content ?? ''

	// Plain user prompt (not SDK JSON).
	if (!content.startsWith('{')) {
		if (!content.trim()) return null
		return { ...base, role: 'user', text: content }
	}

	let parsed: { type?: string; subtype?: string; message?: { content?: SdkBlock[] } }
	try {
		parsed = JSON.parse(content)
	} catch {
		return { ...base, role: 'system', text: content.slice(0, 200) }
	}

	// Skip pure bookkeeping frames (token accounting, etc.).
	if (parsed.type === 'system' && parsed.subtype === 'thinking_tokens') return null
	if (parsed.type === 'result') return null

	const blocks = parsed.message?.content
	if (Array.isArray(blocks)) {
		const { text, tool } = textFromBlocks(blocks)
		if (!text) return null
		if (tool) return { ...base, role: 'tool', text, tool }
		if (parsed.type === 'user') return { ...base, role: 'user', text }
		return { ...base, role: 'assistant', text }
	}

	if (parsed.type === 'system') return null
	return { ...base, role: 'system', text: content.slice(0, 200) }
}
