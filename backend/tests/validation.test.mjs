import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decision } from '../lib/validation.ts'

test('approval requires recorded signature checks, but correction requests do not', () => {
  const approval = { decision: 'approve', reason: 'Bukti sesuai' }
  assert.equal(decision.safeParse(approval).success, false)
  assert.equal(decision.safeParse({ ...approval, student_signature_checked: true, lecturer_signature_checked: true }).success, true)
  assert.equal(decision.safeParse({ decision: 'needs_fix', reason: 'Tanda tangan dosen belum ada' }).success, true)
})
