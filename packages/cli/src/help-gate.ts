/**
 * The bare-`record` **help gate** — plain ANSI / stdin variant.
 *
 * Replaces the prior silvery-rendered help gate. The silvery version called
 * `render(...).run()`, which destroys `process.stdin` on unmount — making
 * every subsequent stdin keystroke invisible to the recording loop. The
 * recorded shell sees no input, the user can't even type `exit`.
 *
 * This implementation writes the help prose directly to stderr and reads a
 * single Enter from stdin in raw mode, with a hand-rolled listener that is
 * removed before returning. Stdin is left non-destroyed so the recording
 * loop can re-enter raw mode and forward bytes to the PTY child.
 */

interface HelpGateProps {
  shell: string
  cols: number
  rows: number
  outputs: readonly string[]
}

function faint(text: string): string {
  return `\x1b[2m${text}\x1b[22m`
}

function primary(text: string): string {
  return `\x1b[36m${text}\x1b[39m`
}

function success(text: string): string {
  return `\x1b[32m${text}\x1b[39m`
}

function bold(text: string): string {
  return `\x1b[1m${text}\x1b[22m`
}

/**
 * Render the help gate and resolve once the user presses Enter.
 *
 * Writes the help text to stderr (never stdout — that channel may be
 * redirected to a .tape file). Sets stdin to raw mode while waiting, then
 * restores it. Never calls `stdin.destroy()`.
 */
export async function runHelpGate(props: HelpGateProps): Promise<void> {
  const { shell, cols, rows, outputs } = props
  const outputLabel = outputs.length === 0 ? "stdout (.tape)" : outputs.length === 1 ? outputs[0]! : outputs.join(", ")

  const lines = [
    "",
    bold("● Record a terminal session"),
    "",
    `A live ${primary(shell)} will be spawned at ${primary(`${cols}×${rows}`)} and recorded.`,
    faint("Everything you do in that shell is captured — frame by frame."),
    "",
    `To stop: type ${primary("exit")} or press ${primary("Ctrl+D")}.`,
    faint(`On exit, the recording is written to ${outputLabel}.`),
    "",
    success("Press Enter to start recording…"),
    "",
  ]
  process.stderr.write(lines.join("\n") + "\n")

  return new Promise<void>((resolve) => {
    const stdin = process.stdin
    const wasRaw = stdin.isRaw === true
    let resolved = false

    const onData = (chunk: Buffer): void => {
      if (resolved) return
      // Enter is \r (0x0d) or \n (0x0a) depending on terminal mode.
      for (let i = 0; i < chunk.length; i++) {
        const b = chunk[i]!
        if (b === 0x0d || b === 0x0a) {
          resolved = true
          cleanup()
          // Echo a newline so subsequent prose starts on a fresh row.
          process.stderr.write("\n")
          resolve()
          return
        }
        if (b === 0x03 /* Ctrl-C */) {
          resolved = true
          cleanup()
          process.exit(130)
        }
      }
    }

    function cleanup(): void {
      stdin.removeListener("data", onData)
      if (stdin.isTTY && !wasRaw) {
        try {
          stdin.setRawMode(false)
        } catch {
          // Ignored — best-effort restore.
        }
      }
      stdin.pause()
    }

    if (stdin.isTTY) {
      try {
        stdin.setRawMode(true)
      } catch {
        // Non-TTY environments fall through to the data listener below.
      }
    }
    stdin.resume()
    stdin.on("data", onData)
  })
}
