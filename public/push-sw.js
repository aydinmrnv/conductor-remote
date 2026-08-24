// Push handlers for the generated service worker.
//
// vite-plugin-pwa runs in `generateSW` mode, so Workbox owns `sw.js` and there is no
// hand-written worker to add listeners to — this file is pulled in by
// `workbox.importScripts` (see vite.config.ts). It is plain JS on purpose: it is served
// as a static asset, never bundled. Being part of the precache manifest is what makes a
// change here produce a new `sw.js`, so edits actually ship.
//
// Two rules this obeys, both learned from iOS:
// 1. **Every push shows a notification.** Safari treats a push that resolves without one
//    as abuse and can revoke the subscription, so there is no "suppress if the app is
//    open" branch — the relay only sends when something genuinely happened.
// 2. **A tap focuses the existing window** rather than navigating it. The app is a
//    token-gated SPA; `openWindow` on a live client would remount the whole thing and
//    throw away in-progress composer text, so we focus and post a route instead.
// 3. **The route is also parked in Cache Storage**, because on iOS neither of the two
//    direct routes survives. A backgrounded home-screen web app is resumed on whatever
//    screen it was left on — `openWindow`'s path is ignored, and a `postMessage` to a
//    frozen page is dropped (WebKit, reported from iOS 17.1 through 18.x and still
//    open). The cache outlives both, so the app reads its target when it comes back to
//    the front; see `usePushRouting` in web/src/hooks.ts.

/** One entry, overwritten per tap: only the newest tap can still be waiting to land. */
const ROUTE_CACHE = 'push-route'
const ROUTE_KEY = '/__push-route'

async function parkRoute(url) {
	try {
		const cache = await caches.open(ROUTE_CACHE)
		await cache.put(ROUTE_KEY, new Response(JSON.stringify({ url, ts: Date.now() })))
	} catch {
		// Storage refused it (quota, a private window). The two direct routes below still stand.
	}
}

self.addEventListener('push', event => {
	const fallback = { title: 'Conductor Remote', body: 'Something changed in a workspace.', url: '/', tag: 'conductor' }
	let data = fallback
	if (event.data) {
		try {
			data = Object.assign({}, fallback, event.data.json())
		} catch {
			// Not ours / not JSON — still show something rather than a browser-generic notice.
			data = Object.assign({}, fallback, { body: event.data.text() })
		}
	}
	event.waitUntil(
		self.registration.showNotification(data.title, {
			body: data.body,
			// Tagged per chat by the relay: a chatty agent replaces its own notification
			// instead of stacking, while a sibling chat keeps its own (they open different
			// screens). `renotify` keeps the replacement audible.
			tag: data.tag,
			renotify: true,
			icon: '/icon-192.png',
			badge: '/icon-192.png',
			timestamp: data.ts || Date.now(),
			data: { url: data.url || '/' }
		})
	)
})

self.addEventListener('notificationclick', event => {
	event.notification.close()
	const url = (event.notification.data && event.notification.data.url) || '/'
	event.waitUntil(
		(async () => {
			// Park first. Everything below can succeed and still leave the phone on the wrong
			// screen, and this is the copy the app reads when it wakes up.
			await parkRoute(url)
			const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
			for (const client of clients) {
				if (new URL(client.url).origin !== self.location.origin) continue
				// Handled in web/src/hooks.ts (usePushRouting) — an in-app route change, so the
				// token gate and React state survive the tap. Posted before the focus, since a
				// refused focus is no reason to skip a message the page may well receive.
				client.postMessage({ type: 'push-navigate', url })
				try {
					await client.focus()
				} catch {
					// focus() can be refused (no user activation on some platforms); on iOS the
					// system foregrounds the web app on the tap regardless.
				}
				return
			}
			await self.clients.openWindow(url)
		})()
	)
})
