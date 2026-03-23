/**
 * Census data parsing — extract backend/feature results from vitest JSON
 * output or per-backend result files.
 */

export interface CensusData {
  backendNames: string[]
  featureIds: string[]
  /** backend -> featureId -> pass/fail */
  results: Map<string, Map<string, boolean>>
  /** backend -> featureId -> failure message */
  notes: Map<string, Map<string, string>>
  /** category -> featureIds in that category */
  categories: Map<string, string[]>
}

/** Shape of a per-backend result JSON file. */
export interface PerBackendFile {
  backend: string
  version: string
  generated: string
  results: Record<string, boolean>
  notes?: Record<string, string>
}

// ── Shared helpers ──

function buildCategories(featureIds: string[]): Map<string, string[]> {
  const categories = new Map<string, string[]>()
  for (const id of featureIds) {
    const cat = id.split(".")[0]!
    if (!categories.has(cat)) categories.set(cat, [])
    categories.get(cat)!.push(id)
  }
  return categories
}

/**
 * Transform raw vitest assertion messages into human-readable capability notes.
 *
 * "AssertionError: expected false to be true // Object.is equality\n    at ..."
 * becomes: "not supported"
 */
function humanizeNote(raw: string): string {
  // Take first line only (strip stack traces)
  let msg = raw.split("\n")[0]!.trim()
  // Strip error prefix and vitest suffix
  msg = msg.replace(/^(AssertionError|Error|TypeError|RangeError):\s*/i, "")
  msg = msg.replace(/\s*\/\/.*$/, "")

  // Common boolean patterns
  if (msg === "expected false to be true") return "not supported"
  if (msg === "expected true to be false") return "unexpectedly enabled"

  // "expected X to be Y" -> "got X, expected Y"
  const toBeMatch = msg.match(/^expected (.+) to be (.+)$/)
  if (toBeMatch) return `got ${toBeMatch[1]}, expected ${toBeMatch[2]}`

  // "expected X to contain Y" -> "missing Y"
  const containMatch = msg.match(/^expected .+ to contain (.+)$/)
  if (containMatch) return `missing ${containMatch[1]}`

  // "expected X not to be null" -> "no value returned"
  if (/expected .+ not to be null/.test(msg)) return "no value returned"

  return msg
}

function collectFeatureIds(results: Map<string, Map<string, boolean>>): string[] {
  const allIds = new Set<string>()
  for (const features of results.values()) {
    for (const id of features.keys()) allIds.add(id)
  }
  return [...allIds].sort()
}

// ── From vitest JSON ──

/**
 * Parse vitest JSON reporter output into structured census data.
 */
export function parseVitestJson(json: any): CensusData {
  const results = new Map<string, Map<string, boolean>>()
  const notes = new Map<string, Map<string, string>>()

  for (const file of json.testResults ?? []) {
    for (const test of file.assertionResults ?? []) {
      const titles: string[] = test.ancestorTitles ?? []
      const backend = titles[0] ?? "unknown"
      const id = test.title ?? "unknown"

      if (!results.has(backend)) results.set(backend, new Map())
      if (!notes.has(backend)) notes.set(backend, new Map())
      const features = results.get(backend)!
      const backendNotes = notes.get(backend)!

      const passed = test.status === "passed"
      features.set(id, passed)

      if (!passed) {
        const failureMessages: string[] = test.failureMessages ?? []
        const failureText = failureMessages.join("; ").trim()
        if (failureText) {
          backendNotes.set(id, humanizeNote(failureText))
        }
      }
    }
  }

  const backendNames = [...results.keys()]
  const featureIds = collectFeatureIds(results)
  const categories = buildCategories(featureIds)

  return { backendNames, featureIds, results, notes, categories }
}

// ── From per-backend result files ──

/**
 * Aggregate census data from individual per-backend JSON result files.
 */
export function fromPerBackendFiles(files: PerBackendFile[]): CensusData {
  const results = new Map<string, Map<string, boolean>>()
  const notes = new Map<string, Map<string, string>>()
  const backendNames: string[] = []

  for (const file of files) {
    backendNames.push(file.backend)
    results.set(file.backend, new Map(Object.entries(file.results)))

    if (file.notes && Object.keys(file.notes).length > 0) {
      notes.set(file.backend, new Map(Object.entries(file.notes)))
    } else {
      notes.set(file.backend, new Map())
    }
  }

  const featureIds = collectFeatureIds(results)
  const categories = buildCategories(featureIds)

  return { backendNames, featureIds, results, notes, categories }
}
