/**
 * Compile-check the AppleScript the relay ships, and check that every handler it
 * calls exists.
 *
 * This stays a standalone repository check because
 * `src/conductor.applescript` is a thousand lines of a language nothing else here
 * looks at: `tsc` sees a string, Biome sees a string, and a stray quote or a
 * renamed handler shows up for the first time as a failed send on someone's phone.
 *
 * Two checks, because they catch different things:
 *  - **osacompile** parses the file the way `osascript` will. It reports
 *    `file:line: error: … (-2741)`, so a syntax error names its own line instead
 *    of arriving as "Conductor took too long to respond" hours later.
 *  - **Handler resolution** — every `my someHandler()` in the script *and* in the
 *    TypeScript that appends to it must have a matching `on someHandler(`.
 *    AppleScript resolves handler calls at run time, so osacompile is perfectly
 *    happy with a call to a handler that was renamed out from under it; this is
 *    the half that catches that, and it is why the TS call sites are scanned too.
 *
 * Skipped off macOS (CI is ubuntu) — the resolution check still runs there, since
 * it is plain text work and catches the rename that a Mac-only gate would miss on
 * a pull request.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { packageRoot } from '../src/pkg-root.ts'

const root = packageRoot(import.meta.dirname)
const srcDir = path.join(root, 'src')
const scripts = fs
	.readdirSync(srcDir)
	.filter(f => f.endsWith('.applescript'))
	.map(f => path.join(srcDir, f))

if (scripts.length === 0) {
	console.error('no .applescript files in src/ — did the loader in writes.ts lose its script?')
	process.exit(1)
}

const problems: string[] = []

/** Handler calls are always written `my name(`; definitions always `on name(`. */
function names(text: string, pattern: RegExp): Set<string> {
	return new Set(Array.from(text.matchAll(pattern), m => m[1]))
}

const defined = new Set<string>()
const scriptText = scripts.map(f => fs.readFileSync(f, 'utf8'))
for (const text of scriptText) for (const n of names(text, /^on\s+([A-Za-z_]\w*)\s*\(/gm)) defined.add(n)

// The TS side appends a few lines of `my handler()` to the script before running it,
// so those call sites are part of the same program and are checked with it.
const callers = [
	...scripts.map((f, i) => ({ file: path.relative(root, f), text: scriptText[i] })),
	...fs
		.readdirSync(srcDir)
		.filter(f => f.endsWith('.ts'))
		.map(f => ({ file: `src/${f}`, text: fs.readFileSync(path.join(srcDir, f), 'utf8') }))
]
for (const { file, text } of callers) {
	for (const called of names(text, /\bmy\s+([A-Za-z_]\w*)\s*\(/g)) {
		if (!defined.has(called)) problems.push(`${file}: calls "my ${called}()" but no handler defines it`)
	}
}

if (process.platform === 'darwin') {
	const out = path.join(os.tmpdir(), `relay-applescript-check-${process.pid}.scpt`)
	for (const file of scripts) {
		try {
			execFileSync('osacompile', ['-o', out, file], { stdio: ['ignore', 'ignore', 'pipe'] })
		} catch (err) {
			const stderr = err && typeof err === 'object' && 'stderr' in err ? String(err.stderr).trim() : String(err)
			problems.push(stderr)
		}
	}
	fs.rmSync(out, { force: true, recursive: true })
} else {
	console.log(`applescript: osacompile skipped on ${process.platform}; checked handler references only`)
}

if (problems.length > 0) {
	for (const p of problems) console.error(p)
	process.exit(1)
}
console.log(`applescript: ${scripts.length} file(s) ok, ${defined.size} handlers`)
