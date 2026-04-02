/**
 * `termless doctor` -- comprehensive health check of all backends.
 *
 * For each backend: checks install status, and for installed ones,
 * runs a health check (resolve -> init -> feed -> getText -> destroy).
 * Reports capabilities and overall summary.
 */

import React from "react"
import { Box, Text } from "silvery"
import type { Command } from "@silvery/commander"
import {
  manifest as getManifest,
  backends,
  entry,
  isReady,
  backend,
  getInstalledVersion,
} from "../../../src/backends.ts"
import { printComponent } from "./render.tsx"
import { Header, StatusLine, Summary } from "./ui.tsx"

// =============================================================================
// Components
// =============================================================================

function DoctorResult({
  name,
  installed,
  healthy,
  version,
  upstream,
  capabilities,
  error,
}: {
  name: string
  installed: boolean
  healthy?: boolean
  version?: string
  upstream: string
  capabilities?: string
  error?: string
}): React.ReactElement {
  if (!installed) {
    return (
      <StatusLine icon="─" variant="muted">
        <Box width={13}>
          <Text>{name}</Text>
        </Box>
        <Text>not installed</Text>
      </StatusLine>
    )
  }

  const verStr = version ?? "unknown"

  if (healthy) {
    return (
      <Box flexDirection="column">
        <StatusLine icon="✓" variant="success">
          <Box width={13}>
            <Text>{name}</Text>
          </Box>
          <Box width={8}>
            <Text>{verStr}</Text>
          </Box>
          <Text>{upstream}</Text>
        </StatusLine>
        {capabilities && (
          <Box marginLeft={4}>
            <Text color="$muted">
              {"→"} {capabilities}
            </Text>
          </Box>
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <StatusLine icon="✗" variant="error">
        <Box width={13}>
          <Text>{name}</Text>
        </Box>
        <Box width={8}>
          <Text>{verStr}</Text>
        </Box>
        <Text>{upstream}</Text>
      </StatusLine>
      {error && (
        <Box marginLeft={4}>
          <Text color="$error">
            {"→"} Error: {error}
          </Text>
        </Box>
      )}
    </Box>
  )
}

function DoctorSummary({
  healthy,
  unhealthy,
  notInstalled,
}: {
  healthy: number
  unhealthy: number
  notInstalled: number
}): React.ReactElement {
  let message: string
  if (unhealthy === 0 && healthy > 0) {
    message = "All installed backends are healthy."
  } else if (unhealthy > 0) {
    message = "Some backends are unhealthy. Run `termless backends install` to reinstall."
  } else {
    message = "No backends installed. Run `termless backends install` to get started."
  }

  return (
    <Box flexDirection="column">
      <Summary>
        {healthy} healthy, {unhealthy} unhealthy, {notInstalled} not installed
      </Summary>
      <Box>
        <Text color="$muted">{message}</Text>
      </Box>
    </Box>
  )
}

// =============================================================================
// Command registration
// =============================================================================

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check health of all backends")
    .action(async () => {
      const m = getManifest()
      const allNames = backends()

      await printComponent(
        <Box flexDirection="column">
          <Header title="termless doctor" version={m.version} />
          <Text color="$muted">Checking backends...</Text>
        </Box>,
      )

      let healthy = 0
      let unhealthy = 0
      let notInstalled = 0

      for (const name of allNames) {
        const e = entry(name)!
        const upstreamStr = e.upstream
          ? `${e.upstream}${e.version ? ` ${e.version}` : ""}`
          : e.type === "os"
            ? "(OS automation)"
            : "(built-in)"

        if (!isReady(name)) {
          await printComponent(<DoctorResult name={name} installed={false} upstream={upstreamStr} />)
          notInstalled++
          continue
        }

        // Run health check
        try {
          const b = await backend(name)
          b.init({ cols: 80, rows: 24 })
          b.feed(new TextEncoder().encode("Hello"))
          const ok = b.getText().includes("Hello")
          const caps = b.capabilities
          b.destroy()

          const capsStr = `${caps.name} (truecolor: ${caps.truecolor}, kitty: ${caps.kittyKeyboard})`
          const ver = getInstalledVersion(e.package)

          await printComponent(
            <DoctorResult
              name={name}
              installed={true}
              healthy={ok}
              version={ver ?? undefined}
              upstream={upstreamStr}
              capabilities={capsStr}
            />,
          )

          if (ok) healthy++
          else unhealthy++
        } catch (err) {
          await printComponent(
            <DoctorResult
              name={name}
              installed={true}
              healthy={false}
              version={getInstalledVersion(e.package) ?? undefined}
              upstream={upstreamStr}
              error={err instanceof Error ? err.message : String(err)}
            />,
          )
          unhealthy++
        }
      }

      await printComponent(<DoctorSummary healthy={healthy} unhealthy={unhealthy} notInstalled={notInstalled} />)

      if (unhealthy > 0) {
        process.exitCode = 1
      }
    })
}
