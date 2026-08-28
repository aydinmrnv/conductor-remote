/** Verify that every target label reaches AppleScript through one UTF-8 file, never a system attribute. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { type SendTarget, withTargetEnvironment } from '../src/writes.ts'

const appleScript = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'conductor.applescript'), 'utf8')

const target = {
	workspace: {
		id: 'workspace-1',
		workspace_name: 'Palette — query',
		pr_title: 'Sidebar — title',
		branch: 'feature/utf8-query',
		directory_name: 'unicode-ø',
		repo_name: 'repo-name'
	} as SendTarget['workspace'],
	sessionId: 'session-1',
	tab: { index: 2, count: 3, title: 'Chat — title' }
} satisfies SendTarget

let targetFile = ''
await withTargetEnvironment(target, async environment => {
	targetFile = environment.RELAY_TARGET_FILE
	assert.ok(targetFile, 'the target file path is provided')
	const targetText = [
		'Chat — title',
		'feature/utf8-query',
		'Palette — query',
		'Sidebar — title',
		'Utf8 query',
		'unicode-ø'
	].join('\n')
	assert.equal(fs.readFileSync(targetFile, 'utf8'), targetText, 'the target file keeps every non-ASCII label as UTF-8')
	if (process.platform === 'darwin') {
		const output = execFileSync(
			'osascript',
			['-e', 'return do shell script "cat " & quoted form of (system attribute "RELAY_TARGET_FILE")'],
			{ encoding: 'utf8', env: { ...process.env, RELAY_TARGET_FILE: targetFile } }
		)
			.replace(/\r\n?/g, '\n')
			.trimEnd()
		assert.equal(output, targetText, 'AppleScript reads the target text from the file as UTF-8')

		const readField = (expression: string): string =>
			execFileSync('osascript', ['-e', `${appleScript}\nreturn ${expression}`], {
				encoding: 'utf8',
				env: { ...process.env, RELAY_TARGET_FILE: targetFile }
			})
				.replace(/\r\n?/g, '\n')
				.trimEnd()
		assert.equal(readField('my targetField(1)'), 'Chat — title', 'the tab title stays in the first field')
		assert.equal(readField('my targetField(2)'), 'feature/utf8-query', 'the palette query stays in the second field')
		assert.equal(
			readField('item 1 of (my targetSidebarTitles())'),
			'Palette — query',
			'the first sidebar title stays in the third field'
		)
	}
	for (const name of ['RELAY_TAB_TITLE', 'RELAY_WS_QUERY', 'RELAY_WS_TITLES']) {
		assert.equal(environment[name], undefined, `${name} is not passed through the environment`)
	}
	assert.equal(environment.RELAY_WS_BRANCH, 'feature/utf8-query', 'the branch remains an environment value')
	assert.equal(environment.RELAY_WS_REPO, 'repo-name', 'the repository remains an environment value')
	assert.equal(environment.RELAY_TAB_INDEX, '2', 'the ASCII tab index remains an environment value')
	assert.match(environment.RELAY_WS_LINK, /^conductor:\/\//, 'the URL-encoded deep link remains an environment value')
})
assert.equal(fs.existsSync(targetFile), false, 'the target file is removed after the UI action')

let rejectedTargetFile = ''
await assert.rejects(
	withTargetEnvironment(target, async environment => {
		rejectedTargetFile = environment.RELAY_TARGET_FILE
		throw new Error('test failure')
	}),
	/test failure/,
	'the target action reports its failure'
)
assert.equal(fs.existsSync(rejectedTargetFile), false, 'the target file is removed after a failed UI action')

assert.match(
	appleScript,
	/system attribute "RELAY_TARGET_FILE"/,
	'AppleScript reads the target file path from the environment'
)
for (const name of ['RELAY_TAB_TITLE', 'RELAY_WS_QUERY', 'RELAY_WS_TITLES']) {
	assert.doesNotMatch(
		appleScript,
		new RegExp(`system attribute "${name}"`),
		`${name} is never read as a system attribute`
	)
}
for (const name of ['RELAY_WS_BRANCH', 'RELAY_WS_REPO']) {
	assert.match(appleScript, new RegExp(`system attribute "${name}"`), `${name} remains an environment value`)
}

console.info('utf8 target: file transport ok')
