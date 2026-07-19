// Conductor Remote — phone control panel.
// Reads ride the relay's SQLite + git endpoints; the prompt box is the one
// write. Plain polling (no SSE) keeps v1 robust over a flaky mobile link.

const TOKEN_KEY = 'conductor-remote-token'

function bootToken() {
	const h = new URLSearchParams(location.hash.slice(1))
	const t = h.get('token')
	if (t) {
		localStorage.setItem(TOKEN_KEY, t)
		history.replaceState(null, '', location.pathname)
	}
	return localStorage.getItem(TOKEN_KEY)
}
const token = bootToken()

async function api(path, opts = {}) {
	const res = await fetch(path, {
		...opts,
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(opts.headers || {}) }
	})
	if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
	return res.json()
}

const el = {
	view: document.getElementById('view'),
	title: document.getElementById('title'),
	back: document.getElementById('back'),
	conn: document.getElementById('conn'),
	composer: document.getElementById('composer'),
	prompt: document.getElementById('prompt'),
	send: document.getElementById('send')
}

const state = { screen: 'list', ws: null, sessionId: null, cursor: 0, entries: [], tab: 'chat', actuatorCaveat: '' }
let poll = null

function setConn(ok) {
	el.conn.className = `conn ${ok ? 'ok' : 'err'}`
}

function toast(msg, kind = '') {
	const t = document.createElement('div')
	t.className = `toast ${kind}`
	t.textContent = msg
	document.body.appendChild(t)
	requestAnimationFrame(() => t.classList.add('show'))
	setTimeout(
		() => {
			t.classList.remove('show')
			setTimeout(() => t.remove(), 250)
		},
		kind === 'err' ? 4200 : 2600
	)
}

function statusClass(s) {
	if (s === 'working') return 'working'
	if (s === 'done') return 'done'
	return ''
}

// ---------- Workspace list ----------
async function renderList() {
	state.screen = 'list'
	state.ws = null
	state.sessionId = null
	el.title.textContent = 'Workspaces'
	el.back.classList.add('hidden')
	el.composer.classList.add('hidden')
	stopPolling()

	async function tick() {
		try {
			const { workspaces, actuator } = await api('/api/state')
			state.actuatorCaveat = actuator?.caveat || ''
			setConn(true)
			if (state.screen !== 'list') return
			el.view.innerHTML = ''
			if (!workspaces.length) {
				el.view.innerHTML = '<div class="empty">No active workspaces.</div>'
				return
			}
			for (const w of workspaces) {
				const card = document.createElement('div')
				card.className = 'card'
				const status = w.session_status || w.derived_status || 'idle'
				card.innerHTML = `
					<div class="dot ${statusClass(w.session_status)}"></div>
					<div class="meta">
						<div class="name">${esc(w.workspace_name || w.directory_name || w.id.slice(0, 8))}</div>
						<div class="sub mono">${esc(w.repo_name || '')} · ${esc(w.branch || '')}</div>
					</div>
					${w.unread ? `<span class="badge">${w.unread}</span>` : ''}
					<div class="status">${esc(status)}</div>`
				card.onclick = () => openWorkspace(w)
				el.view.appendChild(card)
			}
		} catch (e) {
			setConn(false)
			if (state.screen === 'list' && !el.view.children.length)
				el.view.innerHTML = `<div class="empty">${esc(e.message)}<br/><br/>Check the relay is running and the token is correct.</div>`
		}
	}
	await tick()
	poll = setInterval(tick, 2000)
}

// ---------- Session view ----------
async function openWorkspace(w) {
	stopPolling()
	state.screen = 'session'
	state.ws = w
	state.sessionId = w.active_session_id
	state.cursor = 0
	state.entries = []
	state.tab = 'chat'
	el.title.textContent = w.workspace_name || w.directory_name || 'Session'
	el.back.classList.remove('hidden')
	el.back.onclick = renderList
	el.composer.classList.remove('hidden')
	renderSessionShell()

	if (!state.sessionId) {
		el.view.innerHTML = '<div class="empty">No active session in this workspace.</div>'
		return
	}
	await tickTranscript(true)
	poll = setInterval(() => {
		if (state.tab === 'chat') tickTranscript(false)
	}, 1800)
}

function renderSessionShell() {
	el.view.innerHTML = `
		<div class="diff-toggle">
			<button class="pill ${state.tab === 'chat' ? 'active' : ''}" data-tab="chat">Chat</button>
			<button class="pill ${state.tab === 'diff' ? 'active' : ''}" data-tab="diff">Diff</button>
		</div>
		<div id="pane"></div>`
	el.view.querySelectorAll('.pill').forEach(b => {
		b.onclick = () => switchTab(b.dataset.tab)
	})
}

