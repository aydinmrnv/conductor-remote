/**
 * The notifier's state machine (`src/notify.ts` ▸ `TurnWatcher`) — every rule in it is
 * a rule about *not* buzzing a phone, and each one fails in a direction nothing else
 * catches.
 *
 * Too eager and it is a nuisance: one notification per already-idle chat the moment
 * someone subscribes, or one per status flicker while a queued prompt starts the next
 * turn. Too quiet and it is worse than useless, because a notifier that has silently
 * stopped looks exactly like a Mac with nothing to report — you find out by missing
 * something. The loop rule added here sits on that edge: it exists to stop a `/loop`
 * pushing every five minutes all night, and inverted it would mute the notification
 * you were actually waiting for.
 *
 * Pure control flow over injected rows, so it needs no push store, no network, no
 * Conductor and no Mac.
 */

import { TurnWatcher } from '../src/notify.ts'
import type { SessionState } from '../src/reads.ts'

let failures = 0
function check(what: string, ok: boolean, detail?: string): void {
	console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}${ok || !detail ? '' : ` — ${detail}`}`)
	if (!ok) failures++
}

/**
 * One chat as `listSessionStates` reports it. `lastUserMessageAt` follows the turn head
 * unless a case is about steering, which is the one thing that moves them apart.
 */
function chat(
	status: string | null,
	turnStartedAt: string | null,
	sessionId = 'chat-1',
	lastUserMessageAt: string | null = turnStartedAt
): SessionState {
	return {
		sessionId,
		workspaceId: 'ws-1',
		status,
		turnStartedAt,
		lastUserMessageAt,
		workspaceTitle: 'Build photo window',
		repoName: 'auk',
		sessionTitle: 'Manage Chat Context'
	}
}

/** Chats that would be notified about on this poll. */
const fired = (w: TurnWatcher, states: SessionState[]): string[] =>
	w.step(states).map(d => `${d.state.sessionId}:${d.kind}`)

const T1 = '2026-08-27T10:17:11.000Z'
const T2 = '2026-08-27T10:41:30.000Z'

// The baseline: subscribing must not replay the whole Mac.
{
	const w = new TurnWatcher()
	check('the first poll is a baseline, not a broadcast', fired(w, [chat('idle', T1)]).length === 0)
	check('and a chat that simply stays idle is never news', fired(w, [chat('idle', T1)]).length === 0)
}

// The turn you asked for.
{
	const w = new TurnWatcher()
	fired(w, [chat('working', T1)])
	check('a turn still running is not news', fired(w, [chat('working', T1)]).length === 0)
	check('nor is the first poll that sees it end', fired(w, [chat('idle', T1)]).length === 0)
	check('the turn you asked for notifies once confirmed', fired(w, [chat('idle', T1)]).join() === 'chat-1:done')
}

// A turn that needs a person to respond is also finished. Conductor preserves these
// statuses until the person acts, so they use the same confirmation as `idle`.
for (const status of ['needs_plan_response', 'needs_user_input']) {
	const w = new TurnWatcher()
	fired(w, [chat('working', T1)])
	check(`the first poll that sees ${status} is not news`, fired(w, [chat(status, T1)]).length === 0)
	check(`a turn ending at ${status} notifies once confirmed`, fired(w, [chat(status, T1)]).join() === 'chat-1:done')
}

// A flicker is a queued prompt starting the next turn, not a turn that ended.
{
	const w = new TurnWatcher()
	fired(w, [chat('working', T1)])
	fired(w, [chat('idle', T1)])
	check('a status that flicks back to working never fires', fired(w, [chat('working', T1)]).length === 0)
}

// The loop. Same turn head throughout, because no lap writes a user message.
{
	const w = new TurnWatcher()
	fired(w, [chat('working', T1)])
	fired(w, [chat('idle', T1)])
	check('the first lap after you typed still notifies', fired(w, [chat('idle', T1)]).join() === 'chat-1:done')
	let buzzes = 0
	for (let lap = 0; lap < 5; lap++) {
		fired(w, [chat('working', T1)])
		fired(w, [chat('idle', T1)])
		buzzes += fired(w, [chat('idle', T1)]).length
	}
	check('every lap the agent gave itself is quiet', buzzes === 0, `${buzzes} buzz(es)`)
	// Saying the next thing moves the turn head, and that is news again.
	fired(w, [chat('working', T2)])
	fired(w, [chat('idle', T2)])
	check('and the next thing you say notifies again', fired(w, [chat('idle', T2)]).join() === 'chat-1:done')
}

// Steering a running lap is a person asking, and `turnStartedAt` alone would miss it:
// a steering message carries no `queue_order`, so only `lastUserMessageAt` moves.
{
	const w = new TurnWatcher()
	fired(w, [chat('working', T1)])
	fired(w, [chat('idle', T1)])
	fired(w, [chat('idle', T1)])
	// A lap the agent gave itself, steered into partway through.
	fired(w, [chat('working', T1)])
	fired(w, [chat('idle', T1, 'chat-1', T2)])
	const now = fired(w, [chat('idle', T1, 'chat-1', T2)])
	check('answering mid-turn is still announced when the turn ends', now.join() === 'chat-1:done', now.join())
	// And the laps after it go quiet again on their own.
	fired(w, [chat('working', T1, 'chat-1', T2)])
	fired(w, [chat('idle', T1, 'chat-1', T2)])
	check('the laps after that answer are quiet again', fired(w, [chat('idle', T1, 'chat-1', T2)]).length === 0)
}

// An error is exempt: a loop that breaks is worth hearing about however it started.
{
	const w = new TurnWatcher()
	fired(w, [chat('working', T1)])
	fired(w, [chat('idle', T1)])
	fired(w, [chat('idle', T1)])
	fired(w, [chat('working', T1)])
	fired(w, [chat('error', T1)])
	check('an error on an unchanged turn head still fires', fired(w, [chat('error', T1)]).join() === 'chat-1:error')
}

// A chat too old to have a turn head keeps the old behaviour rather than going silent.
{
	const w = new TurnWatcher()
	let buzzes = 0
	fired(w, [chat('idle', null)])
	for (let turn = 0; turn < 3; turn++) {
		fired(w, [chat('working', null)])
		fired(w, [chat('idle', null)])
		buzzes += fired(w, [chat('idle', null)]).length
	}
	check('a chat that records neither notifies every time, as it always did', buzzes === 3, `${buzzes} of 3`)
}

// Unsubscribing forgets everything, so re-enabling starts from the world as it is then.
{
	const w = new TurnWatcher()
	fired(w, [chat('working', T1)])
	fired(w, [chat('idle', T1)])
	fired(w, [chat('idle', T1)])
	w.reset()
	check('the first poll after re-subscribing is a baseline again', fired(w, [chat('idle', T1)]).length === 0)
	fired(w, [chat('working', T1)])
	fired(w, [chat('idle', T1)])
	check('and the loop rule starts over rather than muting it', fired(w, [chat('idle', T1)]).join() === 'chat-1:done')
}

// A chat that vanishes mid-turn (its workspace was archived) must not be notified about.
{
	const w = new TurnWatcher()
	fired(w, [chat('working', T1)])
	fired(w, [chat('idle', T1)])
	check('an archived chat drops its pending notification', fired(w, []).length === 0)
	check('and stays gone once the list comes back', fired(w, [chat('idle', T1)]).length === 0)
}

// Chats are independent: one looping must not mute another.
{
	const w = new TurnWatcher()
	const both = (s: string, t: string) => [chat(s, T1, 'looper'), chat(s, t, 'yours')]
	fired(w, both('working', T1))
	fired(w, both('idle', T1))
	fired(w, both('idle', T1))
	fired(w, both('working', T1))
	fired(w, both('idle', T1))
	const now = fired(w, [chat('idle', T1, 'looper'), chat('idle', T2, 'yours')])
	check('a looping chat goes quiet on its own', !now.includes('looper:done'))
	check('while the chat beside it still notifies', now.includes('yours:done'), now.join())
}

console.log(failures ? `notify: ${failures} failure(s)` : 'notify: turn watcher ok')
process.exit(failures ? 1 : 0)
