import type {
  CompiledPlayback,
  PlaybackController,
  PlaybackControllerOptions,
  PlaybackEvent,
  PlaybackRunOptions,
  PlaybackSink,
  PlaybackState,
  PlaybackStatus,
} from "./types.ts"

export function createPlaybackController(
  playback: CompiledPlayback,
  sink: PlaybackSink,
  options: PlaybackControllerOptions = {},
): PlaybackController {
  let status: PlaybackStatus = "idle"
  let currentTimeMs = 0
  let runId = 0
  const isStopped = (): boolean => status === "stopped"

  const state = (): PlaybackState => ({
    status,
    currentTimeMs,
    durationMs: playback.durationMs,
  })

  const stop = (): void => {
    runId++
    status = "stopped"
  }

  const pause = (): void => {
    if (status === "playing") {
      status = "paused"
    }
  }

  const resume = (): void => {
    if (status === "paused") {
      status = "playing"
    }
  }

  const dispose = (): void => {
    stop()
  }

  const play = async (runOptions: PlaybackRunOptions = {}): Promise<void> => {
    const thisRun = ++runId
    const speed = runOptions.speed ?? 1
    const instant = speed === 0 || !Number.isFinite(speed)
    const startAtMs = runOptions.startAtMs ?? 0
    const shouldReset = runOptions.reset ?? true

    status = "playing"
    currentTimeMs = startAtMs

    if (shouldReset) {
      await sink.reset?.()
      await sink.resize?.(playback.cols, playback.rows)
    }

    let previousAt = startAtMs
    for (const event of playback.events) {
      if (event.at < startAtMs) continue
      if (thisRun !== runId || isStopped()) return

      const delayMs = instant ? 0 : Math.max(0, (event.at - previousAt) / speed)
      if (delayMs > 0) {
        await waitForPlaybackDelay(
          delayMs,
          () => thisRun === runId && !isStopped(),
          () => status === "paused",
        )
      }
      if (thisRun !== runId || isStopped()) return

      await dispatchEvent(event, sink, options)
      currentTimeMs = event.at
      previousAt = event.at
    }

    if (thisRun === runId) {
      currentTimeMs = playback.durationMs
      status = "ended"
    }
  }

  const seek = async (timeMs: number): Promise<void> => {
    const boundedTime = Math.max(0, Math.min(timeMs, playback.durationMs))
    runId++
    status = "idle"
    currentTimeMs = boundedTime
    await sink.reset?.()
    await sink.resize?.(playback.cols, playback.rows)
    for (const event of playback.events) {
      if (event.at > boundedTime) break
      await dispatchEvent(event, sink, options, { emitCallbacks: false })
    }
  }

  return {
    play,
    pause,
    resume,
    stop,
    seek,
    state,
    dispose,
  }
}

async function dispatchEvent(
  event: PlaybackEvent,
  sink: PlaybackSink,
  options: PlaybackControllerOptions,
  dispatchOptions: { emitCallbacks?: boolean } = {},
): Promise<void> {
  const emitCallbacks = dispatchOptions.emitCallbacks ?? true
  if (emitCallbacks) {
    options.onEvent?.(event)
  }
  switch (event.type) {
    case "resize":
      await sink.resize?.(event.cols, event.rows)
      break
    case "output":
      await sink.write(event.data)
      break
    case "input":
      if (emitCallbacks) {
        options.onInput?.(event)
      }
      break
    case "marker":
      if (emitCallbacks) {
        options.onMarker?.(event)
      }
      break
    case "visibility":
      break
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPlaybackDelay(
  ms: number,
  isActive: () => boolean,
  isPaused: () => boolean,
): Promise<void> {
  let remaining = ms
  let lastTick = Date.now()
  while (remaining > 0 && isActive()) {
    if (isPaused()) {
      await delay(16)
      lastTick = Date.now()
      continue
    }

    await delay(Math.min(16, remaining))
    const now = Date.now()
    remaining -= now - lastTick
    lastTick = now
  }
}
