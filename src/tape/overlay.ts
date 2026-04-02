/**
 * Keystroke overlay for SVG screenshots.
 *
 * Renders a translucent badge with the current keystroke/shortcut
 * in a corner of the SVG frame — like KeyCastr for terminal recordings.
 */

// =============================================================================
// Types
// =============================================================================

export interface KeyOverlayOptions {
  /** Position of the overlay badge */
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left"
  /** Font size for the key label */
  fontSize?: number
  /** Padding inside the badge */
  padding?: number
  /** Background opacity (0-1) */
  opacity?: number
}

// =============================================================================
// SVG dimension parsing
// =============================================================================

/**
 * Extract width and height from an SVG string's root element attributes.
 */
function parseSvgDimensions(svg: string): { width: number; height: number } {
  const widthMatch = svg.match(/\bwidth="(\d+(?:\.\d+)?)"/)
  const heightMatch = svg.match(/\bheight="(\d+(?:\.\d+)?)"/)
  return {
    width: widthMatch ? Number.parseFloat(widthMatch[1]!) : 672,
    height: heightMatch ? Number.parseFloat(heightMatch[1]!) : 432,
  }
}

// =============================================================================
// XML escaping
// =============================================================================

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

// =============================================================================
// Overlay renderer
// =============================================================================

/**
 * Overlay a keystroke badge on an SVG screenshot.
 *
 * Parses the SVG dimensions, inserts a rounded-rect badge with the key label
 * before the closing `</svg>` tag.
 *
 * @param svg - The SVG string to overlay on
 * @param keystroke - Human-readable keystroke (e.g., "Ctrl+C", "Enter", "j")
 * @param options - Positioning and styling options
 * @returns The modified SVG string with the badge
 */
export function overlayKeystroke(svg: string, keystroke: string, options?: KeyOverlayOptions): string {
  if (!keystroke) return svg

  const position = options?.position ?? "bottom-right"
  const fontSize = options?.fontSize ?? 14
  const padding = options?.padding ?? 8
  const opacity = options?.opacity ?? 0.75

  const { width, height } = parseSvgDimensions(svg)

  // Approximate text width based on character count and font size
  const charWidth = fontSize * 0.62
  const textWidth = keystroke.length * charWidth
  const badgeWidth = textWidth + padding * 2
  const badgeHeight = fontSize + padding * 2
  const borderRadius = 6
  const margin = 10

  // Position the badge
  let x: number
  let y: number

  switch (position) {
    case "bottom-right":
      x = width - badgeWidth - margin
      y = height - badgeHeight - margin
      break
    case "bottom-left":
      x = margin
      y = height - badgeHeight - margin
      break
    case "top-right":
      x = width - badgeWidth - margin
      y = margin
      break
    case "top-left":
      x = margin
      y = margin
      break
  }

  // Center text within badge
  const textX = x + padding
  const textY = y + padding + fontSize * 0.82 // baseline offset

  const badge = [
    `<g class="key-overlay">`,
    `<rect x="${x}" y="${y}" width="${badgeWidth}" height="${badgeHeight}" rx="${borderRadius}" ry="${borderRadius}" fill="rgba(0,0,0,${opacity})"/>`,
    `<text x="${textX}" y="${textY}" font-family="'Menlo', 'Monaco', 'Courier New', monospace" font-size="${fontSize}" fill="#ffffff">${escapeXml(keystroke)}</text>`,
    `</g>`,
  ].join("\n")

  // Insert before closing </svg>
  return svg.replace("</svg>", `${badge}\n</svg>`)
}
