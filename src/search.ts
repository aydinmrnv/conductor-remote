import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ConductorDb } from './db.ts'
import { HIT_CLOSE, HIT_OPEN } from './shared.ts'
import { parseMessage } from './transcript.ts'

/**
 * Full-text search over the chat history, in a sidecar DB the relay owns.
 *
 * Two facts decide the whole shape of this file.
 *
 * **Prose is a few percent of the transcript.** Measured over this Mac's 1.7M
 * `session_messages` rows (3,106 MB of `content`): tool_result output is 799 MB,
 * `type:"system"` frames 522 MB, tool_use arguments 162 MB — and what a person
 * would ever search for is prose. So this indexes prose only. A grep of the raw
 * column would be a 3 GB scan, and it would rank a file dump the agent happened
 * to `cat` above the sentence that explained the decision.
 *
 * **Thinking counts as prose, and it is the bigger half.** Re-measured 2026-08-25:
 * assistant text is 36.9 MB over 93,189 blocks, typed prompts 2.6 MB over 19,432
 * rows, and thinking **82.7 MB over 102,776 blocks** — more than the other two
 * together. Skipping it was the original cut and it was wrong: the chat view
 * *renders* thinking, so a hit there opens to something you can read, and the
 * reasoning is where a decision gets explained before the reply summarises it.
 * Note the shape trap behind the source query below: **every thinking block sits
 * in a row with no text block beside it** (0 of 102,773 rows carry both), so a
 * prefilter written for `"type":"text"` excludes 100% of thinking rather than
 * some of it — the bug that made this cut invisible.
 *
 * The cost is paid up front and it is bounded. Same machine, same history, five
 * real queries at `CHUNK_LIMIT`: 112,571 chunks → **208,131**, 77 MB → 230 MB,
 * 7.6s → **12.3s** to build, and 12–57ms → **25–137ms** per query. The worst case
 * still fits inside the phone's 250ms search-as-you-type debounce, which is the
 * only latency budget that binds here. (The 1–7ms this comment used to claim was
 * measured on a smaller history and no longer held even before thinking: v1
 * measures 12–57ms today.)
 *
 * **`node:sqlite` ships FTS5.** Porter stemming, `bm25()`, `snippet()`, `NEAR()`
 * all work on the bundled SQLite (3.51.2), so the index costs no runtime
 * dependency — which the tarball rule requires (see CLAUDE.md ▸ Traps).
 *
 * The index is **never** written into `conductor.db`. That handle is read-only and
 * stays that way; this opens its own file under the relay's state dir, and it is
 * disposable — delete it and the next start rebuilds it.
 */

/** Bump to force a rebuild: a tokenizer or extraction change makes every stored chunk wrong. */
const SCHEMA_VERSION = 2

/**
 * Source rows advanced per tick. The cursor moves by *scanned* rowid rather than
 * matched rowid, so a caught-up index re-scans nothing — get that wrong and every
 * idle poll re-reads the 3 GB tail looking for rows it already rejected.
 */
const WINDOW_ROWS = 4000

/** Yield to the event loop between batches: the backfill is ~19ms of blocking work per window. */
const BACKFILL_PAUSE_MS = 5

/** Once caught up, look for new messages at about the rate a chat produces them. */
const IDLE_POLL_MS = 15_000

/** A pathological single message can't be allowed to dominate the index. */
const MAX_CHUNK_CHARS = 64_000

/** How many chunks a query ranks before they are folded into workspaces. */
const CHUNK_LIMIT = 300

/**
 * Snippet highlight markers, from `src/shared.ts` because the phone splits on the
 * same two characters (`web/src/lib/format.ts` ▸ `splitSnippet`). Control characters
 * rather than brackets: they survive JSON, they need no escaping on the way to the
 * phone, and no transcript contains them, so the client needs no parser. The client
 * must not render them literally.
 */
export { HIT_CLOSE, HIT_OPEN } from './shared.ts'

/**
 * Which kind of prose matched. `thinking` is separate from `assistant` on purpose:
 * a hit there is reasoning the agent never said out loud, and labelling it as the
 * agent's answer would misread it. The three are exactly `TranscriptEntry['role']`
 * minus the parts this index skips (`tool`, `system`).
 */
export type SearchRole = 'user' | 'assistant' | 'thinking'

/** The `TranscriptEntry` roles this index keeps, and the set `search()` maps a stored role back through. */
const INDEXED_ROLES = new Set<string>(['user', 'assistant', 'thinking'] satisfies SearchRole[])

