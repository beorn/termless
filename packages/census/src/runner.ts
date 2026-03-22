/**
 * Census runner — executes probes against backends and collects results.
 *
 * Each probe receives an already-initialized backend (80x24).
 * The runner handles init/destroy lifecycle around each probe invocation.
 */

import type { TerminalBackend } from "../../../src/types.ts"
import type { ProbeDefinition, BackendInfo, CensusDatabase, CensusEntry, ProbeResult } from "./types.ts"

export function createCensusRunner(
  backends: Record<string, { backend: TerminalBackend; info: BackendInfo }>,
) {
  return {
    run(probes: ProbeDefinition[]): CensusDatabase {
      const features: CensusEntry[] = []
      let totalYes = 0
      let totalNo = 0
      let totalPartial = 0
      let totalUnknown = 0

      for (const probe of probes) {
        const results: Record<string, ProbeResult> = {}

        for (const [name, { backend }] of Object.entries(backends)) {
          try {
            backend.init({ cols: 80, rows: 24 })
            results[name] = probe.probe(backend)
            backend.destroy()
          } catch (e) {
            try {
              backend.destroy()
            } catch {
              // Ignore destroy errors during error recovery
            }
            results[name] = {
              support: "unknown",
              notes: e instanceof Error ? e.message : String(e),
            }
          }

          switch (results[name]!.support) {
            case "yes":
              totalYes++
              break
            case "no":
              totalNo++
              break
            case "partial":
              totalPartial++
              break
            case "unknown":
              totalUnknown++
              break
          }
        }

        features.push({
          id: probe.id,
          name: probe.name,
          category: probe.category,
          spec: probe.spec,
          results,
        })
      }

      return {
        generated: new Date().toISOString(),
        termlessVersion: "0.3.0",
        backends: Object.fromEntries(
          Object.entries(backends).map(([name, { info }]) => [name, info]),
        ),
        features,
        stats: {
          totalProbes: probes.length,
          totalBackends: Object.keys(backends).length,
          totalYes,
          totalNo,
          totalPartial,
          totalUnknown,
        },
      }
    },
  }
}
