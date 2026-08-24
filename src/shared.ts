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
 * Markers the relay wraps search hits in (src/search.ts, via FTS5 `snippet()`). They
 * are control characters, so they must never reach the DOM: an unsplit snippet renders
 * as invisible garbage between the words it was meant to emphasise.
 */
export const HIT_OPEN = '\u0001'
export const HIT_CLOSE = '\u0002'
