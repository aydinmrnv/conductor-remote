import { describe, expect, test } from 'vitest'
import { UiBusyError, uiQueueDepth, uiTurn, withUiPriority } from '../src/writes.ts'

const order: string[] = []
const hold = (name: string, ms: number) => (): Promise<string> =>
	new Promise(resolve => {
		setTimeout(() => {
			order.push(name)
			resolve(name)
		}, ms)
	})

const idle = (): boolean => uiQueueDepth().waiting === 0 && !uiQueueDepth().busy

describe.sequential('UI lock', () => {
	test('serializes operations in arrival order', async () => {
		order.length = 0
		const runs = [uiTurn(hold('a', 40)), uiTurn(hold('b', 5)), uiTurn(hold('c', 5))]
		expect(uiQueueDepth()).toMatchObject({ waiting: 2, busy: true })
		await Promise.all(runs)
		expect(order).toEqual(['a', 'b', 'c'])
		expect(idle()).toBe(true)
	})

	test('prioritizes a person over queued background work', async () => {
		order.length = 0
		await Promise.all([
			withUiPriority('background', () => uiTurn(hold('bg-running', 30))),
			withUiPriority('background', () => uiTurn(hold('bg-1', 5))),
			withUiPriority('background', () => uiTurn(hold('bg-2', 5))),
			withUiPriority('interactive', () => uiTurn(hold('phone', 5)))
		])
		expect(order).toEqual(['bg-running', 'phone', 'bg-1', 'bg-2'])
	})

	test('releases after rejected and synchronously thrown operations', async () => {
		order.length = 0
		await uiTurn(hold('never', 1))
			.then(() => uiTurn(() => Promise.reject(new Error('nope'))))
			.catch(() => order.push('rejected'))
		await uiTurn(hold('after', 1))
		expect(order).toEqual(['never', 'rejected', 'after'])

		await expect(
			uiTurn(() => {
				throw new Error('sync throw')
			})
		).rejects.toThrow('sync throw')
		await uiTurn(hold('still-works', 1))
		expect(idle()).toBe(true)
	})

	test('refuses a fifth waiter without damaging the queue', async () => {
		const runs = [uiTurn(hold('holding', 25))]
		for (let index = 0; index < 4; index++) runs.push(uiTurn(hold(`queued-${index}`, 1)))
		expect(uiQueueDepth().waiting).toBe(4)

		const refused = await uiTurn(hold('over-the-cap', 1)).catch(error => error as unknown)
		expect(refused).toBeInstanceOf(UiBusyError)
		expect((refused as UiBusyError).waiting).toBe(4)

		await Promise.all(runs)
		expect(idle()).toBe(true)
		await uiTurn(hold('recovered', 1))
		expect(idle()).toBe(true)
	})
})
