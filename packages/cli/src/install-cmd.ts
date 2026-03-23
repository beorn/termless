/**
 * `termless install` and `termless upgrade` — manage backend packages.
 *
 * Install detects the package manager and runs the appropriate install command.
 * Upgrade checks installed versions against the manifest and updates as needed.
 */

import type { Command } from "commander"
import { execSync } from "node:child_process"
import {
  manifest,
  backends,
  entry,
  isReady,
  getInstalledVersion,
  detectPackageManager,
  buildBackend,
} from "../../../src/backends.ts"
import { printBackendsTable } from "./backends-cmd.ts"

export function registerInstallCommand(program: Command): void {
  program
    .command("install [names...]")
    .description("Install backends (default backends if none specified)")
    .option("--all", "Install all backends")
    .action((names: string[], opts: { all?: boolean }) => {
      const m = manifest()
      const pm = detectPackageManager()
      const allNames = backends()

      // Default backend names: those with default=true in the manifest
      const defaultNames = allNames.filter((name) => entry(name)?.default)

      // Determine which backends to install
      let toInstall: string[]
      if (opts.all) {
        toInstall = allNames
      } else if (names.length > 0) {
        // Validate names
        for (const name of names) {
          if (!m.backends[name]) {
            console.error(`\u2717 Unknown backend: ${name}`)
            console.error(`  Available: ${allNames.join(", ")}`)
            process.exitCode = 1
            return
          }
        }
        toInstall = names
      } else {
        toInstall = defaultNames
      }

      console.log(`\ntermless install (${pm})\n`)

      // Partition into already-installed, skipped (wrong platform), and installable
      const toRun: string[] = []
      const platform = process.platform

      for (const name of toInstall) {
        const e = entry(name)!

        // Check if already installed
        if (isReady(name)) {
          const upstreamVer = e.version ?? "latest"
          console.log(`  \u2713 ${name} already installed (${e.upstream ?? name} ${upstreamVer})`)
          continue
        }

        // Check platform restrictions
        if (e.platforms && !e.platforms.includes(platform)) {
          console.log(`  \u2717 ${name} — not available on ${platform} (requires: ${e.platforms.join(", ")})`)
          continue
        }

        toRun.push(name)
      }

      if (toRun.length === 0) {
        // Nothing to npm-install, but check if anything needs building
        const needsBuild = toInstall.filter((n) => !isReady(n))
        if (needsBuild.length > 0) {
          console.log("")
          for (const name of needsBuild) {
            try {
              buildBackend(name)
              console.log(`  ✓ ${name} built`)
            } catch (e) {
              console.log(`  ✗ ${name} build failed: ${e instanceof Error ? e.message : e}`)
            }
          }
        } else {
          printBackendsTable()
          return
        }
        console.log("")
        return
      }

      // Install npm packages
      const pkgs = toRun.map((n) => `${entry(n)!.package}@${m.version}`).join(" ")
      const cmd = `${pm} ${pm === "npm" ? "install -D" : "add -D"} ${pkgs}`
      console.log(`\n  Running: ${cmd}\n`)

      try {
        execSync(cmd, { stdio: "inherit" })
        console.log(`\n  ✓ Packages installed: ${toRun.join(", ")}`)
      } catch {
        console.log(`\n  ✗ Install failed. Run manually:\n  ${cmd}\n`)
        process.exitCode = 1
        return
      }

      // Build native/wasm backends
      const allInstalled = [...new Set([...toInstall, ...toRun])]
      const toBuild = allInstalled.filter((n) => !isReady(n))
      if (toBuild.length > 0) {
        console.log("\n  Building backends...\n")
        for (const name of toBuild) {
          try {
            buildBackend(name)
            console.log(`  ✓ ${name} built`)
          } catch (e) {
            console.log(`  ✗ ${name} build failed: ${e instanceof Error ? e.message : e}`)
          }
        }
      }

      printBackendsTable()
    })
}

export function registerUpgradeCommand(program: Command): void {
  program
    .command("upgrade [names...]")
    .description("Upgrade installed backends to manifest versions")
    .action((names: string[]) => {
      const m = manifest()
      const pm = detectPackageManager()
      const allNames = backends()

      // Determine which backends to check
      let toCheck: string[]
      if (names.length > 0) {
        for (const name of names) {
          if (!m.backends[name]) {
            console.error(`\u2717 Unknown backend: ${name}`)
            console.error(`  Available: ${allNames.join(", ")}`)
            process.exitCode = 1
            return
          }
        }
        toCheck = names.filter(isReady)
        const notInstalled = names.filter((n) => !isReady(n))
        for (const name of notInstalled) {
          console.error(`  \u2717 ${name} is not installed (use \`termless install ${name}\` first)`)
        }
      } else {
        toCheck = allNames.filter(isReady)
      }

      console.log(`\ntermless upgrade (${pm})\n`)

      // Check which need upgrading
      const toUpgrade: string[] = []

      for (const name of toCheck) {
        const e = entry(name)!
        const installed = getInstalledVersion(e.package)
        const target = m.version

        if (installed === target) {
          console.log(`  \u2713 ${name} ${installed} (up to date)`)
        } else {
          console.log(`  \u2191 ${name} ${installed ?? "unknown"} \u2192 ${target}`)
          toUpgrade.push(name)
        }
      }

      if (toUpgrade.length === 0) {
        console.log("\n  All backends up to date.\n")
        return
      }

      // Build and run the install command (install with version pins upgrades)
      const pkgs = toUpgrade.map((n) => `${entry(n)!.package}@${m.version}`).join(" ")
      const cmd = `${pm} ${pm === "npm" ? "install -D" : "add -D"} ${pkgs}`
      console.log(`\n  Running: ${cmd}\n`)

      try {
        execSync(cmd, { stdio: "inherit" })
        console.log(`\n  \u2713 Upgraded: ${toUpgrade.join(", ")}\n`)
      } catch {
        console.error(`\n  \u2717 Upgrade failed. Run manually:\n  ${cmd}\n`)
        process.exitCode = 1
      }
    })
}
