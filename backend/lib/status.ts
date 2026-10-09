export const lineStates = ['draft', 'submitted', 'needs_fix', 'rejected', 'approved_pending', 'applied', 'conflict'] as const

export type LineState = (typeof lineStates)[number]
export type StatusCounts = Record<LineState, number> & { total: number }

export function statusCounts(lines: { attendance_id: string; state: LineState; version_no: number }[]): StatusCounts {
  const counts = Object.fromEntries(lineStates.map(state => [state, 0])) as Record<LineState, number>
  const latest = new Map<string, { state: LineState; version_no: number }>()
  for (const line of lines) {
    const previous = latest.get(line.attendance_id)
    if (!previous || line.version_no > previous.version_no) latest.set(line.attendance_id, line)
  }
  for (const line of latest.values()) counts[line.state]++
  return { ...counts, total: latest.size }
}
