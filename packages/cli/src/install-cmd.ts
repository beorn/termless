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

      console.error(`\ntermless install (${pm})\n`)

      // Partition into already-installed, skipped (wrong platform), and installable
      const toRun: string[] = []
      const platform = process.platform

      for (const name of toInstall) {
        const entry = manifest.backends[name]

        // Check if already installed
        if (isBackendInstalled(name)) {
          const ver = getInstalledVersion(entry.package)
          console.error(`  \u2713 ${name} already installed (${ver ?? "unknown"})`)
          continue
        }

        // Check platform restrictions
        if (entry.platforms && !entry.platforms.includes(platform)) {
          console.error(`  \u2717 ${name} — not available on ${platform} (requires: ${entry.platforms.join(", ")})`)
          continue
        }

        // Warn about native build requirements
        if (entry.requiresBuild) {
          console.error(`  ! ${name} — requires: ${entry.requiresBuild}`)
        }

        toRun.push(name)
      }

      if (toRun.length === 0) {
        console.error("\n  Nothing to install.\n")
        return
      }

      // Build and run the install command
      const cmd = getInstallCommand(toRun, pm)
      console.error(`\n  Running: ${cmd}\n`)

      try {
        execSync(cmd, { stdio: "inherit" })
        console.error(`\n  \u2713 Installed: ${toRun.join(", ")}\n`)
      } catch {
        console.error(`\n  \u2717 Install failed. Run manually:\n  ${cmd}\n`)
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

      console.error(`\ntermless upgrade (${pm})\n`)

      // Check which need upgrading
      const toUpgrade: string[] = []

      for (const name of toCheck) {
        const entry = manifest.backends[name]
        const installed = getInstalledVersion(entry.package)
        const target = manifest.version

        if (installed === target) {
          console.error(`  \u2713 ${name} ${installed} (up to date)`)
        } else {
          console.error(`  \u2191 ${name} ${installed ?? "unknown"} \u2192 ${target}`)
          toUpgrade.push(name)
        }
      }

      if (toUpgrade.length === 0) {
        console.error("\n  All backends up to date.\n")
        return
      }

      // Build and run the install command (install with version pins upgrades)
      const cmd = getInstallCommand(toUpgrade, pm)
      console.error(`\n  Running: ${cmd}\n`)

      try {
        execSync(cmd, { stdio: "inherit" })
        console.error(`\n  \u2713 Upgraded: ${toUpgrade.join(", ")}\n`)
      } catch {
        console.error(`\n  \u2717 Upgrade failed. Run manually:\n  ${cmd}\n`)
        process.exitCode = 1
      }
    })
}
