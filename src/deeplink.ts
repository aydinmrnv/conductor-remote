/**
 * The `conductor://` link that creates a workspace (conductor.build/docs/reference/deep-links).
 *
 * Pure on purpose — `writes.ts` opens it, this only spells it — so a test can pin the
 * shape without touching the UI. Parameters sit *flat* after the scheme, not behind a
 * `?`, and every value is URL-encoded (which is also what stops a prompt containing
 * `&path=` from moving the workspace).
 *
 *   - `prompt=…[&path=…]`   pre-fills the composer of a new workspace in that repo
 *   - `linear_id=…[&prompt=…]`  Conductor fetches the Linear issue, picks the repo itself
 *     (needs a connected Linear account), and reuses an existing workspace on the
 *     issue's branch if there is one
 *
 * A bare `path=` opens an empty workspace like Conductor's own New workspace. That form
 * is undocumented but verified live, so suspect it first if creation breaks.
 */
export function createWorkspaceLink(
	scheme: string,
	prompt: string,
	repoPath: string | null,
	linearId?: string | null
): string | null {
	const id = linearId?.trim() ?? ''
	const text = prompt.trim()
	if (!text && !repoPath && !id) return null
	const query = [
		id ? `linear_id=${encodeURIComponent(id)}` : '',
		text ? `prompt=${encodeURIComponent(text)}` : '',
		repoPath ? `path=${encodeURIComponent(repoPath)}` : ''
	]
		.filter(Boolean)
		.join('&')
	return `${scheme}://${query}`
}

/**
 * The Linear identifier out of whatever was pasted: `ENG-123`, or a
 * `linear.app/<team>/issue/ENG-123/<slug>` link. Null when neither.
 */
export function linearIssueId(raw: string): string | null {
	const text = raw.trim()
	if (!text) return null
	const fromUrl = text.match(/\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)/)
	if (fromUrl) return fromUrl[1].toUpperCase()
	const bare = text.match(/^([A-Za-z][A-Za-z0-9]*-\d+)$/)
	return bare ? bare[1].toUpperCase() : null
}
