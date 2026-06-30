import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { searchDocument } from '../rag.js'

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

const doc = readFileSync(resolve(process.cwd(), 'doc.md'), 'utf8')
const requiredHeaders = [
  '## Lead Gen Forms',
  '## Bidding & Budgeting',
  '## Ad Formats & Creative',
  '## Audience Targeting',
  '## Analytics & Tracking',
]

assert(
  doc.startsWith('# LinkedIn B2B Advertising Playbook 2026'),
  'doc.md must start with the LinkedIn playbook title',
)

for (const header of requiredHeaders) {
  assert(doc.includes(header), `Missing required header: ${header}`)
}

for (let index = 0; index < requiredHeaders.length; index += 1) {
  const header = requiredHeaders[index]
  const nextHeader = requiredHeaders[index + 1]
  const sectionStart = doc.indexOf(header)
  const sectionEnd = nextHeader ? doc.indexOf(nextHeader) : doc.length
  const section = doc.slice(sectionStart, sectionEnd)
  const numberedRules = section.match(/^\d+\. /gm) ?? []
  assert(
    numberedRules.length === 20,
    `${header} must contain exactly 20 numbered rules`,
  )
}

const requiredLeadGenRules = [
  '1. Keep the form under 5 fields to reduce friction.',
  '2. Auto-populate professional profile data (e.g., Job Title, Company Name).',
  '3. Always include a link to your company\'s custom privacy policy to ensure GDPR compliance.',
]

for (const rule of requiredLeadGenRules) {
  assert(doc.includes(rule), `Missing exact Lead Gen Forms rule: ${rule}`)
}

const query = 'What are the 3 critical best practices for LinkedIn Lead Gen Forms?'
const result = searchDocument(query, 5)

assert(result.status === 'success', `Expected success, received ${result.status}`)

if (result.status !== 'success') {
  throw new Error('RAG search failed')
}

const combinedMatches = result.matches.map((match) => match.text).join('\n')
for (const rule of requiredLeadGenRules) {
  assert(combinedMatches.includes(rule), `Search result missing rule: ${rule}`)
}

console.log('RAG smoke passed')
