// ── Conductor IPC reconnaissance snippet ──────────────────────────────────
//
// PREREQUISITE (read FINDINGS.md first): this only works if Conductor's WKWeb
// view is inspectable. On the shipped build it is NOT — the app is hardened/
// notarized without `get-task-allow`, so Safari's Develop menu won't list it
// and there is no console to paste this into. Injection is therefore blocked;
// the relay drives writes via Accessibility instead. Keep this snippet for the
// case where a future build ships with devtools enabled.
//
// IF a console is available (Safari ▸ Develop ▸ [Conductor] ▸ [webview]):
// paste this, then perform the action you want to reverse-engineer (send a
// prompt, approve a tool, stop a session). Every Tauri IPC call is logged with
// its command name + payload — that is the undocumented write API.

;(() => {
	const internals = window.__TAURI_INTERNALS__
	if (!internals || typeof internals.invoke !== 'function') {
		console.warn('[recon] __TAURI_INTERNALS__.invoke not found — not a Tauri webview or not exposed.')
		return
	}
	if (internals.__reconWrapped) {
		console.info('[recon] already wrapped.')
		return
	}
	const original = internals.invoke.bind(internals)
	const log = []
	window.__reconLog = log
	internals.invoke = (cmd, payload, options) => {
		// Stock Tauri plugin traffic is noise; Conductor's own commands are the signal.
		const interesting = !String(cmd).startsWith('plugin:')
		const record = { t: new Date().toISOString(), cmd, payload }
		if (interesting) {
			log.push(record)
			console.info('%c[INVOKE]', 'color:#4a9eff', cmd, payload)
		}
		return original(cmd, payload, options)
	}
	internals.__reconWrapped = true
	console.info(
		'[recon] invoke wrapped. Reproduce an action, then run: copy(JSON.stringify(window.__reconLog, null, 2))'
	)
})()
