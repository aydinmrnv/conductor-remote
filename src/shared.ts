/**
 * The handful of things the relay and the phone must compute *identically*, in the
 * one place both can import.
 *
 * `src/` and `web/src/` are one TypeScript project (tsconfig.json includes both), so
 * a plain relative import crosses between them fine. What does not cross is Node: the
 * moment this file imports `node:anything` it stops being bundleable and every web
 * import of it becomes a build failure. **So this module stays stdlib-free — no
 * `node:` imports, ever.** It is the only file under `src/` the web app may import a
 * *value* from; everything else it may only `import type` (see src/wire.ts), which
 * `verbatimModuleSyntax` erases before the bundler ever sees it.
 *
 * Each of these was a second copy before, and each copy was a way for two screens to
 * disagree about the same workspace.
 */

/** Everything `workspaceTitle` needs — structural, because a search result is a leaner row. */
export interface Titled {
	id: string
	workspace_name: string | null
	pr_title: string | null
	branch: string | null
	directory_name: string | null
}

/**
 * The branch minus its prefix, sentence-cased — Conductor's own fallback title while a
 * workspace is still in progress. Prefix-agnostic (github_username / custom / none): it
 * strips the first path segment rather than reading Conductor's `branch_prefix_type`
 * setting, because the branch already embeds whichever prefix was resolved.
 */
export function humanizeBranch(branch: string | null): string {
	const b = branch ?? ''
	const slug = b.includes('/') ? b.slice(b.indexOf('/') + 1) : b
	const words = slug.replace(/[-_]/g, ' ').trim()
	return words ? words[0].toUpperCase() + words.slice(1) : ''
}

/**
 * Conductor's own sidebar title for a workspace: manual name, then PR title, then the
 * humanized branch, then the worktree codename, then the id.
 *
 * `pr_title` is Conductor's cached PR title, present exactly when the workspace has a PR
 * (in-review or done) and cleared back to empty otherwise, so it is the live sidebar
 * title rather than a stale value. `directory_name` (the worktree codename, e.g.
 * "managua-v2") is the last resort for a branchless workspace.
 *
 * Three callers have to agree — the sidebar list on the phone, the workspace a push
 * notification names (src/notify.ts), and the workspace an MCP tool result names
 * (src/mcp-tools.ts). A notification that titles a workspace differently from the list
 * it came from reads as a different workspace.
 */
export function workspaceTitle(w: Titled): string {
	return w.workspace_name || w.pr_title || humanizeBranch(w.branch) || w.directory_name || w.id.slice(0, 8)
}

/**
 * The words a query actually searches for. The phone filters the live workspace list
 * with these while the relay searches the transcript index with the same call, so two
 * different splits would make one list disagree with the other on the same keystroke.
 */
export function queryTokens(raw: string): string[] {
	return raw.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []
}

/**
 * A temporary `NEW` marker in Conductor's picker is a badge, not part of the
 * model name. The relay and phone use this value for the visible label and for
 * a later selection, so both sides must remove it in the same way.
 */
export function modelPickerLabel(label: string): string {
	return label.endsWith(' NEW') ? label.slice(0, -4) : label
}

/**
 * Markers the relay wraps search hits in (src/search.ts, via FTS5 `snippet()`). They
 * are control characters, so they must never reach the DOM: an unsplit snippet renders
 * as invisible garbage between the words it was meant to emphasise.
 */
export const HIT_OPEN = '\u0001'
export const HIT_CLOSE = '\u0002'

/** One attachment token in Conductor's prompt syntax. */
export interface AttachmentToken {
	/** Character offsets in the prompt, with `end` immediately after the closing parenthesis. */
	start: number
	end: number
	/** The file name shown on Conductor's attachment chip. */
	name: string
	/** The worktree-relative file path the token points to. */
	path: string
}

const ATTACHMENT_PREFIX = '.context/attachments/'

/**
 * Read Conductor attachment tokens from prompt text.
 *
 * `encodeURIComponent` intentionally leaves parentheses alone. Looking for the first
 * closing parenthesis would therefore break an ordinary file such as `diagram (old).png`.
 * Match a candidate only once its decoded path has Conductor's attachment layout and
 * its basename equals the visible name.
 */
export function attachmentTokens(text: string): AttachmentToken[] {
	const tokens: AttachmentToken[] = []
	let offset = 0
	while (offset < text.length) {
		const start = text.indexOf('@⟦', offset)
		if (start < 0) break
		const labelEnd = text.indexOf('⟧(', start + 2)
		if (labelEnd < 0 || /[\r\n]/.test(text.slice(start, labelEnd))) {
			offset = start + 2
			continue
		}
		const name = text.slice(start + 2, labelEnd)
		const pathStart = labelEnd + 2
		let close = pathStart
		let found = false
		while (!found) {
			close = text.indexOf(')', close)
			if (close < 0) break
			const encoded = text.slice(pathStart, close)
			try {
				const filePath = decodeURIComponent(encoded)
				const suffix = filePath.startsWith(ATTACHMENT_PREFIX) ? filePath.slice(ATTACHMENT_PREFIX.length) : ''
				const slash = suffix.indexOf('/')
				const id = slash < 0 ? '' : suffix.slice(0, slash)
				const fileName = slash < 0 ? '' : suffix.slice(slash + 1)
				if (/^[A-Za-z0-9]{6}$/.test(id) && fileName === name && !fileName.includes('/')) {
					tokens.push({ start, end: close + 1, name, path: filePath })
					offset = close + 1
					found = true
					continue
				}
			} catch {
				// Try a later parenthesis. It can be part of an otherwise valid file name.
			}
			close += 1
		}
		if (!found) offset = start + 2
	}
	return tokens
}
