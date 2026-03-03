/**
 * Vitest snapshot serializer for terminal SVG screenshots.
 *
 * Renders terminal buffer as an SVG string suitable for visual regression
 * testing. Complements the text-based terminalSerializer with pixel-perfect
 * visual snapshots.
 *
 * Register with vitest:
 *   import { svgTerminalSerializer } from "@termless/test"
 *   expect.addSnapshotSerializer(svgTerminalSerializer)
 */

import type { TerminalReadable, SvgScreenshotOptions } from "../../../src/types.ts"
import { screenshotSvg } from "../../../src/svg.ts"

// =============================================================================
// Snapshot Marker
// =============================================================================

/** Marker interface for objects that should be serialized as SVG terminal snapshots. */
export interface SvgTerminalSnapshotMarker {
	__svgTerminalSnapshot: true
	terminal: TerminalReadable
	name?: string
	options?: SvgScreenshotOptions
}

/** Wrap a TerminalReadable for SVG snapshot serialization. */
export function svgTerminalSnapshot(
	terminal: TerminalReadable,
	options?: SvgScreenshotOptions & { name?: string },
): SvgTerminalSnapshotMarker {
	const { name, ...svgOptions } = options ?? {}
	return {
		__svgTerminalSnapshot: true,
		terminal,
		name,
		options: Object.keys(svgOptions).length > 0 ? svgOptions : undefined,
	}
}

// =============================================================================
// Serializer
// =============================================================================

export const svgTerminalSerializer = {
	/** Returns true if the value is an SVG terminal snapshot marker. */
	test(val: unknown): boolean {
		return (
			val !== null &&
			typeof val === "object" &&
			"__svgTerminalSnapshot" in (val as Record<string, unknown>) &&
			(val as Record<string, unknown>).__svgTerminalSnapshot === true
		)
	},

	/** Serialize a terminal state as an SVG screenshot. */
	serialize(val: SvgTerminalSnapshotMarker): string {
		const svg = screenshotSvg(val.terminal, val.options)
		if (val.name) {
			return `<!-- ${val.name} -->\n${svg}`
		}
		return svg
	},
}
