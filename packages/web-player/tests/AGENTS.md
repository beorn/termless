# @termless/web-player Tests

**Layer 1 -- Browser playback**: Compile `.cast` / `.tape` sources into a browser-safe timeline, then drive an embeddable terminal sink.

## What to Test Here

- Source detection and parsing for asciicast v2 (`.cast`) and VHS-style `.tape`.
- Timeline semantics: dimensions, event timestamps, output/input/marker events, hidden setup commands.
- Playback controller behavior with fake sinks: reset, resize, write order, seek, pause/resume/stop.

## What NOT to Test Here

- xterm.js renderer internals -- upstream owns DOM rendering.
- Termless terminal backend conformance -- root `tests/` and backend package tests own that.
- Real shell execution for `.tape` -- browser playback is replay/echo, not PTY execution.

## Ad-Hoc Testing

```bash
bunx --bun vitest run --config vitest.config.ts packages/web-player/tests/
```
