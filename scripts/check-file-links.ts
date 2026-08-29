/**
 * File references in agent Markdown use the same absolute `path:line` form that
 * coding agents emit in their final responses. Keep the parser strict: ordinary
 * PWA paths must remain ordinary browser links.
 */
import { isAllowedPreviewPath, parseFileReference } from '../src/file-preview.ts'

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

const workspaces = '/Users/hyldmo/conductor/workspaces'
const home = '/Users/hyldmo'
const bundledSkills = '/Applications/Conductor.app/Contents/Resources/conductor-skill/skills'
check(
	'allows a Conductor workspace in public mode',
	isAllowedPreviewPath(
		'/Users/hyldmo/conductor/workspaces/conductor-remote/yeosu/src/server.ts',
		workspaces,
		home,
		'public'
	),
	true
)
check(
	'rejects home files in public mode',
	isAllowedPreviewPath('/Users/hyldmo/.gstack/builder-journey.md', workspaces, home, 'public'),
	false
)
check(
	'allows home supporting files in tailnet mode',
	isAllowedPreviewPath('/Users/hyldmo/.gstack/builder-journey.md', workspaces, home, 'tailnet'),
	true
)
check(
	'allows bundled Conductor skills in tailnet mode',
	isAllowedPreviewPath(
		'/Applications/Conductor.app/Contents/Resources/conductor-skill/skills/conductor/SKILL.md',
		workspaces,
		home,
		'tailnet',
		bundledSkills
	),
	true
)
check(
	'rejects bundled Conductor skills in public mode',
	isAllowedPreviewPath(
		'/Applications/Conductor.app/Contents/Resources/conductor-skill/skills/conductor/SKILL.md',
		workspaces,
		home,
		'public',
		bundledSkills
	),
	false
)
check(
	'rejects a workspace lookalike in tailnet mode',
	isAllowedPreviewPath('/Users/hyldmo-conductor/workspaces/project/src/app.ts', workspaces, home, 'tailnet'),
	false
)
check(
	'rejects system files in tailnet mode',
	isAllowedPreviewPath('/etc/config.ts', workspaces, home, 'tailnet'),
	false
)

if (failures.length) {
	console.error(`file links: ${failures.length} check(s) failed`)
	process.exit(1)
}

console.info('file links: parser ok')
