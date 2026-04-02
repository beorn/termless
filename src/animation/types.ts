/** A single frame in a terminal animation. */
export interface AnimationFrame {
  /** SVG string of this frame (from screenshotSvg). */
  svg: string
  /** Duration this frame should display, in milliseconds. */
  duration: number
}

/** Options for animation encoding. */
export interface AnimationOptions {
  /** Loop count (0 = infinite, default: 0). */
  loop?: number
  /** Default frame duration in ms if not specified per-frame (default: 100). */
  defaultDuration?: number
}

/** Supported animation output formats. */
export type AnimationFormat = "svg" | "gif" | "apng"
