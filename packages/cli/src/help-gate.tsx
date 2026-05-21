/**
 * The bare-`record` **help gate**.
 *
 * `termless record` with no command would otherwise spawn a live `$SHELL` and
 * record idle frames with nothing telling the user how to stop. The help gate
 * fixes that: before any recording starts, it prints a short silvery-rendered
 * panel — what's about to be recorded, that it spawns a live `$SHELL`, how to
 * stop it — and waits for **Enter**. Only on Enter does recording begin.
 *
 * The help is **pre-flight UI on the real terminal — never part of the
 * recording.** It is rendered the silvery way (`render(<HelpGate/>, …, { mode:
 * "inline" })` with `<Box>` / `<Heading>` / `<Muted>` + `$token` colors), not
 * raw ANSI / `console.log`; it adapts to theme and `NO_COLOR`.
 */

import React from "react"
import { render, Box, Text, Heading, Muted, useApp, useInput } from "silvery"

/** Props for {@link HelpGate}. */
export interface HelpGateProps {
  /** The shell that will be spawned and recorded (e.g. `/bin/zsh`). */
  shell: string
  /** Terminal columns the recording will use. */
  cols: number
  /** Terminal rows the recording will use. */
  rows: number
  /** Output target paths the recording will write on exit. */
  outputs: readonly string[]
}

/**
 * The help-gate panel. Renders the pre-flight explanation and resolves the
 * silvery app (via `useApp().exit()`) when the user presses Enter.
 */
export function HelpGate({ shell, cols, rows, outputs }: HelpGateProps): React.ReactElement {
  const { exit } = useApp()
  useInput((_input, key) => {
    if (key.return) exit()
  })
  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Heading>● Record a terminal session</Heading>
      <Box flexDirection="column" marginTop={1}>
        <Text>
          A live <Text color="$primary">{shell}</Text> will be spawned at{" "}
          <Text color="$primary">
            {cols}×{rows}
          </Text>{" "}
          and recorded.
        </Text>
        <Muted>Everything you do in that shell is captured — frame by frame.</Muted>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text>
          To stop: type <Text color="$primary">exit</Text> or press <Text color="$primary">Ctrl+D</Text>.
        </Text>
        <Muted>On exit, the recording is written to {outputs.length === 1 ? outputs[0] : outputs.join(", ")}.</Muted>
      </Box>
      <Box marginTop={1}>
        <Text color="$success">Press Enter to start recording…</Text>
      </Box>
    </Box>
  )
}

/**
 * Render the help gate and wait for the user to press Enter.
 *
 * Resolves once Enter is pressed; the panel is unmounted before resolving so
 * the recording starts on a clean terminal — the help text is never part of
 * the recording (frame 0 is the fresh shell).
 *
 * @returns A promise that resolves when the user confirms.
 */
export async function runHelpGate(props: HelpGateProps): Promise<void> {
  const instance = render(<HelpGate {...props} />, undefined, { mode: "inline" })
  await instance.waitUntilExit()
  instance.unmount()
}
