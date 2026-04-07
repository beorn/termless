/**
 * `termless backend` — manage terminal emulator backends.
 *
 * Subcommands:
 * - `list` — list all backends and their install status
 * - `install` — install or upgrade backends
 * - `update` — check upstream registries for newer versions
 *
 * @example
 * ```bash
 * termless backendslist
 * termless backendsinstall ghostty vterm
 * termless backendsinstall --all
 * termless backendsupdate
 * termless backendsupdate --apply
 * ```
 */

import React from "react"
import { Box, Text, Table, type TableColumn } from "silvery"
import type { Command } from "@silvery/commander"
import { execSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
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
import { Header, StatusLine, Summary, BackendsTable, type BackendRow } from "./ui.tsx"

// =============================================================================
// Shared helpers
// =============================================================================

function buildBackendRows(): { rows: BackendRow[]; version: string } {
  const m = getManifest()
  const allNames = backends()
  const defaultNames = new Set(allNames.filter((name) => entry(name)?.default))

  const rows: BackendRow[] = allNames.map((name) => {
    const e = entry(name)!
    const installed = isReady(name)

    let upstream: string
    if (!e.upstream) {
      upstream = e.type === "os" ? "(OS automation)" : "(built-in)"
    } else {
      const ver = e.version ? ` ${e.version}` : ""
      upstream = `${e.upstream}${ver}`
    }

    return {
      name,
      isDefault: defaultNames.has(name),
      installed,
      installedVersion: installed ? getInstalledVersion(e.package) : null,
      upstream,
      type: e.type,
    }
  })

  return { rows, version: m.version }
}

async function printBackendsTable(): Promise<void> {
  const { rows, version } = buildBackendRows()
  const installedCount = rows.filter((r) => r.installed).length
  const totalCount = rows.length
  const defaultCount = rows.filter((r) => r.isDefault).length

  await printComponent(
    <Box flexDirection="column">
      <Header title="termless" version={version} />
      <BackendsTable rows={rows} />
      <Summary>
        {installedCount} of {totalCount} installed ({defaultCount} default, marked *)
      </Summary>
      {installedCount < totalCount && (
        <Box>
          <Text color="$muted"> bunx termless backendsinstall {"<name>"}</Text>
        </Box>
      )}
      <Box>
        <Text color="$muted"> https://termless.dev/guide/backends</Text>
      </Box>
    </Box>,
  )
}

// =============================================================================
// Install components
// =============================================================================

function InstallHeader({ pm }: { pm: string }): React.ReactElement {
  return <Header title={`termless install (${pm})`} />
}

function StatusLines({
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
// Install action
// =============================================================================

async function installAction(names: string[], opts: { all?: boolean }): Promise<void> {
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
          <Box flexDirection="column">
            <StatusLine icon="✗" variant="error">
              Unknown backend: {name}
            </StatusLine>
            <Box marginLeft={2}>
              <Text color="$muted">Available: {allNames.join(", ")}</Text>
            </Box>
          </Box>,
        )
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
        icon: "✓",
        variant: "success",
        text: `${name} already installed (${e.upstream ?? name} ${upstreamVer})`,
      })
      continue
    }

    if (e.platforms && !e.platforms.includes(platform)) {
      statusLines.push({
        icon: "✗",
        variant: "error",
        text: `${name} — not available on ${platform} (requires: ${e.platforms.join(", ")})`,
      })
      continue
    }

    toRun.push(name)
  }

  if (statusLines.length > 0) {
    await printComponent(<StatusLines lines={statusLines} />)
  }

  if (toRun.length === 0) {
    // Nothing to npm-install, but check if anything needs building
    const needsBuild = toInstall.filter((n) => !isReady(n))
    if (needsBuild.length > 0) {
      for (const name of needsBuild) {
        try {
          buildBackend(name)
          if (isReady(name)) {
            statusLines.push({ icon: "✓", variant: "success", text: `${name} built` })
          } else {
            statusLines.push({
              icon: "✗",
              variant: "warning",
              text: `${name} build incomplete — not yet available`,
            })
          }
        } catch (e) {
          statusLines.push({
            icon: "✗",
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
    await printComponent(<ResultMessage icon="✓" variant="success" text={`Installed: ${toRun.join(", ")}`} />)
  } catch {
    await printComponent(<ResultMessage icon="✗" variant="error" text={`Install failed. Run manually:\n  ${cmd}`} />)
    process.exitCode = 1
  }

  // Show full backends table at the end
  await printComponent(<Box marginTop={1} />)
  await printBackendsTable()
}

// =============================================================================
// Update action — check upstream registries for newer versions
// =============================================================================

async function checkNpmVersion(pkg: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`)
    if (!res.ok) return null
    const data = (await res.json()) as { version?: string }
    return data.version ?? null
  } catch {
    return null
  }
}

async function checkCrateVersion(crate: string): Promise<string | null> {
  try {
    const res = await fetch(`https://crates.io/api/v1/crates/${crate}`, {
      headers: { "User-Agent": "termless-cli (https://github.com/beorn/termless)" },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { crate?: { max_version?: string } }
    return data.crate?.max_version ?? null
  } catch {
    return null
  }
}

async function checkGithubVersion(repo: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`)
    if (!res.ok) {
      // Try tags if no releases
      const tagRes = await fetch(`https://api.github.com/repos/${repo}/tags?per_page=1`)
      if (!tagRes.ok) return null
      const tags = (await tagRes.json()) as Array<{ name?: string }>
      return tags[0]?.name?.replace(/^v/, "") ?? null
    }
    const data = (await res.json()) as { tag_name?: string }
    return data.tag_name?.replace(/^v/, "") ?? null
  } catch {
    return null
  }
}

function parseUpstream(uri: string): { type: "npm" | "crate" | "github"; name: string } {
  if (uri.startsWith("npm:")) return { type: "npm", name: uri.slice(4) }
  if (uri.startsWith("crate:")) return { type: "crate", name: uri.slice(6) }
  if (uri.startsWith("github:")) return { type: "github", name: uri.slice(7) }
  throw new Error(`Unknown upstream URI: ${uri}`)
}

async function checkLatestVersion(uri: string): Promise<string | null> {
  const { type, name } = parseUpstream(uri)
  switch (type) {
    case "npm":
      return checkNpmVersion(name)
    case "crate":
      return checkCrateVersion(name)
    case "github":
      return checkGithubVersion(name)
  }
}

type UpdateRow = { backend: string; current: string; latest: string; status: string }

function UpdateTable({
  rows,
}: {
  rows: Array<{ name: string; current: string; latest: string | null; status: string }>
}): React.ReactElement {
  const columns: TableColumn<UpdateRow>[] = [
    { header: "Backend", key: "backend" },
    { header: "Current", key: "current" },
    { header: "Latest", key: "latest" },
    { header: "Status", key: "status" },
  ]

  const data: UpdateRow[] = rows.map((r) => ({
    backend: r.name,
    current: r.current || "-",
    latest: r.latest ?? "?",
    status: r.status,
  }))

  return <Table columns={columns} data={data} />
}

async function updateAction(opts: { apply?: boolean }): Promise<void> {
  const m = getManifest()
  const allNames = backends()

  await printComponent(
    <Box flexDirection="column">
      <Header title="termless update" version={m.version} />
      <Text color="$muted">Checking upstream versions...</Text>
    </Box>,
  )

  // Fetch all versions in parallel
  type Row = {
    name: string
    upstream: string
    current: string
    latest: string | null
    status: string
  }

  const rows: Row[] = await Promise.all(
    allNames.map(async (name) => {
      const e = entry(name)!
      const upstream = e.upstream ?? ""
      const current = e.version ?? ""

      if (!upstream) {
        return { name, upstream: "", current, latest: null, status: "no upstream" }
      }

      const latest = await checkLatestVersion(upstream)

      let status: string
      if (latest === null) {
        status = "? fetch failed"
      } else if (latest === current) {
        status = "✓ up to date"
      } else {
        status = "⬆ update available"
      }

      return { name, upstream, current, latest, status }
    }),
  )

  await printComponent(<UpdateTable rows={rows} />)

  // Count updates
  const updatable = rows.filter((r) => r.latest !== null && r.latest !== r.current)

  if (updatable.length === 0) {
    await printComponent(<Summary>All backends up to date.</Summary>)
  } else {
    await printComponent(
      <Box flexDirection="column">
        <Summary>
          {updatable.length} update{updatable.length === 1 ? "" : "s"} available.
        </Summary>
      </Box>,
    )

    if (opts.apply) {
      // Read the raw backends.json, update versions, write back
      const __dirname = dirname(fileURLToPath(import.meta.url))
      const manifestPath = join(__dirname, "..", "..", "..", "backends.json")
      const raw = JSON.parse(readFileSync(manifestPath, "utf-8")) as any

      for (const r of updatable) {
        if (raw.backends[r.name]) {
          raw.backends[r.name].upstreamVersion = r.latest
        }
      }

      writeFileSync(manifestPath, JSON.stringify(raw, null, 2) + "\n", "utf-8")
      await printComponent(
        <StatusLine icon="✓" variant="success">
          Updated backends.json.
        </StatusLine>,
      )
    } else {
      await printComponent(
        <Box>
          <Text color="$muted">Run with --apply to update backends.json.</Text>
        </Box>,
      )
    }
  }
}

// =============================================================================
// Command registration
// =============================================================================

export function registerBackendCommand(program: Command): void {
  const cmd = program.command("backends").description("Manage terminal emulator backends")

  cmd.addHelpSection("Examples:", [
    ["$ termless backends", "List all backends + install status"],
    ["$ termless backends install", "Install default backends"],
    ["$ termless backends install ghostty alacritty", "Install specific backends"],
    ["$ termless backends install --all", "Install all 11 backends"],
    ["$ termless backends update", "Check upstream for newer versions"],
    ["$ termless backends update --apply", "Update backends.json with latest"],
  ])

  // Default action: show list + usage hint
  cmd.action(async () => {
    await printBackendsTable()
    await printComponent(
      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Box width={42}>
            <Text color="$muted">termless backends install [names...]</Text>
          </Box>
          <Text color="$muted">Install or upgrade backends</Text>
        </Box>
        <Box>
          <Box width={42}>
            <Text color="$muted">{"termless backends update [--apply]"}</Text>
          </Box>
          <Text color="$muted">Check upstream for newer versions</Text>
        </Box>
        <Box>
          <Box width={42}>
            <Text color="$muted">termless backends --help</Text>
          </Box>
          <Text color="$muted">Full help</Text>
        </Box>
      </Box>,
    )
  })

  cmd
    .command("list")
    .description("List all backends and their install status")
    .action(async () => {
      await printBackendsTable()
    })

  cmd
    .command("install")
    .argument("[names...]", "Backend names to install")
    .description("Install or upgrade backends")
    .option("--all", "Install all backends")
    .actionMerged(async (opts: { names: string[]; all?: boolean }) => {
      await installAction(opts.names, opts)
    })

  cmd
    .command("update")
    .description("Check upstream registries for newer versions")
    .option("--apply", "Update backends.json with latest versions")
    .action(updateAction)
}
