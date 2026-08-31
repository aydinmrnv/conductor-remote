import { describe, expect, test } from 'vitest'
import { isAllowedPreviewPath, parseFileReference } from '../src/file-preview.ts'

describe('file references', () => {
	test('parses absolute macOS paths and locations', () => {
		expect(
			parseFileReference(
				'/Users/hyldmo/conductor/workspaces/conductor-remote/yeosu/web/src/components/WorkspaceList.tsx:468'
			)
		).toEqual({
			path: '/Users/hyldmo/conductor/workspaces/conductor-remote/yeosu/web/src/components/WorkspaceList.tsx',
			line: 468
		})
		expect(parseFileReference('/Users/hyldmo/conductor/workspaces/conductor-remote/yeosu/package.json')).toEqual({
			path: '/Users/hyldmo/conductor/workspaces/conductor-remote/yeosu/package.json',
			line: null
		})
		expect(parseFileReference('/Users/hyldmo/project/src/app.tsx:19:7')).toEqual({
			path: '/Users/hyldmo/project/src/app.tsx',
			line: 19
		})
	})

	test.each([
		'/w/a-workspace',
		'web/src/app.tsx:19',
		'/Users/hyldmo/project/.env:1',
		'/Users/hyldmo/file.ts:0',
		'/Users/hyldmo/file.ts:9007199254740992'
	])('rejects unsafe or non-file reference %s', reference => {
		expect(parseFileReference(reference)).toBeNull()
	})
})

describe('preview path access', () => {
	const workspaces = '/Users/hyldmo/conductor/workspaces'
	const home = '/Users/hyldmo'
	const bundledSkills = '/Applications/Conductor.app/Contents/Resources/conductor-skill/skills'

	test('allows workspace files in public mode', () => {
		expect(
			isAllowedPreviewPath(
				'/Users/hyldmo/conductor/workspaces/conductor-remote/yeosu/src/server.ts',
				workspaces,
				home,
				'public'
			)
		).toBe(true)
	})

	test('limits home and bundled skill files to tailnet mode', () => {
		expect(isAllowedPreviewPath('/Users/hyldmo/.gstack/builder-journey.md', workspaces, home, 'public')).toBe(false)
		expect(isAllowedPreviewPath('/Users/hyldmo/.gstack/builder-journey.md', workspaces, home, 'tailnet')).toBe(true)
		expect(
			isAllowedPreviewPath(
				'/Applications/Conductor.app/Contents/Resources/conductor-skill/skills/conductor/SKILL.md',
				workspaces,
				home,
				'tailnet',
				bundledSkills
			)
		).toBe(true)
		expect(
			isAllowedPreviewPath(
				'/Applications/Conductor.app/Contents/Resources/conductor-skill/skills/conductor/SKILL.md',
				workspaces,
				home,
				'public',
				bundledSkills
			)
		).toBe(false)
	})

	test('rejects lookalike workspace prefixes and system files', () => {
		expect(
			isAllowedPreviewPath('/Users/hyldmo-conductor/workspaces/project/src/app.ts', workspaces, home, 'tailnet')
		).toBe(false)
		expect(isAllowedPreviewPath('/etc/config.ts', workspaces, home, 'tailnet')).toBe(false)
	})
})
