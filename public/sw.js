// Minimal offline shell. Never caches /api/* (live data must hit the relay).
const CACHE = 'conductor-remote-v1'
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', e => {
	e.waitUntil(
		caches
			.open(CACHE)
			.then(c => c.addAll(SHELL))
			.then(() => self.skipWaiting())
	)
})

self.addEventListener('activate', e => {
	e.waitUntil(
		caches
			.keys()
			.then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
			.then(() => self.clients.claim())
	)
})

self.addEventListener('fetch', e => {
	const url = new URL(e.request.url)
	if (url.pathname.startsWith('/api/')) return // always network
	e.respondWith(
		fetch(e.request)
			.then(res => {
				const copy = res.clone()
				caches
					.open(CACHE)
					.then(c => c.put(e.request, copy))
					.catch(() => undefined)
				return res
			})
			.catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
	)
})
