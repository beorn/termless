/**
 * `termless install` and `termless upgrade` -- manage backend packages.
 *
 * Install detects the package manager and runs the appropriate install command.
 * Upgrade checks installed versions against the manifest and updates as needed.
 */

import React from "react"
import { Box, Text } from "silvery"
import type { Command } from "commander"
import { execSync } from "node:child_process"
import {
  manifest as getManifest,
  backends,
  entry,
  isReady,
  getInstalledVersion,
  detectPackageManager,
  buildBackend,
} from "../../../src/backends.ts"
import { printComponent } from "./render.tsx"
import { Header, StatusLine } from "./ui.tsx"
import { printBackendsTable } from "./backends-cmd.tsx"

// =============================================================================
// Components
// =============================================================================

function InstallHeader({ pm }: { pm: string }): React.ReactElement {
  return <Header title={`termless install (${pm})`} />
}

function InstallResults({
  lines,
}: {
  lines: Array<{ icon: string; variant: "success" | "error" | "warning" | "muted"; text: string }>
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <StatusLine key={i} icon={line.icon} variant={line.variant}>
          {line.text}
        </StatusLine>
      ))}
    </Box>
  )
}

function UpgradeHeader({ pm }: { pm: string }): React.ReactElement {
  return <Header title={`termless upgrade (${pm})`} />
}

function UpgradeResults({
  lines,
}: {
  lines: Array<{ icon: string; variant: "success" | "error" | "warning" | "muted"; text: string }>
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <StatusLine key={i} icon={line.icon} variant={line.variant}>
          {line.text}
        </StatusLine>
      ))}
    </Box>
  )
}

function RunningCommand({ cmd }: { cmd: string }): React.ReactElement {
  return (
    <Box marginTop={1}>
      <Text color="$muted">Running: {cmd}</Text>
    </Box>
  )
}

function ResultMessage({
  icon,
  variant,
  text,
}: {
  icon: string
  variant: "success" | "error"
  text: string
}): React.ReactElement {
  return (
    <Box marginTop={1}>
      <StatusLine icon={icon} variant={variant}>
        {text}
      </StatusLine>
    </Box>
  )
}

// =============================================================================
// Install command
// =============================================================================

export function registerInstallCommand(program: Command): void {
  program
    .command("install [names...]")
    .description("Install backends (default backends if none specified)")
    .option("--all", "Install all backends")
    .action(async (names: string[], opts: { all?: boolean }) => {
      const m = getManifest()
      const pm = detectPackageManager()
      const allNames = backends()
      const defaultNames = allNames.filter((name) => entry(name)?.default)

      // Determine which backends to install
      let toInstall: string[]
      if (opts.all) {
        toInstall = allNames
      } else if (names.length > 0) {
        for (const name of names) {
          if (!m.backends[name]) {
            await printComponent(
              <StatusLine icon="\u2717" variant="error">
                Unknown backend: {name}
              </StatusLine>,
            )
            console.log(`  Available: ${allNames.join(", ")}`)
            process.exitCode = 1
            return
          }
        }
        toInstall = names
      } else {
        toInstall = defaultNames
      }

      await printComponent(<InstallHeader pm={pm} />)

      const toRun: string[] = []
      const platform = process.platform
      const statusLines: Array<{ icon: string; variant: "success" | "error" | "warning" | "muted"; text: string }> = []

      for (const name of toInstall) {
        const e = entry(name)!

        if (isReady(name)) {
          const upstreamVer = e.version ?? "latest"
          statusLines.push({
            icon: "\u2713",
            variant: "success",
            text: `${name} already installed (${e.upstream ?? name} ${upstreamVer})`,
          })
          continue
        }

        if (e.platforms && !e.platforms.includes(platform)) {
          statusLines.push({
            icon: "\u2717",
            variant: "error",
            text: `${name} \u2014 not available on ${platform} (requires: ${e.platforms.join(", ")})`,
          })
          continue
        }

        toRun.push(name)
      }

      if (statusLines.length > 0) {
        await printComponent(<InstallResults lines={statusLines} />)
      }

      if (toRun.length === 0) {
        // Nothing to npm-install, but check if anything needs building
        const needsBuild = toInstall.filter((n) => !isReady(n))
        if (needsBuild.length > 0) {
          for (const name of needsBuild) {
            try {
              buildBackend(name)
              statusLines.push({ icon: "\u2713", variant: "success", text: `${name} built` })
            } catch (e) {
              statusLines.push({
                icon: "\u2717",
                variant: "error",
                text: `${name} build failed: ${e instanceof Error ? e.message : e}`,
              })
            }
          }
        }
        await printBackendsTable()
        return
      }

      // Install npm packages
      const pkgs = toRun.map((n) => `${entry(n)!.package}@${m.version}`).join(" ")
      const cmd = `${pm} ${pm === "npm" ? "install -D" : "add -D"} ${pkgs}`
      await printComponent(<RunningCommand cmd={cmd} />)

      try {
        execSync(cmd, { stdio: "inherit" })
        await printComponent(<ResultMessage icon="\u2713" variant="success" text={`Installed: ${toRun.join(", ")}`} />)
      } catch {
        await printComponent(
          <ResultMessage icon="\u2717" variant="error" text={`Install failed. Run manually:\n  ${cmd}`} />,
        )
        process.exitCode = 1
      }

      // Show full backends table at the end
      console.log("")
      await printBackendsTable()
    })
}

