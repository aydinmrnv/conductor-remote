import { describe, expect, test } from 'vitest'
import { issuesFromReply } from '../src/linear.ts'

describe('issuesFromReply', () => {
	test('maps nodes, newest activity first, with null-safe relations', () => {
		const { viewer, issues } = issuesFromReply({
			data: {
				viewer: {
					name: 'Aydin',
					assignedIssues: {
						nodes: [
							{
								id: '1',
								identifier: 'ENG-1',
								title: 'Old',
								url: 'u1',
								updatedAt: '2026-01-01T00:00:00Z',
								state: { name: 'Todo', type: 'unstarted' },
								team: { key: 'ENG' },
								project: null
							},
							{
								id: '2',
								identifier: 'ENG-2',
								title: 'New',
								url: 'u2',
								priority: 2,
								updatedAt: '2026-02-01T00:00:00Z',
								state: null,
								team: null,
								project: { name: 'Sidecar' }
							}
						]
					}
				}
			}
		})
		expect(viewer).toBe('Aydin')
		expect(issues.map(i => i.identifier)).toEqual(['ENG-2', 'ENG-1'])
		expect(issues[0]).toMatchObject({ state: '', stateType: '', team: null, project: 'Sidecar', priority: 2 })
	})
	test('surfaces GraphQL errors as one message', () => {
		expect(() => issuesFromReply({ errors: [{ message: 'a' }, { message: 'b' }] })).toThrow('a; b')
	})
	test('an empty reply is an empty list', () => {
		expect(issuesFromReply({}).issues).toEqual([])
	})
})
