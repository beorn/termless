/**
 * Census reporter — shows capability matrix instead of pass/fail noise.
 */

export default class CensusReporter {
  onInit() {
    console.log("\n@termless/census\n")
  }

  onCollected(files?: any[]) {
    console.log(`  Collected: ${files?.length ?? 0} files`)
  }

  onTaskUpdate() {
    // Called for each test result
  }

  async onFinished(files?: any[], _errors?: unknown[], _coverage?: unknown, _time?: number) {
    if (!files?.length) {
      console.log("No census files found.")
      return
    }

    const backends = new Map<string, { yes: number; no: number; partial: number; total: number }>()

    for (const file of files) {
      this.walk(file, [], backends)
    }

    for (const [name, counts] of backends) {
      const pct = Math.round((counts.yes / (counts.total || 1)) * 100)
      console.log(`  ${name.padEnd(14)} ${counts.yes}/${counts.total} (${pct}%)`)
    }

    console.log("")
    process.exitCode = 0
  }

  private walk(task: any, path: string[], backends: Map<string, any>) {
    if (task.tasks) {
      const newPath = task.name ? [...path, task.name] : path
      for (const child of task.tasks) {
        this.walk(child, newPath, backends)
      }
    } else if (task.type === "test" && task.result) {
      const backend = path.length >= 2 ? path[path.length - 2]! : "unknown"
      if (!backends.has(backend)) {
        backends.set(backend, { yes: 0, no: 0, partial: 0, total: 0 })
      }
      const counts = backends.get(backend)!
      counts.total++
      if (task.result.state === "pass") {
        const hasNotes = task.meta?.notes
        if (hasNotes) counts.partial++
        else counts.yes++
      } else {
        counts.no++
      }
    }
  }
}
