import { describe, expect, test } from 'vitest'
import { createWorkspaceLink, linearIssueId } from '../src/deeplink.ts'

describe('createWorkspaceLink', () => {
	test('prompt and path ride flat after the scheme, encoded', () => {
		expect(createWorkspaceLink('conductor', 'Fix the login bug', '/Users/jane/code/my-app')).toBe(
			'conductor://prompt=Fix%20the%20login%20bug&path=%2FUsers%2Fjane%2Fcode%2Fmy-app'
		)
	})
	test('a prompt containing &path= cannot move the workspace', () => {
		expect(createWorkspaceLink('conductor', 'a&path=/tmp', '/repo')).toBe(
			'conductor://prompt=a%26path%3D%2Ftmp&path=%2Frepo'
		)
	})
	test('a bare path opens an empty workspace', () => {
		expect(createWorkspaceLink('conductor', '  ', '/repo')).toBe('conductor://path=%2Frepo')
	})
	test('a Linear issue leads, with an optional prompt', () => {
		expect(createWorkspaceLink('conductor', '', null, 'ENG-123')).toBe('conductor://linear_id=ENG-123')
		expect(createWorkspaceLink('conductor', 'Start here', null, 'ENG-123')).toBe(
			'conductor://linear_id=ENG-123&prompt=Start%20here'
		)
	})
	test('nothing to go on is null', () => {
		expect(createWorkspaceLink('conductor', '', null, '')).toBeNull()
	})
})

describe('linearIssueId', () => {
	test('accepts an identifier, any case', () => {
		expect(linearIssueId('eng-42')).toBe('ENG-42')
	})
	test('reads the identifier out of a linear.app link', () => {
		expect(linearIssueId('https://linear.app/acme/issue/ENG-123/fix-the-login-bug')).toBe('ENG-123')
	})
	test('rejects anything else', () => {
		expect(linearIssueId('42')).toBeNull()
		expect(linearIssueId('https://github.com/acme/app/issues/42')).toBeNull()
	})
})