export interface SearchHit {
	sessionId: string
	/** `session_messages.rowid` this text came from — the transcript's own cursor. */
	srcRowid: number
	role: SearchRole
	at: string
	/** Higher is better. BM25 negated, so callers can sum and sort descending. */
	score: number
	/** Matching excerpt, with hits wrapped in HIT_OPEN/HIT_CLOSE. */
	snippet: string
}

export interface IndexStatus {
	/** Chunks indexed so far. */
	chunks: number
	/** True once the backfill has reached the newest message. */
	ready: boolean
	/** 0–1 through the source rows; 1 when caught up. */
	progress: number
	/** Present when the sidecar DB could not be opened at all. */
	error?: string
}

/**
 * Turn a phone query into an FTS5 MATCH expression.
 *
 * Every token is quoted, because FTS5 reads `-`, `*`, `:`, `(`, `AND`, `NEAR` and
 * friends as syntax: an unquoted apostrophe or hyphen is a *parse error*, not a
 * poor result, so a raw query would fail rather than under-match. Tokens are OR'd
 * because someone reaching for a workspace on a phone is recalling it, not
 * filtering it — BM25 is what puts the message matching four of four words above
 * the one matching one, and requiring all four would return nothing whenever a
 * single word is misremembered.
 *
 * The last token gets a prefix `*` so search-as-you-type matches mid-word, but only
 * from three characters: `"a"*` matches a large fraction of the index and would
 * spend the whole query budget on a keystroke that means nothing yet.
 */
export function matchQuery(raw: string): string | null {
	const tokens = raw.toLowerCase().match(/[\p{L}\p{N}_]+/gu)
	if (!tokens?.length) return null
	const terms = tokens.map(t => `"${t}"`)
	const last = tokens[tokens.length - 1]
	if (!/\s$/.test(raw) && last.length >= 3) terms[terms.length - 1] = `"${last}"*`
	return terms.join(' OR ')
}

/** The tokens `matchQuery` will search for — what a caller matches names against. */
export { queryTokens } from './shared.ts'

interface ChunkRow {
	session_id: string
	src_rowid: number
	role: string
	at: string
	score: number
	snippet: string
}

export class SearchIndex {
	private readonly source: ConductorDb
	private readonly file: string
	private db: DatabaseSync | null = null
	private openError: string | null = null
	private cursor = 0
	private caughtUp = false
	private timer: NodeJS.Timeout | null = null
	private sourceMax = 0

	constructor(source: ConductorDb, file: string) {
		this.source = source
		this.file = file
	}

	/** Open (or rebuild) the sidecar and start indexing in the background. */
	start(): void {
		try {
			this.open()
		} catch (err) {
			// A search index is a convenience; failing to open one must never stop the relay
			// serving state, transcripts or sends. Report it on /api/search instead.
			this.openError = err instanceof Error ? err.message : String(err)
			console.warn(`⚠ search index unavailable (${this.openError}) — /api/search will report it`)
			return
		}
		this.schedule(0)
	}

	stop(): void {
		if (this.timer) clearTimeout(this.timer)
		this.timer = null
	}

