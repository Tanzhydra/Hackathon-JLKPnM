import { z } from 'zod'

export const id = z.uuid()
export const decision = z.object({
  decision: z.enum(['approve', 'reject', 'needs_fix']),
  reason: z.string().trim().min(3).max(1000),
  student_signature_checked: z.boolean().default(false),
  lecturer_signature_checked: z.boolean().default(false),
  doctor_letter_checked: z.boolean().default(false),
}).superRefine((value, ctx) => {
  if (value.decision !== 'approve') return
  if (!value.student_signature_checked) ctx.addIssue({ code: 'custom', path: ['student_signature_checked'], message: 'Tanda tangan mahasiswa harus diperiksa' })
  if (!value.lecturer_signature_checked) ctx.addIssue({ code: 'custom', path: ['lecturer_signature_checked'], message: 'Tanda tangan dosen harus diperiksa' })
})
