import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

/** One issue as `gh` reports it. `body` only on a single-issue read — a list would ship megabytes. */
export interface GithubIssue {
	number: number
	title: string
	state: string
	url: string
	updatedAt: string
	author: string | null
	labels: string[]
	body?: string
}

interface GhIssueRow {
	number: number
	title: string
	state: string
	url: string
	updatedAt: string
	author?: { login?: string } | null
	labels?: Array<{ name: string }>
	body?: string
}

/**
 * `gh` in the repo's checkout, so the Mac's own login answers — private repos included.
 * Run from the checkout rather than with `-R`: that is how `gh` learns which remote is
 * the repo, exactly as merge.ts does for `gh pr merge`.
 */
async function gh(root: string, args: string[]): Promise<string> {
	const { stdout } = await exec('gh', args, {
		cwd: root,
		encoding: 'utf8',
		timeout: 30_000,
		maxBuffer: 8 * 1024 * 1024
	})
	return stdout
}

function fromRow(r: GhIssueRow): GithubIssue {
	return {
		number: r.number,
		title: r.title,
		state: r.state,
		url: r.url,
		updatedAt: r.updatedAt,
		author: r.author?.login ?? null,
		labels: r.labels?.map(l => l.name) ?? [],
		...(r.body !== undefined ? { body: r.body } : {})
	}
}

/** Open issues, most recently updated first. */
export async function listIssues(root: string, limit = 50): Promise<GithubIssue[]> {
	const out = await gh(root, [
		'issue',
		'list',
		'--state',
		'open',
		'--limit',
		String(limit),
		'--json',
		'number,title,state,url,updatedAt,author,labels'
	])
	const rows = JSON.parse(out) as GhIssueRow[]
	return rows.map(fromRow).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** One issue with its body. `ref` is a number or an issue URL — both are what `gh issue view` takes. */
export async function getIssue(root: string, ref: string): Promise<GithubIssue> {
	const out = await gh(root, ['issue', 'view', ref, '--json', 'number,title,state,url,updatedAt,author,labels,body'])
	return fromRow(JSON.parse(out) as GhIssueRow)
}

/** The prompt a "Create from GitHub issue" workspace starts with: what the issue asks, then the caller's own words. */
export function issuePrompt(issue: GithubIssue, extra = ''): string {
	const body = (issue.body ?? '').trim()
	return [`Work on GitHub issue #${issue.number}: ${issue.title}`, issue.url, body, extra.trim()]
		.filter(Boolean)
		.join('\n\n')
}

/** `gh` puts the reason on stderr; surface that rather than "Command failed: gh …". */
export function ghError(err: unknown): string {
	const e = err as { stderr?: string; message?: string; code?: string }
	if (e.code === 'ENOENT') return 'gh (GitHub CLI) is not installed on the Mac'
	const stderr = e.stderr?.trim()
	if (stderr) return stderr.split('\n').filter(Boolean).slice(-1)[0] ?? stderr
	return e.message ?? String(err)
}
