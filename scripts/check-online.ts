import assert from 'node:assert/strict'
import { OFFLINE_GRACE_MS, offlineDelay } from '../web/src/lib/online.ts'

const now = 1_000_000

assert.equal(OFFLINE_GRACE_MS, 10_000, 'offline grace lasts ten seconds')
assert.equal(offlineDelay(null, now), 10_000, 'the first failed request gets the full grace period')
assert.equal(offlineDelay(now - 3_000, now), 7_000, 'a recent successful request keeps the banner hidden')
assert.equal(offlineDelay(now - 12_000, now), 0, 'an expired grace period shows offline immediately')

console.info('online: offline grace ok')
