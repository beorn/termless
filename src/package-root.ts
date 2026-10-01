import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

/** Locate an owning package by identity, independently of source or bundle depth. */
export function findPackageRoot(start: string, expectedName: string): string {
  const checked: string[] = []
  const failures: string[] = []
  let dir = start
  for (let i = 0; i < 10; i++) {
    const path = join(dir, "package.json")
    checked.push(path)
    if (existsSync(path)) {
      try {
        const pkg: unknown = JSON.parse(readFileSync(path, "utf-8"))
        if (pkg !== null && typeof pkg === "object" && "name" in pkg && pkg.name === expectedName) return dir
      } catch (error) {
        // Continue past unrelated unreadable ancestors; retain them in the failure diagnostic.
        failures.push(`${path}: ${String(error)}`)
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    `Package root not found: expected ${expectedName}; start ${start}; checked ${checked.join(", ")}` +
      (failures.length ? `; unreadable ${failures.join("; ")}` : ""),
  )
}
