/**
 * Portable process execution helpers for peekaboo.
 *
 * Abstracts over Bun.spawn() / Bun.file() vs Node.js child_process / fs,
 * keeping peekaboo's OS automation code runtime-agnostic.
 */

import { createRequire } from "node:module"

const isBun = typeof globalThis.Bun !== "undefined"

export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Execute a command and wait for it to finish.
 * Returns exit code, stdout, and stderr.
 */
export async function exec(
  argv: string[],
  options?: { stdout?: "pipe" | "ignore"; stderr?: "pipe" | "ignore" },
): Promise<ExecResult> {
  const stdoutMode = options?.stdout ?? "ignore"
  const stderrMode = options?.stderr ?? "ignore"

  if (isBun) {
    return execBun(argv, stdoutMode, stderrMode)
  }
  return execNode(argv, stdoutMode, stderrMode)
}

/**
 * Execute a command fire-and-forget style (don't wait for exit).
 * Returns the process PID and an exited promise.
 */
export function execDetached(argv: string[]): { pid: number; exited: Promise<number> } {
  if (isBun) {
    return execDetachedBun(argv)
  }
  return execDetachedNode(argv)
}

/**
 * Read a file as a Buffer.
 */
export async function readFileAsBuffer(path: string): Promise<Buffer> {
  if (isBun) {
    return readFileBun(path)
  }
  return readFileNode(path)
}

// ── Bun implementations ──

async function execBun(
  argv: string[],
  stdoutMode: "pipe" | "ignore",
  stderrMode: "pipe" | "ignore",
): Promise<ExecResult> {
  const proc = Bun.spawn(argv, {
    stdout: stdoutMode,
    stderr: stderrMode,
  })

  const stdout = stdoutMode === "pipe" ? await new Response(proc.stdout).text() : ""
  const stderr = stderrMode === "pipe" ? await new Response(proc.stderr).text() : ""
  const exitCode = await proc.exited

  return { exitCode, stdout, stderr }
}

function execDetachedBun(argv: string[]): { pid: number; exited: Promise<number> } {
  const proc = Bun.spawn(argv, {
    stdout: "ignore",
    stderr: "ignore",
  })
  return { pid: proc.pid, exited: proc.exited }
}

async function readFileBun(path: string): Promise<Buffer> {
  const file = Bun.file(path)
  return Buffer.from(await file.arrayBuffer())
}

// ── Node.js implementations ──

async function execNode(
  argv: string[],
  stdoutMode: "pipe" | "ignore",
  stderrMode: "pipe" | "ignore",
): Promise<ExecResult> {
  const { spawn } = await import("node:child_process")

  return new Promise<ExecResult>((resolve, reject) => {
    const [cmd, ...args] = argv
    const child = spawn(cmd, args, {
      stdio: ["ignore", stdoutMode, stderrMode],
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk))
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk))
    }

    child.on("error", reject)
    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
      })
    })
  })
}

function execDetachedNode(argv: string[]): { pid: number; exited: Promise<number> } {
  // Use createRequire for synchronous access to child_process
  const nodeRequire = createRequire(import.meta.url)
  const { spawn } = nodeRequire("node:child_process") as typeof import("node:child_process")

  const [cmd, ...args] = argv
  const child = spawn(cmd, args, {
    stdio: ["ignore", "ignore", "ignore"],
    detached: false,
  })

  const exited = new Promise<number>((resolve) => {
    child.on("close", (code) => resolve(code ?? 1))
    child.on("error", () => resolve(1))
  })

  return { pid: child.pid ?? 0, exited }
}

async function readFileNode(path: string): Promise<Buffer> {
  const { readFile } = await import("node:fs/promises")
  return readFile(path)
}
