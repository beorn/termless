/**
 * Census reporter -- transforms vitest results into census.json.
 *
 * Interprets the test hierarchy as:
 *   describe("<backend>") > describe("<category>", { meta }) > test("<name>", { meta })
 *
 * Result mapping:
 *   - Pass -> "yes"
 *   - Fail with PartialSupport error -> "partial" + notes
 *   - Fail with any other error -> "no" + notes
 *   - Skip -> "unknown"
 */

import { writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { Reporter, TestModule, TestCase, TestSuite } from "vitest/node"
import type { CensusDatabase, CensusFeature, ProbeResult, BackendInfo } from "./types.ts"

export default class CensusReporter implements Reporter {
  private outputPath: string

  constructor(options?: { outputPath?: string }) {
    this.outputPath = options?.outputPath ?? "census/current.json"
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    if (!testModules.length) return

    const backends: Record<string, BackendInfo> = {}
    const featuresMap = new Map<string, CensusFeature>()

    for (const mod of testModules) {
      for (const testCase of mod.children.allTests()) {
        this.processTestCase(testCase, backends, featuresMap)
      }
    }

    const db: CensusDatabase = {
      generated: new Date().toISOString(),
      termlessVersion: "0.3.0",
      backends,
      features: [...featuresMap.values()],
    }

    const outPath = resolve(this.outputPath)
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, JSON.stringify(db, null, 2), "utf-8")
    console.log(
      `\nCensus: ${db.features.length} features x ${Object.keys(db.backends).length} backends -> ${outPath}`,
    )
  }

  private processTestCase(
    testCase: TestCase,
    backends: Record<string, BackendInfo>,
    features: Map<string, CensusFeature>,
  ): void {
    // Walk up the parent chain to find backend name and category
    const path = this.getPath(testCase)
    // Path: [backendName, category, ...] (from outermost describe to test)
    if (path.length < 2) return

    const backendName = path[0]!
    const category = path[1]!
    const testName = testCase.name
    const meta = testCase.meta()
    const featureId =
      (meta as Record<string, unknown>).id as string | undefined ??
      `${category}-${testName}`.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")

    // Determine support level from result
    const testResult = testCase.result()
    let result: ProbeResult
    if (testResult.state === "passed") {
      result = { support: "yes" }
    } else if (testResult.state === "skipped") {
      result = { support: "unknown" }
    } else if (testResult.state === "failed") {
      const errors = testResult.errors
      const isPartial = errors?.some(
        (e) => e.name === "PartialSupport" || e.message?.includes("PartialSupport"),
      )
      result = {
        support: isPartial ? "partial" : "no",
        notes: errors?.[0]?.message,
      }
    } else {
      result = { support: "unknown" }
    }

    // Get or create feature entry
    if (!features.has(featureId)) {
      // Get spec from parent suite meta
      const suiteMeta = this.findSuiteMeta(testCase)
      features.set(featureId, {
        id: featureId,
        name: testName,
        category,
        spec: (suiteMeta as Record<string, unknown>)?.spec as string | undefined,
        results: {},
      })
    }
    features.get(featureId)!.results[backendName] = result

    // Ensure backend is registered
    if (!backends[backendName]) {
      backends[backendName] = { name: backendName, version: "unknown", engine: "unknown" }
    }
  }

  /** Walk parent chain to get suite names from outermost to innermost. */
  private getPath(testCase: TestCase): string[] {
    const path: string[] = []
    let current: TestSuite | TestModule = testCase.parent
    while (current.type === "suite") {
      path.unshift(current.name)
      current = current.parent
    }
    return path
  }

  /** Find meta from the nearest parent suite that has it. */
  private findSuiteMeta(testCase: TestCase): Record<string, unknown> | undefined {
    let current: TestSuite | TestModule = testCase.parent
    while (current.type === "suite") {
      const meta = current.meta() as Record<string, unknown>
      if (meta && Object.keys(meta).length > 0) return meta
      current = current.parent
    }
    return undefined
  }
}