function switchTab(tab) {
	state.tab = tab
	renderSessionShell()
	el.composer.classList.toggle('hidden', tab === 'diff')
	if (tab === 'chat') {
		renderEntries()
		scrollBottom()
	} else renderDiff()
}

async function tickTranscript(initial) {
	try {
		const { entries, cursor } = await api(
			`/api/sessions/${encodeURIComponent(state.sessionId)}/messages?after=${state.cursor}`
		)
		setConn(true)
		if (entries.length) {
			state.entries.push(...entries)
			state.cursor = cursor
			if (state.tab === 'chat') {
				renderEntries()
				scrollBottom(!initial)
			}
		} else if (initial && state.tab === 'chat') {
			renderEntries()
		}
	} catch (e) {
		setConn(false)
		if (initial) document.getElementById('pane').innerHTML = `<div class="empty">${esc(e.message)}</div>`
	}
}

function renderEntries() {
	const pane = document.getElementById('pane')
	if (!pane) return
	if (!state.entries.length) {
		pane.innerHTML = '<div class="empty">No messages yet.</div>'
		return
	}
	pane.innerHTML = state.entries
		.map(
			e => `
			<div class="entry ${e.role} ${e.queued ? 'queued' : ''}">
				<div class="who">${e.role === 'tool' ? esc(e.tool || 'tool') : e.role}${e.queued ? ' · queued' : ''}</div>
				<div class="bubble">${esc(e.text)}</div>
			</div>`
		)
		.join('')
}

async function renderDiff() {
	const pane = document.getElementById('pane')
	pane.innerHTML = '<div class="empty">Loading diff…</div>'
	try {
		const d = await api(`/api/workspaces/${encodeURIComponent(state.ws.id)}/diff`)
		setConn(true)
		if (!d.files.length) {
			pane.innerHTML = `<div class="empty">No changes vs ${esc(d.base)}.</div>`
			return
		}
		const files = d.files
			.map(
				f =>
					`<div class="difffile mono">${esc(f.path)} <span class="add">+${f.added}</span> <span class="del">−${f.removed}</span></div>`
			)
			.join('')
		pane.innerHTML = `<div class="section-label">vs ${esc(d.base)}</div>${files}<pre class="patch">${colorPatch(d.patch)}</pre>`
	} catch (e) {
		setConn(false)
		pane.innerHTML = `<div class="empty">${esc(e.message)}</div>`
	}
}

// ---------- Prompt ----------
async function sendPrompt() {
	const text = el.prompt.value.trim()
	if (!(text && state.sessionId)) return
	el.send.disabled = true
	try {
		const r = await api(`/api/sessions/${encodeURIComponent(state.sessionId)}/prompt`, {
			method: 'POST',
			body: JSON.stringify({ text, workspaceId: state.ws.id })
		})
		el.prompt.value = ''
		autosize()
		toast(r.warning || 'Sent', r.warning ? 'warn' : '')
	} catch (e) {
		toast(e.message, 'err')
	} finally {
		el.send.disabled = false
	}
}

el.send.onclick = sendPrompt
el.prompt.addEventListener('input', autosize)
el.prompt.addEventListener('keydown', e => {
	if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
		e.preventDefault()
		sendPrompt()
	}
})
function autosize() {
	el.prompt.style.height = 'auto'
	el.prompt.style.height = `${Math.min(el.prompt.scrollHeight, 140)}px`
}

// ---------- utils ----------
function stopPolling() {
	if (poll) {
		clearInterval(poll)
		poll = null
	}
}
function scrollBottom(smooth) {
	const nearBottom = el.view.scrollHeight - el.view.scrollTop - el.view.clientHeight < 220
	if (smooth === false || nearBottom || smooth === undefined)
		el.view.scrollTo({ top: el.view.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
}
function esc(s) {
	return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}
function colorPatch(p) {
	return esc(p)
		.split('\n')
		.map(l => {
			if (l.startsWith('+') && !l.startsWith('+++')) return `<span class="l-add">${l}</span>`
			if (l.startsWith('-') && !l.startsWith('---')) return `<span class="l-del">${l}</span>`
			if (l.startsWith('@@')) return `<span class="l-hunk">${l}</span>`
			return l
		})
		.join('\n')
}

if (!token) {
	el.view.innerHTML =
		'<div class="empty">No token. Open the URL from the relay startup log (it includes <span class="mono">#token=…</span>).</div>'
} else {
	renderList()
	if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined)
}
