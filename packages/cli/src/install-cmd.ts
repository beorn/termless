/**
 * `termless install` and `termless upgrade` — manage backend packages.
 *
 * Install detects the package manager and runs the appropriate install command.
 * Upgrade checks installed versions against the manifest and updates as needed.
 */

import type { Command } from "commander"
import { execSync } from "node:child_process"
import {
  loadManifest,
  backendNames,
  defaultBackendNames,
  isBackendInstalled,
  getInstalledVersion,
  getInstallCommand,
  detectPackageManager,
} from "../../../src/registry.ts"

/** Show all other backends that weren't part of this install. */
function showOtherBackends(installed: string[]): void {
  const manifest = loadManifest()
  const installedSet = new Set(installed)
  const others = Object.entries(manifest.backends)
    .filter(([name]) => !installedSet.has(name))
    .map(([name, entry]) => {
      const ver = entry.upstreamVersion ? ` ${entry.upstreamVersion}` : ""
      return `${name} (${entry.type})${ver}`
    })
  if (others.length > 0) {
    console.log(`\n  Other backends: ${others.join(", ")}`)
    console.log("  Install all: bunx termless install --all")
  }
}

export function registerInstallCommand(program: Command): void {
  program
    .command("install [names...]")
    .description("Install backends (default backends if none specified)")
    .option("--all", "Install all backends")
    .action((names: string[], opts: { all?: boolean }) => {
      const manifest = loadManifest()
      const pm = detectPackageManager()
      const all = backendNames()

      // Determine which backends to install
      let toInstall: string[]
      if (opts.all) {
        toInstall = all
      } else if (names.length > 0) {
        // Validate names
        for (const name of names) {
          if (!manifest.backends[name]) {
            console.error(`\u2717 Unknown backend: ${name}`)
            console.error(`  Available: ${all.join(", ")}`)
            process.exitCode = 1
            return
          }
        }
        toInstall = names
      } else {
        toInstall = defaultBackendNames()
      }

      console.log(`\ntermless install (${pm})\n`)

      // Partition into already-installed, skipped (wrong platform), and installable
      const toRun: string[] = []
      const platform = process.platform

      for (const name of toInstall) {
        const entry = manifest.backends[name]

        // Check if already installed
        if (isBackendInstalled(name)) {
          const ver = getInstalledVersion(entry.package)
          console.log(`  \u2713 ${name} already installed (${ver ?? "unknown"})`)
          continue
        }

        // Check platform restrictions
        if (entry.platforms && !entry.platforms.includes(platform)) {
          console.log(`  \u2717 ${name} — not available on ${platform} (requires: ${entry.platforms.join(", ")})`)
          continue
        }

        // Warn about native build requirements
        if (entry.requiresBuild) {
          console.log(`  ! ${name} — requires: ${entry.requiresBuild}`)
        }

        toRun.push(name)
      }

      if (toRun.length === 0) {
        console.log("\n  Nothing to install.")
        showOtherBackends(toInstall)
        console.log("")
        return
      }

      // Build and run the install command
      const cmd = getInstallCommand(toRun, pm)
      console.log(`\n  Running: ${cmd}\n`)

      try {
        execSync(cmd, { stdio: "inherit" })
        console.log(`\n  \u2713 Installed: ${toRun.join(", ")}`)
        showOtherBackends(toInstall)
        console.log("")
      } catch {
        console.log(`\n  \u2717 Install failed. Run manually:\n  ${cmd}\n`)
        process.exitCode = 1
      }
    })
}

export function registerUpgradeCommand(program: Command): void {
  program
    .command("upgrade [names...]")
    .description("Upgrade installed backends to manifest versions")
    .action((names: string[]) => {
      const manifest = loadManifest()
      const pm = detectPackageManager()

      // Determine which backends to check
      let toCheck: string[]
      if (names.length > 0) {
        const all = backendNames()
        for (const name of names) {
          if (!manifest.backends[name]) {
            console.error(`\u2717 Unknown backend: ${name}`)
            console.error(`  Available: ${all.join(", ")}`)
            process.exitCode = 1
            return
          }
        }
        toCheck = names.filter(isBackendInstalled)
        const notInstalled = names.filter((n) => !isBackendInstalled(n))
        for (const name of notInstalled) {
          console.error(`  \u2717 ${name} is not installed (use \`termless install ${name}\` first)`)
        }
      } else {
        toCheck = backendNames().filter(isBackendInstalled)
      }

      console.log(`\ntermless upgrade (${pm})\n`)

      // Check which need upgrading
      const toUpgrade: string[] = []

      for (const name of toCheck) {
        const entry = manifest.backends[name]
        const installed = getInstalledVersion(entry.package)
        const target = manifest.version

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
      const cmd = getInstallCommand(toUpgrade, pm)
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