// =============================================================================
// Upgrade command
// =============================================================================

export function registerUpgradeCommand(program: Command): void {
  program
    .command("upgrade [names...]")
    .description("Upgrade installed backends to manifest versions")
    .action(async (names: string[]) => {
      const m = getManifest()
      const pm = detectPackageManager()
      const allNames = backends()

      let toCheck: string[]
      if (names.length > 0) {
        for (const name of names) {
          if (!m.backends[name]) {
            await printComponent(
              <StatusLine icon="\u2717" variant="error">
                Unknown backend: {name}
              </StatusLine>,
            )
            console.log(`  Available: ${allNames.join(", ")}`)
            process.exitCode = 1
            return
          }
        }
        toCheck = names.filter(isReady)
        const notInstalled = names.filter((n) => !isReady(n))
        for (const name of notInstalled) {
          await printComponent(
            <StatusLine icon="\u2717" variant="error">
              {name} is not installed (use `termless install {name}` first)
            </StatusLine>,
          )
        }
      } else {
        toCheck = allNames.filter(isReady)
      }

      await printComponent(<UpgradeHeader pm={pm} />)

      const toUpgrade: string[] = []
      const statusLines: Array<{ icon: string; variant: "success" | "error" | "warning" | "muted"; text: string }> = []

      for (const name of toCheck) {
        const e = entry(name)!
        const installed = getInstalledVersion(e.package)
        const target = m.version

        if (installed === target) {
          statusLines.push({ icon: "\u2713", variant: "success", text: `${name} ${installed} (up to date)` })
        } else {
          statusLines.push({
            icon: "\u2191",
            variant: "warning",
            text: `${name} ${installed ?? "unknown"} \u2192 ${target}`,
          })
          toUpgrade.push(name)
        }
      }

      if (statusLines.length > 0) {
        await printComponent(<UpgradeResults lines={statusLines} />)
      }

      if (toUpgrade.length === 0) {
        console.log("\n  All backends up to date.\n")
        return
      }

      const pkgs = toUpgrade.map((n) => `${entry(n)!.package}@${m.version}`).join(" ")
      const cmd = `${pm} ${pm === "npm" ? "install -D" : "add -D"} ${pkgs}`
      await printComponent(<RunningCommand cmd={cmd} />)

      try {
        execSync(cmd, { stdio: "inherit" })
        await printComponent(
          <ResultMessage icon="\u2713" variant="success" text={`Upgraded: ${toUpgrade.join(", ")}`} />,
        )
      } catch {
        await printComponent(
          <ResultMessage icon="\u2717" variant="error" text={`Upgrade failed. Run manually:\n  ${cmd}`} />,
        )
        process.exitCode = 1
      }
    })
}
