import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_TOP_K = 3
const MAX_TOP_K = 5
const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const docPathCandidates = [
  join(process.cwd(), 'doc.md'),
  join(moduleDirectory, 'doc.md'),
  join(moduleDirectory, '..', 'doc.md'),
]

let cachedChunks: string[] | undefined

export interface ScoredDocumentChunk {
  chunkIndex: number
  score: number
  text: string
}

export type DocumentSearchResult =
  | {
      status: 'success'
      query: string
      matches: ScoredDocumentChunk[]
    }
  | {
      status: 'no_match'
      query: string
      message: string
      matches: []
    }
  | {
      status: 'error'
      query: string
      message: string
      matches: []
    }

export function splitMarkdownIntoChunks(markdown: string): string[] {
  return markdown
    .split(/\r?\n\s*\r?\n/g)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
}

export function searchDocument(
  query: string,
  topK = DEFAULT_TOP_K,
): DocumentSearchResult {
  const trimmedQuery = query.trim()

  if (!trimmedQuery) {
    return {
      status: 'no_match',
      query,
      message: 'Search query is empty.',
      matches: [],
    }
  }

  let chunks: string[]
  try {
    chunks = loadChunks()
  } catch (error) {
    return {
      status: 'error',
      query: trimmedQuery,
      message:
        error instanceof Error ? error.message : 'Unable to load doc.md.',
      matches: [],
    }
  }

  const matches = chunks
    .map((text, chunkIndex) => ({
      chunkIndex,
      score: scoreChunk(trimmedQuery, text),
      text,
    }))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || left.chunkIndex - right.chunkIndex)
    .slice(0, clampTopK(topK))

  if (matches.length === 0) {
    return {
      status: 'no_match',
      query: trimmedQuery,
      message: 'No matching doc.md chunks were found for the query.',
      matches: [],
    }
  }

  return {
    status: 'success',
    query: trimmedQuery,
    matches,
  }
}

export function scoreChunk(query: string, chunk: string): number {
  const normalizedQuery = query.trim().toLowerCase()
  const normalizedChunk = chunk.toLowerCase()

  if (!normalizedQuery || !normalizedChunk) {
    return 0
  }

  let score = normalizedChunk.includes(normalizedQuery) ? 100 : 0

  for (const term of extractSearchTerms(normalizedQuery)) {
    if (!normalizedChunk.includes(term)) {
      continue
    }

    score += isHanTerm(term) ? term.length * 3 : Math.max(2, term.length)
  }

  return score
}

function loadChunks(): string[] {
  if (cachedChunks) {
    return cachedChunks
  }

  cachedChunks = splitMarkdownIntoChunks(readDocMarkdown())
  return cachedChunks
}

function readDocMarkdown(): string {
  const checkedPaths = [...new Set(docPathCandidates)]

  for (const docPath of checkedPaths) {
    try {
      return readFileSync(docPath, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code

      if (code && code !== 'ENOENT') {
        throw new Error(`Unable to read doc.md at ${docPath}: ${String(error)}`)
      }
    }
  }

  throw new Error(`doc.md was not found. Checked: ${checkedPaths.join(', ')}`)
}

function clampTopK(topK: number): number {
  if (!Number.isFinite(topK)) {
    return DEFAULT_TOP_K
  }

  return Math.min(MAX_TOP_K, Math.max(1, Math.trunc(topK)))
}

function extractSearchTerms(text: string): string[] {
  const terms: string[] = []
  const latinTerms = text.match(/[a-z0-9]+/g) ?? []
  terms.push(...latinTerms)

  for (const run of text.match(/\p{Script=Han}+/gu) ?? []) {
    terms.push(run)

    const maxNgramLength = Math.min(4, run.length)
    for (let ngramLength = 2; ngramLength <= maxNgramLength; ngramLength += 1) {
      for (let index = 0; index <= run.length - ngramLength; index += 1) {
        terms.push(run.slice(index, index + ngramLength))
      }
    }
  }

  return [...new Set(terms)].filter((term) => term.length > 0)
}

function isHanTerm(term: string): boolean {
  return /^\p{Script=Han}+$/u.test(term)
}
