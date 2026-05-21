---
title: MCP Reference
description: The Termless MCP server — terminal-session tools for AI agents, mapped to the record / view recording-domain verbs.
---

# MCP Reference

`termless mcp` starts a stdio MCP server that lets an AI agent (Claude Code,
etc.) drive terminal sessions. The tools map onto the same
[recording-domain verbs](../concepts/overview#the-four-verbs) the CLI uses — an
agent **records** a session, then **views** it.

```bash
$ termless mcp
```

## Claude Code integration

Add to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "termless": {
      "command": "bunx",
      "args": ["termless", "mcp"]
    }
  }
}
```

## Session tools

A session is a live [Terminal](../concepts/terminal) — a backend plus a PTY. The
agent opens one with `start`, drives it, and closes it with `stop`.

| Tool    | Maps to    | Does                                                            |
| ------- | ---------- | --------------------------------------------------------------- |
| `start` | record     | Open a live terminal session; optionally record it (`trace`)    |
| `stop`  | record     | Close a session; finalize the recording if one was started      |
| `list`  | —          | List active sessions                                            |
| `press` | —          | Press a keyboard key (Playwright key format)                    |
| `type`  | —          | Type text into the terminal                                     |
| `text`  | —          | Read the terminal's current text                                |
| `wait`  | —          | Wait for a text pattern or for the terminal to settle           |

### `start`

Opens a live terminal session — a [Terminal](../concepts/terminal) backed by a
PTY and a [Backend](../concepts/backend). The default backend is `xtermjs`; pass
`backend: "ghostty"` for visual-faithful screenshots.

Pass a `trace` directory to also **record** the session into a
[Recording](../concepts/recording): every buffer mutation is captured as a
debounced PNG plus a JSONL frame in the recording's
[frames projection](../concepts/recording#the-three-tracks). Read the captured
frames with the `trace` tool; finalize the recording with `stop`.

```ts
mcp__tty__start({
  command: ["bun", "km", "view", "~/Vault"],
  cols: 140,
  rows: 40,
  trace: { dir: "/tmp/trace-15290/", debounceMs: 16 },
})
```

### `stop`

Closes a session and kills its process. If the session was being recorded, the
recording is finalized first and its summary is returned.

## View tools

| Tool         | Maps to | Does                                                        |
| ------------ | ------- | ----------------------------------------------------------- |
| `screenshot` | view    | View the live terminal as a single-frame image (PNG / SVG)  |
| `trace`      | view    | View the frames recorded for a session                      |

### `screenshot`

Renders the session's current buffer to a high-fidelity image — a single-frame
**view** of the live terminal. PNG by default via the auto-picker (backend-native
renderer → `@termless/ghostty` native canvas → resvg fallback); a `.svg` output
path or `format: "svg"` produces vector output. No Chromium dependency.

For terminal-specific compat checks ("does it look right in Ghostty with my
theme?"), open the session with `start({ backend: "peekaboo" })` — the peekaboo
backend screenshots the user's real desktop terminal app. The headless canvas
renderer (the default) is faster and cross-platform for routine iteration.

### `trace`

Views the [frames](../concepts/recording#the-three-tracks) recorded for a
session — returns the frames captured since a given sequence number from the
in-memory ring buffer. The cursor does not auto-advance; the caller passes the
seq of the last frame it saw. Requires the session to have been opened as a
recording via `start({ trace: { ... } })`.

```ts
mcp__tty__trace({ sessionId, since: 0 }) // poll live frames
```

## See Also

- [CLI Reference](./cli) -- the `termless` command-line surface.
- [Tracing Visual Bugs](../guide/tracing-visual-bugs) -- the frames projection workflow.
- [Concepts Overview](../concepts/overview) -- the verbs the tools map to.
