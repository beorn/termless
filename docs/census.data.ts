/**
 * VitePress data loader — reads per-backend census result JSON files at build time.
 * Consumed by census.md via `import { data } from './census.data'`.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

interface BackendResult {
  backend: string
  version: string
  generated: string
  results: Record<string, boolean>
  notes?: Record<string, string>
}

interface CensusPageData {
  backends: Array<{ name: string; version: string }>
  features: string[]
  /** backend name -> feature id -> boolean */
  results: Record<string, Record<string, boolean>>
  /** backend name -> feature id -> note string */
  notes: Record<string, Record<string, string>>
  generated: string
}

declare const data: CensusPageData
export { data }

export default {
  load(): CensusPageData {
    const resultsDir = join(__dirname, "../packages/census/results")

    let files: string[]
    try {
      files = readdirSync(resultsDir).filter((f) => f.endsWith(".json"))
    } catch {
      return {
        backends: [],
        features: [],
        results: {},
        notes: {},
        generated: "",
      }
    }

    const perBackend: BackendResult[] = []
    for (const file of files) {
      try {
        const raw = JSON.parse(readFileSync(join(resultsDir, file), "utf-8"))
        if (raw.backend && raw.results) {
          perBackend.push(raw)
        }
      } catch {
        // skip malformed files
      }
    }

    // Sort backends alphabetically
    perBackend.sort((a, b) => a.backend.localeCompare(b.backend))

    // Collect all feature IDs (union across all backends)
    const featureSet = new Set<string>()
    for (const b of perBackend) {
      for (const id of Object.keys(b.results)) {
        featureSet.add(id)
      }
    }
    const features = Array.from(featureSet).sort()

    // Build results and notes maps
    const results: Record<string, Record<string, boolean>> = {}
    const notes: Record<string, Record<string, string>> = {}
    for (const b of perBackend) {
      results[b.backend] = b.results
      notes[b.backend] = b.notes ?? {}
    }

    // Latest generated timestamp
    const generated = perBackend
      .map((b) => b.generated)
      .sort()
      .pop() ?? ""

    return {
      backends: perBackend.map((b) => ({ name: b.backend, version: b.version })),
      features,
      results,
      notes,
      generated,
    }
  },
}
