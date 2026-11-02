import type { MouseEvent } from "./types.ts"

/** Engine state supplied by the binding; tracking and wire encoding are independent. */
export interface MouseEncodingState {
  tracking: 0 | 9 | 1000 | 1002 | 1003
  encoding: "legacy" | "utf8" | "sgr" | "urxvt" | "sgr-pixel"
}

/** Encode a mouse event, or return null when its tracking protocol reports nothing. */
export function encodeMouseReport(event: MouseEvent, state: MouseEncodingState): Uint8Array | null {
  if (state.tracking === 0) return null
  if (state.tracking === 9 && event.action !== "press") return null
  if (event.action === "move" && (state.tracking === 1000 || (state.tracking === 1002 && event.button === "none"))) {
    return null
  }
  const sgr = state.encoding === "sgr" || state.encoding === "sgr-pixel"
  let x = event.x + 1
  let y = event.y + 1
  if (state.encoding === "sgr-pixel") {
    const pixel = event.pixel
    if (pixel === undefined) throw new Error("mouse encoding unavailable: SGR-pixel needs pixel coordinates")
    if (
      !Number.isSafeInteger(pixel?.x) ||
      !Number.isSafeInteger(pixel?.y) ||
      pixel.x < 0 ||
      pixel.y < 0 ||
      pixel.x >= Number.MAX_SAFE_INTEGER ||
      pixel.y >= Number.MAX_SAFE_INTEGER
    ) {
      throw new TypeError("pixel mouse coordinates must be nonnegative integers below Number.MAX_SAFE_INTEGER")
    }
    x = pixel.x + 1
    y = pixel.y + 1
  }
  const buttons = { left: 0, middle: 1, right: 2, none: 3, wheelUp: 64, wheelDown: 65 } as const
  let button = buttons[event.button]
  if (event.action === "release" && !sgr) button = 3
  if (event.action === "move") button |= 32
  if (state.tracking !== 9) {
    if (event.shift) button |= 4
    if (event.alt) button |= 8
    if (event.ctrl) button |= 16
  }
  if (sgr) {
    return new TextEncoder().encode(`\x1b[<${button};${x};${y}${event.action === "release" ? "m" : "M"}`)
  }
  if (state.encoding === "urxvt") return new TextEncoder().encode(`\x1b[${button + 32};${x};${y}M`)
  if (state.encoding === "utf8") {
    return new TextEncoder().encode(`\x1b[M${String.fromCodePoint(button + 32, x + 32, y + 32)}`)
  }
  return new Uint8Array([27, 91, 77, button + 32, Math.min(x + 32, 255), Math.min(y + 32, 255)])
}