	private open(): void {
		fs.mkdirSync(path.dirname(this.file), { recursive: true })
		const db = new DatabaseSync(this.file)
		db.exec('PRAGMA journal_mode = WAL')
		db.exec('PRAGMA synchronous = NORMAL')
		// A dev relay on another port shares this file with the LaunchAgent's. WAL lets them
		// both read; the writer that loses waits rather than throwing away its batch, and a
		// tick that still fails is retried by the scheduler with nothing lost (the cursor
		// only advances on commit).
		db.exec('PRAGMA busy_timeout = 5000')
		db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)')
		const version = Number(this.readMeta(db, 'version') ?? 0)
		if (version !== SCHEMA_VERSION) {
			db.exec('DROP TABLE IF EXISTS chunks')
			db.exec(`
				CREATE VIRTUAL TABLE chunks USING fts5(
					body,
					session_id UNINDEXED,
					src_rowid UNINDEXED,
					role UNINDEXED,
					at UNINDEXED,
					tokenize='porter unicode61'
				)
			`)
			db.prepare('INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)').run('version', String(SCHEMA_VERSION))
			db.prepare('INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)').run('cursor', '0')
			if (version) console.log(`search index schema ${version} → ${SCHEMA_VERSION}, rebuilding`)
		}
		this.db = db
		this.cursor = Number(this.readMeta(db, 'cursor') ?? 0)
	}

	private readMeta(db: DatabaseSync, key: string): string | null {
		const row = db.prepare('SELECT v FROM meta WHERE k = ?').get(key) as { v?: string } | undefined
		return row?.v ?? null
	}

	private schedule(ms: number): void {
		if (this.timer) clearTimeout(this.timer)
		this.timer = setTimeout(() => {
			let more = false
			try {
				more = this.tick()
			} catch (err) {
				console.warn(`⚠ search index tick failed: ${err instanceof Error ? err.message : err}`)
			}
			this.schedule(more ? BACKFILL_PAUSE_MS : IDLE_POLL_MS)
		}, ms)
		this.timer.unref?.()
	}

	/**
	 * Index one window of source rows. Returns true while there is more to do.
	 *
	 * The window is picked by rowid *before* the prose filter runs, so the cursor
	 * advances past rows that hold nothing worth indexing. Filtering first and
	 * advancing to the last match instead would leave a caught-up index re-scanning
	 * every tool_result between the last prose row and the end of the table, every
	 * poll, forever.
	 */
	private tick(): boolean {
		const db = this.db
		if (!db) return false

		const window = this.source.query<{ rowid: number }>(
			'SELECT rowid FROM session_messages WHERE rowid > ? ORDER BY rowid LIMIT ?',
			[this.cursor, WINDOW_ROWS]
		)
		if (!window.length) {
			this.caughtUp = true
			return false
		}
		const end = window[window.length - 1].rowid

		// Only rows that can hold prose: a plain-text prompt, or a frame carrying a text or
		// thinking block. Everything else is tool plumbing and the bulk of the bytes.
		// The thinking clause is not redundant with the text one — the two block types never
		// share a row (see this file's header), so dropping it drops thinking entirely.
		const rows = this.source.query<{
			rowid: number
			id: string
			session_id: string
			role: string | null
			content: string | null
			full_message: string | null
			created_at: string
			sent_at: string | null
			queue_order: number | null
		}>(
			`SELECT rowid, id, session_id, role, content, full_message, created_at, sent_at, queue_order
			 FROM session_messages
			 WHERE rowid > ? AND rowid <= ? AND session_id IS NOT NULL
			   AND (role = 'user' OR content LIKE '%"type":"text"%' OR content LIKE '%"type":"thinking"%')
			 ORDER BY rowid`,
			[this.cursor, end]
		)

		const insert = db.prepare('INSERT INTO chunks(body, session_id, src_rowid, role, at) VALUES (?, ?, ?, ?, ?)')
		db.exec('BEGIN')
		try {
			for (const row of rows) {
				// Reuse the transcript parser rather than a second JSON walk: it already knows
				// that text inside a `type:"user"` frame is injected context and not the user's
				// words, and indexing something the chat view would never show is how a search
				// result becomes impossible to find once you open it.
				for (const entry of parseMessage(row, null)) {
					if (!INDEXED_ROLES.has(entry.role)) continue
					const body = entry.text.trim()
					if (!body) continue
					insert.run(body.slice(0, MAX_CHUNK_CHARS), row.session_id, row.rowid, entry.role, entry.ts)
				}
			}
			db.prepare('INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)').run('cursor', String(end))
			db.exec('COMMIT')
		} catch (err) {
			db.exec('ROLLBACK')
			throw err
		}
		this.cursor = end
		return true
	}

	status(): IndexStatus {
		if (this.openError) return { chunks: 0, ready: false, progress: 0, error: this.openError }
		const db = this.db
		if (!db) return { chunks: 0, ready: false, progress: 0 }
		const chunks = Number((db.prepare('SELECT COUNT(*) c FROM chunks').get() as { c: number }).c)
		if (this.caughtUp) return { chunks, ready: true, progress: 1 }
		// Only re-read the source's high-water mark while backfilling; it costs a query
		// and the answer only matters for the progress bar.
		if (!this.sourceMax) {
			const max = this.source.query<{ m: number | null }>('SELECT MAX(rowid) m FROM session_messages')[0]?.m
			this.sourceMax = max ?? 0
		}
		const progress = this.sourceMax ? Math.min(1, this.cursor / this.sourceMax) : 0
		return { chunks, ready: false, progress }
	}

	/** Top matching chunks, best first. Empty when the query has no searchable tokens. */
	search(raw: string, limit = CHUNK_LIMIT): SearchHit[] {
		const db = this.db
		if (!db) return []
		const match = matchQuery(raw)
		if (!match) return []
		let rows: ChunkRow[]
		try {
			rows = db
				.prepare(
					`SELECT session_id, src_rowid, role, at, -bm25(chunks) AS score,
					        snippet(chunks, 0, ?, ?, '…', 24) AS snippet
					 FROM chunks WHERE chunks MATCH ? ORDER BY bm25(chunks) LIMIT ?`
				)
				.all(HIT_OPEN, HIT_CLOSE, match, limit) as unknown as ChunkRow[]
		} catch (err) {
			// A MATCH that still fails to parse is a bug in matchQuery, not user error —
			// report it rather than showing an empty result that looks like "no matches".
			throw new Error(`search failed for ${JSON.stringify(match)}: ${err instanceof Error ? err.message : err}`)
		}
		return rows.map(r => ({
			sessionId: r.session_id,
			srcRowid: Number(r.src_rowid),
			// An index written before SCHEMA_VERSION 2 is dropped on open, so an unknown role
			// here is a bug rather than an old row — fall back to the neutral one.
			role: INDEXED_ROLES.has(r.role) ? (r.role as SearchRole) : 'assistant',
			at: r.at,
			score: Number(r.score),
			snippet: r.snippet
		}))
	}
}

