#!/usr/bin/env node
// conductor-remote CLI entrypoint.
//
// Runs on plain Node ≥24 with zero flags: the relay is stdlib-only and the two
// param-property constructors that once needed --experimental-transform-types
// are gone, so default type-stripping handles the .ts sources on import.
//
// The one remaining wrinkle is node:sqlite, still flagged experimental in 24.
// We silence *only* that warning here (instead of re-execing node with
// --disable-warning) so the entrypoint stays a shebang + import.
const emitWarning = process.emitWarning.bind(process)
process.emitWarning = (warning, ...rest) => {
	const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type
	if (type === 'ExperimentalWarning') return
	return emitWarning(warning, ...rest)
}

const REQUIRED_MAJOR = 24
const major = Number(process.versions.node.split('.')[0])
if (major < REQUIRED_MAJOR) {
	console.error(
		`conductor-remote needs Node ${REQUIRED_MAJOR}+ (found ${process.versions.node}).\n` +
			'It relies on node:sqlite and default TypeScript type-stripping. Upgrade node and retry.'
	)
	process.exit(1)
}

const [cmd, ...rest] = process.argv.slice(2)

function usage() {
	console.info(
		[
			'conductor-remote — phone control panel for local Conductor agents',
			'',
			'Usage:',
			'  conductor-remote [start]                 run the relay (default)',
			'  conductor-remote service <subcommand>    manage the login LaunchAgent',
			'      install | uninstall | restart | status',
			'',
			'Env: RELAY_HOST, RELAY_PORT, RELAY_TOKEN, WRITE_STRATEGY, CONDUCTOR_DB, CONDUCTOR_WORKSPACES'
		].join('\n')
	)
}

switch (cmd) {
	case undefined:
	case 'start':
		await import('../src/server.ts')
		break
	case 'service':
		// service.ts reads its subcommand from argv[2]; re-shape argv so `service install` → `install`.
		process.argv = [process.argv[0], process.argv[1], ...rest]
		await import('../scripts/service.ts')
		break
	case '-h':
	case '--help':
	case 'help':
		usage()
		break
	default:
		console.error(`unknown command: ${cmd}\n`)
		usage()
		process.exit(1)
}
