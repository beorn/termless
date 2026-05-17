---
title: Web Player
description: Embed .cast and .tape terminal playback in browser docs with @termless/web-player and xterm.js.
---

# Web Player

`@termless/web-player` mounts an xterm.js terminal in the browser and replays termless recordings:

- `.cast` files replay recorded terminal output exactly.
- `.tape` files replay a browser-safe input timeline with local echo. Use `.cast` when visitors need to see exact command output, or wire `onInput` to a live backend if the page should drive a remote process.

## Install

```bash
bun add @termless/web-player
```

Import xterm.js CSS once in the page or app:

```typescript
import "@xterm/xterm/css/xterm.css"
```

## Embed a Cast

```typescript
import "@xterm/xterm/css/xterm.css"
import { createTermlessPlayer } from "@termless/web-player/browser"

const source = await fetch("/demos/km.cast").then((response) => response.text())
const player = createTermlessPlayer(document.querySelector("#terminal")!, source, {
  filename: "km.cast",
})

await player.play()
```

## Add Controls

The player returns a small controller API:

```typescript
play.onclick = () => player.play()
pause.onclick = () => player.pause()
resume.onclick = () => player.resume()
restart.onclick = () => player.play({ startAtMs: 0, reset: true })
seek.oninput = () => player.seek(Number(seek.value))
```

Use `player.state()` to read `{ status, currentTimeMs, durationMs }`.

## Embed a Tape

```typescript
import { createTermlessPlayer } from "@termless/web-player/browser"

const tape = await fetch("/demos/km.tape").then((response) => response.text())
const player = createTermlessPlayer(document.querySelector("#terminal")!, tape, {
  filename: "km.tape",
  defaultTypingSpeed: 30,
})
```

For `.tape`, `Type`, key commands, `Sleep`, `Hide`, `Show`, `Set Width`, and `Set Height` become playback events. `Source` and `Require` are reported as warnings because browser playback has no filesystem or shell.

## Timeline API

For custom renderers, compile first and provide your own terminal sink:

```typescript
import { compilePlaybackSource, createPlaybackController } from "@termless/web-player"

const playback = compilePlaybackSource(source, { filename: "demo.cast" })
const controller = createPlaybackController(playback, {
  reset: () => term.reset(),
  resize: (cols, rows) => term.resize(cols, rows),
  write: (data) => term.write(data),
})

await controller.play({ speed: 2 })
```

The compiled timeline is plain data, so docs sites can pre-load, inspect, or transform recordings before mounting the terminal.
