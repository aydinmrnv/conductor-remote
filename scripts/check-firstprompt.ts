/**
 * Assert the first-prompt queue spends the right budget on the right failure.
 *
 * `FirstPromptQueue` (src/firstprompt.ts) now sends into a workspace whose worktree
 * is still building, because waiting for `ready` cost minutes and an agent creating
 * a batch of workspaces read that silence as a broken send. What makes that safe is
 * a split that `tsc` cannot see: a send tried before `ready` spends `earlyAttempts`
 * and is bounded by `MAX_EARLY_ATTEMPTS`, while only a send tried after it spends
 * the `attempts` budget whose third failure gives up in public.
 *
 * Both halves of that split cost something real if they slip. Count an early failure
 * against `attempts` and every slow repo greets its owner with a `failed` prompt
 * that Conductor would have taken a minute later — the exact regression this change
 * could introduce. Stop counting the ready ones and a prompt that genuinely cannot
 * be delivered retries forever instead of saying so.
 *
 * No macOS, no Conductor, no relay: `DeliveryDeps` is injected, which is what that
 * interface is for. Portable, so the ubuntu CI job runs it too.
 *
 * Strip-clean (plain-node type-stripping), stdlib-only — see CLAUDE.md.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { WorkspacePhase } from '../src/firstprompt.ts'
import { FirstPromptQueue } from '../src/firstprompt.ts'

const failures: string[] = []
function check(label: string, pass: boolean, detail = ''): void {
	if (pass) console.info(`  ok    ${label}`)
	else {
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
		failures.push(label)
	}
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
// An entry left waiting keeps its queue's 1s pump alive, so every block below dismisses
// what it parked — which is `DELETE …/prompt`'s own path, exercised for free.

/**
 * Wait for something the queue does on its own schedule, rather than for a duration.
 * The delays under test are seconds long and land on a 1s poll, so a fixed sleep is
 * either flaky or slower than the whole rest of this file.
 */
