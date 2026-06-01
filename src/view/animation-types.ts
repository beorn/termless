import type { TerminalReadable } from "../terminal/types.ts"

export interface FrameLayerOffset {
  x: number
  y: number
}

export interface CellsFrameLayer {
  kind: "cells"
  snapshot: TerminalReadable
  offset?: FrameLayerOffset
  fallbackSvg?: string
}

export interface SvgFrameLayer {
  kind: "svg"
  svg: string
  offset?: FrameLayerOffset
}

export interface ChromeFrameLayer {
  kind: "chrome"
  svg: string
  offset?: FrameLayerOffset
}

export interface DecorationFrameLayer {
  kind: "decoration"
  svg: string
  offset?: FrameLayerOffset
}

export type FrameLayer = CellsFrameLayer | SvgFrameLayer | ChromeFrameLayer | DecorationFrameLayer

/** A single frame in a terminal animation. */
export interface AnimationFrame {
  /** SVG string of this frame (from screenshotSvg). */
  svg: string
  /**
   * Frozen cell-grid snapshot of this frame. Present when captured by the
   * `record` verb; lets a cell-native renderer (swash) rasterize the frame
   * directly instead of round-tripping through `svg`.
   */
  snapshot?: TerminalReadable
  /**
   * Renderer-agnostic visual layers ordered bottom-up. When omitted, the
   * legacy `{svg, snapshot}` shape is projected into layers by the encoder.
   */
  layers?: readonly FrameLayer[]
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
