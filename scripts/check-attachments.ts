/**
 * Conductor attachments (`src/attachments.ts`): the token another app parses, and a
 * path built out of text a model wrote.
 *
 * It earns its place the way the other checks here do — on what a mistake costs, and on
 * `tsc` being unable to see it. Both halves are strings all the way down.
 *
 *   - **The token is Conductor's syntax, not ours.** `@⟦name⟧(percent-encoded path)`,
 *     with the slashes encoded too, which is the part that looks wrong and is not.
 *     "Tidying" that to leave `/` alone, or swapping the brackets for the ASCII ones
 *     they resemble, produces a prompt that still sends and simply is not an
 *     attachment any more. So the assertion is pinned against a real one, copied out of
 *     `session_messages` byte for byte.
 *   - **The name comes from a chat title**, which a model writes and which can hold a
 *     slash as easily as a space. That name is joined onto a path. Nothing else in the
 *     toolchain will tell you the day it escapes the worktree.
 *
 * Portable (no macOS, no relay, no Conductor), stdlib-only, strip-clean — see CLAUDE.md.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { attachmentName, attachmentToken, writeAttachment } from '../src/attachments.ts'
import { attachmentTokens } from '../src/shared.ts'
import {
	discardStagedAttachment,
	materializeStagedAttachments,
	stageAttachment,
	stagedAttachments
} from '../src/staged-attachments.ts'

const failures: string[] = []
function check(label: string, pass: boolean, detail = ''): void {
	if (pass) console.info(`  ok    ${label}`)
	else {
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
		failures.push(label)
	}
}

// ── the token ───────────────────────────────────────────────────────────────────
// Taken verbatim from a prompt Conductor itself stored, image and all.
check(
	'the token matches one Conductor wrote',
	attachmentToken('image.png', '.context/attachments/jOTeCX/image.png') ===
		'@⟦image.png⟧(.context%2Fattachments%2FjOTeCX%2Fimage.png)',
	attachmentToken('image.png', '.context/attachments/jOTeCX/image.png')
)
check(
	'a space in the name is encoded in the path and left alone in the label',
	attachmentToken('Transcript of Approve plan.md', '.context/attachments/kuB8pt/Transcript of Approve plan.md') ===
		'@⟦Transcript of Approve plan.md⟧(.context%2Fattachments%2FkuB8pt%2FTranscript%20of%20Approve%20plan.md)'
)
const parenthesized = '@⟦diagram (old).png⟧(.context%2Fattachments%2FjOTeCX%2Fdiagram%20(old).png)'
check(
	'a token with parentheses in its file name is found whole',
	JSON.stringify(attachmentTokens(parenthesized)) ===
		JSON.stringify([
			{
				start: 0,
				end: parenthesized.length,
				name: 'diagram (old).png',
				path: '.context/attachments/jOTeCX/diagram (old).png'
			}
		])
)
check('ordinary text that resembles a token stays ordinary', attachmentTokens('@⟦file.md⟧(example.md)').length === 0)

// ── the name ────────────────────────────────────────────────────────────────────
check(
	'a plain name is left alone',
	attachmentName('Transcript of Select product colors.md') === 'Transcript of Select product colors.md'
)
check('separators cannot survive', !/[/\\]/.test(attachmentName('a/b\\c')), attachmentName('a/b\\c'))
check('a leading dot cannot survive', !attachmentName('../../etc/passwd').startsWith('.'))
check('a name of nothing but dots still has a name', attachmentName('...') === 'attachment')
check('a long title is cut to fit a filename', Buffer.byteLength(attachmentName('x'.repeat(400))) <= 120)
check('a unicode title is cut by bytes', Buffer.byteLength(attachmentName('😀'.repeat(400))) <= 120)

// ── writing one ─────────────────────────────────────────────────────────────────
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-remote-attachments-'))
try {
	const inside = (p: string) => path.resolve(p).startsWith(`${path.resolve(root)}${path.sep}`)

	const written = writeAttachment(root, 'Transcript of Select product colors.md', '# hi\n')
	check('the file is written', fs.existsSync(written.absPath))
	check(
		'the layout is <6 chars>/<name>',
		/^\.context[/\\]attachments[/\\][A-Za-z0-9]{6}[/\\]/.test(written.relPath),
		written.relPath
	)
	check('the relative path is the same file', fs.readFileSync(path.join(root, written.relPath), 'utf8') === '# hi\n')
	check('the token points at what was written', written.token === attachmentToken(written.name, written.relPath))

	// The one that matters: a title engineered to climb out still lands inside.
	const evil = writeAttachment(root, '../../../../tmp/pwned.md', 'x')
	check('a traversing title stays in the worktree', inside(evil.absPath), evil.absPath)

	// Two attachments of the same name are the ordinary case (split the same chat twice).
	const second = writeAttachment(root, 'Transcript of Select product colors.md', '# other\n')
	check('the same name twice does not overwrite', fs.readFileSync(written.absPath, 'utf8') === '# hi\n')
	check('…because each one gets its own directory', path.dirname(second.absPath) !== path.dirname(written.absPath))

	const image = writeAttachment(root, 'image.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]))
	check('binary bytes are preserved', fs.readFileSync(image.absPath).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])))

	const staging = path.join(root, 'staging')
	const worktree = path.join(root, 'worktree')
	const staged = stageAttachment(staging, 'ship plans (final).md', Buffer.from('# Power circuits\n'))
	check(
		'a staged attachment exposes the token it will send',
		staged.token === attachmentToken(staged.name, staged.path)
	)
	check(
		'a staged attachment survives a disk read',
		stagedAttachments(staging, [staged.stageId])?.[0]?.name === staged.name
	)
	materializeStagedAttachments(staging, worktree, [staged.stageId])
	check(
		'a staged attachment reaches its token path in the new worktree',
		fs.readFileSync(path.join(worktree, staged.path), 'utf8') === '# Power circuits\n'
	)
	check(
		'a staged attachment remains available until delivery is durable',
		stagedAttachments(staging, [staged.stageId]) !== null
	)
	discardStagedAttachment(staging, staged.stageId)
	check('a delivered attachment leaves no staged copy', stagedAttachments(staging, [staged.stageId]) === null)
} finally {
	fs.rmSync(root, { recursive: true, force: true })
}

if (failures.length) {
	console.error(`\nattachments: ${failures.length} failed`)
	process.exit(1)
}
console.info('attachments: ok')
