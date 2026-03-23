/**
 * Census data parsing — extract backend/feature results from vitest JSON output.
 */

export interface CensusData {
  backendNames: string[]
  featureIds: string[]
  /** backend → featureId → pass/fail */
  results: Map<string, Map<string, boolean>>
  /** backend → featureId → failure message */
  notes: Map<string, Map<string, string>>
  /** category → featureIds in that category */
  categories: Map<string, string[]>
}

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
          backendNotes.set(id, failureText)
        }
      }
    }
  }

  const backendNames = [...results.keys()]

  // Collect all feature IDs
  const allIds = new Set<string>()
  for (const features of results.values()) {
    for (const id of features.keys()) allIds.add(id)
  }
  const featureIds = [...allIds].sort()

  // Group by top-level category
  const categories = new Map<string, string[]>()
  for (const id of featureIds) {
    const cat = id.split(".")[0]!
    if (!categories.has(cat)) categories.set(cat, [])
    categories.get(cat)!.push(id)
  }

  return { backendNames, featureIds, results, notes, categories }
}

/**
 * Load census data from a saved current.json file.
 */
export function fromSavedJson(saved: any): CensusData {
  const backendNames: string[] = saved.backends ?? []
  const results = new Map<string, Map<string, boolean>>()
  const notes = new Map<string, Map<string, string>>()

  for (const name of backendNames) {
    const backendResults = saved.results?.[name] ?? {}
    results.set(name, new Map(Object.entries(backendResults)))

    const backendNotes = saved.notes?.[name] ?? {}
    if (Object.keys(backendNotes).length > 0) {
      notes.set(name, new Map(Object.entries(backendNotes)))
    } else {
      notes.set(name, new Map())
    }
  }

  const allIds = new Set<string>()
  for (const features of results.values()) {
    for (const id of features.keys()) allIds.add(id)
  }
  const featureIds = [...allIds].sort()

  const categories = new Map<string, string[]>()
  for (const id of featureIds) {
    const cat = id.split(".")[0]!
    if (!categories.has(cat)) categories.set(cat, [])
    categories.get(cat)!.push(id)
  }

  return { backendNames, featureIds, results, notes, categories }
}

/**
 * Serialize census data to the JSON format written to disk.
 */
export function toSavedJson(data: CensusData): {
  generated: string
  backends: string[]
  results: Record<string, Record<string, boolean>>
  notes?: Record<string, Record<string, string>>
} {
  const resultsOutput: Record<string, Record<string, boolean>> = {}
  const notesOutput: Record<string, Record<string, string>> = {}

  for (const name of data.backendNames) {
    const features = data.results.get(name)!
    const backendNotes = data.notes.get(name)
    resultsOutput[name] = Object.fromEntries(features)
    if (backendNotes && backendNotes.size > 0) {
      notesOutput[name] = Object.fromEntries(backendNotes)
    }
  }

  return {
    generated: new Date().toISOString(),
    backends: data.backendNames,
    results: resultsOutput,
    ...(Object.keys(notesOutput).length > 0 ? { notes: notesOutput } : {}),
  }
}
