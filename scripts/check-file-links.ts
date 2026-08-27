/**
 * File references in agent Markdown use the same absolute `path:line` form that
 * coding agents emit in their final responses. Keep the parser strict: ordinary
 * PWA paths must remain ordinary browser links.
 */
import { parseFileReference } from '../src/file-preview.ts'

const failures: string[] = []

function check(label: string, actual: unknown, expected: unknown): void {
	const pass = JSON.stringify(actual) === JSON.stringify(expected)
	if (pass) console.info(`  ok    ${label}`)
	else {
		console.error(`  FAIL  ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
		failures.push(label)
	}
}

check(
	'parses an absolute macOS path and its line',
	parseFileReference(
		'/Users/hyldmo/conductor/workspaces/conductor-remote/yeosu/web/src/components/WorkspaceList.tsx:468'
	),
	{
		path: '/Users/hyldmo/conductor/workspaces/conductor-remote/yeosu/web/src/components/WorkspaceList.tsx',
		line: 468
	}
)
check(
	'keeps a path with no line number',
	parseFileReference('/Users/hyldmo/conductor/workspaces/conductor-remote/yeosu/package.json'),
	{ path: '/Users/hyldmo/conductor/workspaces/conductor-remote/yeosu/package.json', line: null }
)
check(
	'uses the first location number as the line',
	parseFileReference('/Users/hyldmo/conductor/workspaces/conductor-remote/yeosu/web/src/app.tsx:19:7'),
	{ path: '/Users/hyldmo/conductor/workspaces/conductor-remote/yeosu/web/src/app.tsx', line: 19 }
)
check('rejects a PWA route', parseFileReference('/w/a-workspace'), null)
check('rejects a relative path', parseFileReference('web/src/app.tsx:19'), null)
check('rejects a workspace secret', parseFileReference('/Users/hyldmo/project/.env:1'), null)
check('rejects line zero', parseFileReference('/Users/hyldmo/file.ts:0'), null)
check('rejects an unsafe integer line', parseFileReference('/Users/hyldmo/file.ts:9007199254740992'), null)

if (failures.length) {
	console.error(`file links: ${failures.length} check(s) failed`)
	process.exit(1)
}

console.info('file links: parser ok')
