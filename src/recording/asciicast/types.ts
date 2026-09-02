/**
 * asciicast v2 format types.
 *
 * The asciicast v2 format is a JSON-lines format used by asciinema for
 * recording and sharing terminal sessions. First line is a header object,
 * subsequent lines are event tuples.
 *
 * @see https://docs.asciinema.org/manual/asciicast/v2/
 */

/** Header object — first line of an asciicast v2 file. */
export interface AsciicastHeader {
  version: 2
  width: number
  height: number
  timestamp?: number
  duration?: number
  title?: string
  env?: Record<string, string>
  theme?: AsciicastTheme
}

/** Terminal color theme embedded in the header. */
export interface AsciicastTheme {
  fg?: string
  bg?: string
  /** Colon-separated list of 16 ANSI palette colors. */
  palette?: string
}

/**
 * Event type discriminator: `"o"` output, `"i"` input, `"m"` marker, `"r"`
 * resize (unterm phase A3 — `data` is `"COLSxROWS"`, e.g. `"100x30"`).
 */
export type AsciicastEventType = "o" | "i" | "m" | "r"

/** A single event in an asciicast recording. */
export interface AsciicastEvent {
  /** Time in seconds (float) relative to recording start. */
  time: number
  /** Event type: "o" = output, "i" = input, "m" = marker, "r" = resize. */
  type: AsciicastEventType
  /** Event data: output/input bytes, a marker label, or "COLSxROWS" for a resize. */
  data: string
}

/** A complete asciicast v2 recording (header + events). */
export interface AsciicastRecording {
  header: AsciicastHeader
  events: AsciicastEvent[]
}
