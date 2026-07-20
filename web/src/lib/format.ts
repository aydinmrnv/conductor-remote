import type { Workspace } from './types.ts'

export function workspaceLabel(w: Workspace): string {
	return w.workspace_name || humanizeBranch(w.branch) || w.directory_name || w.id.slice(0, 8)
}

/**
 * Conductor's own workspace title: the branch minus its prefix, sentence-cased.
 * Prefix-agnostic (works for github_username/custom/none) — we strip the first
 * path segment rather than read Conductor's `branch_prefix_type` setting, since
 * the branch already embeds the resolved prefix. Falls back to directory_name
 * (the worktree codename, e.g. "managua-v2") only for a branchless workspace.
 */
function humanizeBranch(branch: string | null): string {
	if (!branch) return ''
	const slug = branch.includes('/') ? branch.slice(branch.indexOf('/') + 1) : branch
	const words = slug.replace(/[-_]/g, ' ').trim()
	return words ? words[0].toUpperCase() + words.slice(1) : ''
}

/** Normalize the many status sources into one of three UI states. */
export type UiStatus = 'working' | 'idle' | 'done'

export function uiStatus(w: Workspace): UiStatus {
	if (w.session_status === 'working') return 'working'
	if (w.derived_status === 'done' || w.manual_status === 'done') return 'done'
	return 'idle'
}

export function statusLabel(w: Workspace): string {
	const s = uiStatus(w)
	if (s === 'working') return 'working'
	if (s === 'done') return 'done'
	return w.session_status || 'idle'
}

/** Compact model name: strip the `claude-`/date noise for the phone. */
export function shortModel(model: string | null): string {
	if (!model) return ''
	return model
		.replace(/^claude-/, '')
		.replace(/-\d{8}$/, '')
		.replace(/-latest$/, '')
}

export function relativeTime(iso: string): string {
	const then = new Date(iso).getTime()
	if (!Number.isFinite(then)) return ''
	const secs = Math.round((Date.now() - then) / 1000)
	if (secs < 45) return 'now'
	if (secs < 90) return '1m'
	const mins = Math.round(secs / 60)
	if (mins < 60) return `${mins}m`
	const hrs = Math.round(mins / 60)
	if (hrs < 24) return `${hrs}h`
	return `${Math.round(hrs / 24)}d`
}