async function waitFor(what: () => boolean, ms = 9_000): Promise<boolean> {
	const stopAt = Date.now() + ms
	while (!what() && Date.now() < stopAt) await sleep(50)
	return what()
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-firstprompt-'))

/** Conductor, as far as the queue can tell: a phase, a chat, and whatever the send did. */
interface Fake {
	phase: WorkspacePhase
	sessionId: string | null
	alreadySent: boolean
	ok: boolean
	blocked: boolean
	/** One entry per send the queue drove, so spacing is observable and not inferred. */
	sends: string[]
}

function scenario(name: string, initial: Partial<Fake> = {}): { queue: FirstPromptQueue; state: Fake } {
	const state: Fake = {
		phase: 'setting_up',
		sessionId: 'chat-1',
		alreadySent: false,
		ok: false,
		blocked: false,
		sends: [],
		...initial
	}
	const queue = new FirstPromptQueue(path.join(dir, `${name}.json`), {
		inspect: () => ({ phase: state.phase, sessionId: state.sessionId, alreadySent: state.alreadySent }),
		send: async (_workspaceId, _sessionId, text) => {
			state.sends.push(text)
			return { ok: state.ok, blocked: state.blocked, error: state.ok ? undefined : 'no composer yet' }
		}
	})
	return { queue, state }
}

// A worktree that is still building is sent into, not waited on. This is the whole change.
{
	const { queue, state } = scenario('early-send', { ok: true })
	const settled = await queue.enqueue('ws-1', 'hello')
	check('a setting-up workspace is sent to rather than waited on', state.sends.join('') === 'hello')
	check('the delivered entry stops existing', queue.get('ws-1') === null)
	check('the caller waiting on it is told it landed', settled === null)
}

// The failure that early sending introduces — Conductor hasn't drawn the pane — must
// cost nothing that a later, real send would have needed.
{
	const { queue, state } = scenario('early-fail')
	void queue.enqueue('ws-2', 'hello')
	// Past a couple of poll ticks: enough that a queue spinning at POLL_MS would show it.
	await waitFor(() => state.sends.length > 0)
	await sleep(1_500)
	check('a failed early send spends no counted attempt', queue.get('ws-2')?.attempts === 0)
	check('it spends an early one instead', queue.get('ws-2')?.earlyAttempts === 1)
	check('the entry is still waiting, not failed', queue.get('ws-2')?.status === 'waiting')
	check('early sends are spaced rather than spun', state.sends.length === 1, `${state.sends.length} sends`)

	// `ready` is new information, so the long early gap stops applying to it.
	state.phase = 'ready'
	// The counted gap is RETRY_DELAY_MS from that first failure, not from this line.
	await waitFor(() => state.sends.length > 1)
	check('turning ready releases the early spacing', state.sends.length === 2, `${state.sends.length} sends`)
	check('that one does count', queue.get('ws-2')?.attempts === 1)
	queue.forget('ws-2')
}

// A prompt sent by hand from the Mac during setup is still one prompt.
{
	const { queue, state } = scenario('already-sent', { alreadySent: true })
	const settled = await queue.enqueue('ws-3', 'hello')
	check('a prompt already sent from the Mac is not sent again', state.sends.length === 0)
	check('and the entry settles as delivered', settled === null && queue.get('ws-3') === null)
}

// A locked Mac hands the attempt back whichever budget it came out of.
{
	const { queue, state } = scenario('blocked-early', { blocked: true })
	void queue.enqueue('ws-4', 'hello')
	await waitFor(() => state.sends.length > 0)
	check('a lock-blocked early send hands its early attempt back', (queue.get('ws-4')?.earlyAttempts ?? 0) === 0)
	check('and never touches the counted budget', queue.get('ws-4')?.attempts === 0)
	queue.forget('ws-4')
}

// `sendImmediately: false` is the phone's checkbox and the old behaviour: nothing is
// typed until the worktree is built, however long that takes.
{
	const { queue, state } = scenario('opt-out')
	void queue.enqueue('ws-6', 'hello', false)
	await sleep(1_500)
	check('opting out sends nothing while setting up', state.sends.length === 0, `${state.sends.length} sends`)
	check('and spends no budget at all', (queue.get('ws-6')?.earlyAttempts ?? 0) === 0)
	state.phase = 'ready'
	await waitFor(() => state.sends.length > 0)
	check('turning ready is what releases it', state.sends.length === 1)
	queue.forget('ws-6')
}

// A new-workspace attachment is written only after Conductor has made the worktree,
// and that write must finish before the token can reach the agent.
{
	let worktree: string | null = null
	const materialized: string[][] = []
	const sends: string[] = []
	const queue = new FirstPromptQueue(path.join(dir, 'attachments.json'), {
		inspect: () => ({ phase: 'setting_up', sessionId: 'chat-attachments', alreadySent: false, worktree }),
		materialize: async (_workspaceId, _worktree, attachmentIds) => {
			materialized.push(attachmentIds)
			return { ok: true }
		},
		send: async (_workspaceId, _sessionId, text) => {
			sends.push(text)
			return { ok: true }
		}
	})
	void queue.enqueue('ws-attachments', 'hello', true, ['stage-1'])
	await sleep(100)
	check('an attached first prompt waits for its worktree', materialized.length === 0 && sends.length === 0)
	worktree = '/tmp/new-worktree'
	await waitFor(() => sends.length === 1)
	check(
		'the staged files are placed before the first prompt sends',
		materialized[0]?.[0] === 'stage-1' && sends[0] === 'hello'
	)
}

// Past `ready` the old rules hold: failures count, and the third one gives up in public.
{
	const { queue, state } = scenario('ready-fail', { phase: 'ready' })
	void queue.enqueue('ws-5', 'hello')
	await waitFor(() => state.sends.length > 0)
	check('a failure after ready spends the counted budget', queue.get('ws-5')?.attempts === 1)
	check('and none of the early one', (queue.get('ws-5')?.earlyAttempts ?? 0) === 0)
	queue.forget('ws-5')
}

fs.rmSync(dir, { recursive: true, force: true })
if (failures.length) {
	console.error(`\nfirstprompt: ${failures.length} check(s) failed — ${failures.join(', ')}`)
	process.exit(1)
}
console.info('firstprompt: delivery budgets ok')
