/**
 * A source location as coding agents write it in Markdown: an absolute path,
 * with an optional `:line` or `:line:column` suffix.
 *
 * This module intentionally has no Node imports. It is useful to the relay and
 * stays easy to exercise in the portable checks.
 */
export interface FileReference {
	path: string
	line: number | null
}

const SOURCE_EXTENSIONS = new Set([
	'.bash',
	'.c',
	'.cc',
	'.cpp',
	'.css',
	'.go',
	'.h',
	'.hpp',
	'.html',
	'.java',
	'.js',
	'.json',
	'.jsx',
	'.md',
	'.mjs',
	'.mts',
	'.php',
	'.py',
	'.rb',
	'.rs',
	'.scss',
	'.sh',
	'.sql',
	'.svg',
	'.swift',
	'.toml',
	'.ts',
	'.tsx',
	'.txt',
	'.yaml',
	'.yml'
])

function sourceExtension(filePath: string): string {
	const name = filePath.slice(filePath.lastIndexOf('/') + 1)
	const dot = name.lastIndexOf('.')
	return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

/** True when a file is a text source format this viewer is allowed to expose. */
export function isPreviewableSource(filePath: string): boolean {
	return SOURCE_EXTENSIONS.has(sourceExtension(filePath))
}

/**
 * Parse a source link without treating ordinary PWA routes as file references.
 * The extension allowlist keeps links such as `/w/a-workspace` in the browser,
 * while also preventing this endpoint from becoming a generic file reader.
 */
export function parseFileReference(reference: string): FileReference | null {
	if (!reference.startsWith('/')) return null

	const location = reference.match(/:([1-9]\d*)(?::\d+)?$/)
	const line = location ? Number(location[1]) : null
	if (line !== null && !Number.isSafeInteger(line)) return null

	const filePath = location ? reference.slice(0, -location[0].length) : reference
	if (!isPreviewableSource(filePath)) return null
	return { path: filePath, line }
}