/** One matching excerpt, as the phone renders it. */
export interface SearchSnippet {
	sessionId: string
	role: SearchRole
	at: string
	/** Hits wrapped in HIT_OPEN/HIT_CLOSE. */
	text: string
}

/** A workspace a search matched, with the evidence. */
export interface SearchResult<W> {
	workspace: W
	/** The chat holding this workspace's strongest passage — where a tap should land. */
	sessionId: string | null
	/** Number of matching messages, all of them. */
	hits: number
	/** Higher is better. The summed score of the snippets below, and only those. */
	score: number
	/** Most recent matching message. */
	at: string | null
	snippets: SearchSnippet[]
	/** True when the workspace's own name/branch matched, rather than (only) its chats. */
	byName: boolean
}

const SNIPPETS_PER_RESULT = 3

/**
 * Fold chunk hits up into workspaces.
 *
 * Chunk-level results are the wrong unit here: one long conversation produces a
 * dozen and buries every other workspace. What to do with those dozen is the whole
 * ranking decision, and it was measured rather than guessed — searching this Mac's
 * history for "removing adding lamp manual", where the right answer is a chat that
 * says "Add by name is gone. Removed the form":
 *
 *   summing every hit   → right answer ranks 9th
 *   best single hit     → 5th
 *   sum of the top 3    → 5th, and steadier across other queries
 *
 * Summing everything ranks by *volume*: a 32-message conversation about lamps beat
 * the four messages that actually removed the feature. So only the best
 * `SNIPPETS_PER_RESULT` hits score, which caps what repetition can buy and makes
 * the number mean something the user can check — the score is exactly the strength
 * of the snippets shown under the row. `hits` still counts them all.
 *
 * Hits whose session no longer resolves to a workspace are dropped; a result nobody
 * can open is worse than one fewer result.
 */
export function foldHits<W extends { id: string }>(
	hits: SearchHit[],
	resolve: (sessionId: string) => W | null
): SearchResult<W>[] {
	const byWorkspace = new Map<string, SearchResult<W> & { bestBySession: Map<string, number> }>()
	for (const hit of hits) {
		const workspace = resolve(hit.sessionId)
		if (!workspace) continue
		let entry = byWorkspace.get(workspace.id)
		if (!entry) {
			entry = {
				workspace,
				sessionId: null,
				hits: 0,
				score: 0,
				at: null,
				snippets: [],
				byName: false,
				bestBySession: new Map()
			}
			byWorkspace.set(workspace.id, entry)
		}
		entry.hits++
		if (!entry.at || hit.at > entry.at) entry.at = hit.at
		entry.bestBySession.set(hit.sessionId, Math.max(entry.bestBySession.get(hit.sessionId) ?? 0, hit.score))
		// `hits` arrives in BM25 order, so the first few of a workspace are its best few:
		// scoring and snippeting the same slice needs no second sort.
		if (entry.snippets.length < SNIPPETS_PER_RESULT) {
			entry.score += hit.score
			entry.snippets.push({ sessionId: hit.sessionId, role: hit.role, at: hit.at, text: hit.snippet })
		}
	}
	const results: SearchResult<W>[] = []
	for (const entry of byWorkspace.values()) {
		const { bestBySession, ...rest } = entry
		let sessionId: string | null = null
		let best = -Infinity
		for (const [id, score] of bestBySession) {
			if (score <= best) continue
			best = score
			sessionId = id
		}
		results.push({ ...rest, sessionId })
	}
	return results.sort((a, b) => b.score - a.score)
}
