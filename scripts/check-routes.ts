/**
 * The route table (`src/routes.ts`): every path round-trips, and no two routes collide.
 *
 * It earns its place the same way `check-uilock.ts` does — on what a mistake costs.
 * The table is now the single place a path is written, read by the relay's matcher, the
 * phone and the MCP tools at once, so one wrong character takes out all three together
 * and `tsc` sees only a string. The failure is also silent in the worst way: a route
 * whose pattern no longer matches its own built path is a 404 on someone's phone, and a
 * route that matches *another* route's path is a request answered by the wrong handler.
 *
 * The properties tested are the ones the table promises:
 *
 *   1. Every route matches the path it builds. This is the round trip that makes one
 *      declaration safe to serve both directions.
 *   2. A parameter survives the trip verbatim, including the characters that make
 *      encoding necessary — a repo name with a space or a slash is the real case.
 *   3. No route answers another route's path. Ordering in the dispatcher hides this:
 *      whichever `if` is written first wins, so a genuine overlap looks like it works
 *      until someone reorders the file.
 *   4. Method is part of identity, so `GET /api/nosleep` and `DELETE /api/nosleep` stay
 *      three separate routes on one path.
 *
 * What it cannot catch, by construction: **renaming a path**. Both directions derive from
 * the one pattern, so a typo stays self-consistent and every assertion here still passes.
 * That is the table working as intended for the three callers in this repo, and it is not
 * the whole contract — the phone runs from a service-worker cache while the relay updates
 * itself, so an installed PWA can be a version behind. A renamed path is a breaking change
 * to that older client no matter how consistent this file is.
 *
 * Portable (no macOS, no relay), stdlib-only, strip-clean — see CLAUDE.md.
 */
import { isRoute, type Route0, type Route1, routeParam, routes } from '../src/routes.ts'

const failures: string[] = []
function check(label: string, pass: boolean, detail = ''): void {
	if (pass) console.info(`  ok    ${label}`)
	else {
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
		failures.push(label)
	}
}

const entries = Object.entries(routes)
const isParam = (r: Route0 | Route1): r is Route1 => 're' in r

// Values chosen to break a naive implementation: a space and a slash both have to survive
// encoding, and the slash is the one that would otherwise eat the rest of the path.
const SAMPLES = ['9008e4f4-9d58-4dbf-8c8e-6df0b618c2d0', 'conductor-remote', 'my repo', 'a/b', 'Ünicode name']

// ── 1 + 2: every route matches the path it builds, parameter intact ─────────────

const broken: string[] = []
const mangled: string[] = []
for (const [name, route] of entries) {
	if (!isParam(route)) {
		if (!isRoute(route, route.method, route.path())) broken.push(`${name} (${route.pattern})`)
		continue
	}
	for (const sample of SAMPLES) {
		const got = routeParam(route, route.method, route.path(sample))
		if (got === null) broken.push(`${name} (${route.pattern}) with ${JSON.stringify(sample)}`)
		else if (got !== sample) mangled.push(`${name}: sent ${JSON.stringify(sample)}, matched ${JSON.stringify(got)}`)
	}
}
check(`all ${entries.length} routes match the path they build`, broken.length === 0, broken.join('; '))
check('the parameter survives the round trip verbatim', mangled.length === 0, mangled.join('; '))

// ── 3: no route answers another route's path ────────────────────────────────────
// Same method only. Two routes sharing a path under different methods is the normal
// case here (GET/POST/DELETE /api/nosleep), and the matcher already separates those.

const collisions: string[] = []
for (const [name, route] of entries) {
	const path = isParam(route) ? route.path(SAMPLES[0]) : route.path()
	for (const [otherName, other] of entries) {
		if (otherName === name) continue
		if (other.method !== route.method) continue
		const hit = isParam(other) ? routeParam(other, route.method, path) !== null : isRoute(other, route.method, path)
		if (hit) collisions.push(`${route.method} ${route.pattern} is also matched by ${otherName} (${other.pattern})`)
	}
}
check('no route answers another route’s path', collisions.length === 0, collisions.join('; '))

// ── 4: method is part of identity ───────────────────────────────────────────────

const METHODS = ['GET', 'POST', 'PATCH', 'DELETE']
const looseOnMethod: string[] = []
for (const [name, route] of entries) {
	const path = isParam(route) ? route.path(SAMPLES[0]) : route.path()
	for (const method of METHODS) {
		if (method === route.method) continue
		const hit = isParam(route) ? routeParam(route, method, path) !== null : isRoute(route, method, path)
		if (hit) looseOnMethod.push(`${name} also answers ${method}`)
	}
}
check('a route answers its own method only', looseOnMethod.length === 0, looseOnMethod.join('; '))

// ── the table is not accidentally empty ─────────────────────────────────────────
// Every assertion above passes vacuously against `{}`, which is exactly what a bad
// refactor of the table would leave behind.

check('the table is populated', entries.length > 20, `${entries.length} routes`)
check(
	'every route path starts /api/',
	entries.every(([, r]) => r.pattern.startsWith('/api/')),
	entries
		.filter(([, r]) => !r.pattern.startsWith('/api/'))
		.map(([n]) => n)
		.join('; ')
)

if (failures.length) {
	console.error(`routes: ${failures.length} check(s) failed`)
	process.exit(1)
}
console.info(`routes: ${entries.length} routes ok`)
