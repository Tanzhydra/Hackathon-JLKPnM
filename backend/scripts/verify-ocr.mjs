import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { readForm14WithSource } from '../lib/vision.ts'

const file = process.argv[2]
if (!file) throw new Error('Berikan path scan PDF/JPG/PNG untuk diuji')
const bytes = await readFile(file)
const { extraction, modelVersion } = await readForm14WithSource(bytes, file.toLowerCase())
if (process.argv.includes('--text')) {
  console.log(JSON.stringify(extraction, null, 2))
  process.exit(0)
}
const fields = Object.fromEntries(['name','nrp','class_name','program','statement_date'].map(key =>
  [key, { filled: extraction[key].text.length > 0, confidence: extraction[key].confidence }]))
console.log(JSON.stringify({ file: basename(file), model: modelVersion, fields,
  student_signature: extraction.student_signature,
  lines: extraction.lines.map(line => ({
    class_date: { filled: !!line.class_date.text, confidence: line.class_date.confidence },
    course_name: { filled: !!line.course_name.text, confidence: line.course_name.confidence },
    week_no: { filled: !!line.week_no.text, confidence: line.week_no.confidence },
    lecturer_name: { filled: !!line.lecturer_name.text, confidence: line.lecturer_name.confidence },
    lecturer_signature: line.lecturer_signature,
    reason: { filled: !!line.reason.text, confidence: line.reason.confidence },
  })),
}, null, 2))
