import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statusCounts } from '../lib/status.ts'

test('summary counts each attendance once using its newest revision', () => {
  assert.deepEqual(statusCounts([
    { attendance_id: 'one', state: 'needs_fix', version_no: 1 },
    { attendance_id: 'two', state: 'applied', version_no: 1 },
    { attendance_id: 'one', state: 'submitted', version_no: 2 },
  ]), {
    draft: 0, submitted: 1, needs_fix: 0, rejected: 0,
    approved_pending: 0, applied: 1, conflict: 0, total: 2,
  })
})
