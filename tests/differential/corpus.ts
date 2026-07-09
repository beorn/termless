/**
 * Byte-stream corpus for the vterm ↔ xterm engine differential.
 *
 * Each stream is a named, self-contained sequence of terminal bytes plus the
 * geometry it should be fed at. The corpus deliberately concentrates on the
 * feature surfaces where terminal emulators disagree — SGR variants, wide
 * clusters at the margin, pending-wrap, region scroll, alt-screen, OSC 8,
 * DECSCUSR, and tab stops — so that feeding the same bytes to two engines and
 * diffing the resulting cell grids yields a MEASURED divergence, not a guess.
 *
 * No stream asserts a rendering; the corpus is pure input data. The runner
 * (runner.ts) feeds it to both backends and the test (engine-differential.test.ts)
 * records the resulting per-stream divergence as a conscious baseline.
 */

/** A single named byte stream plus the geometry to feed it at. */
export interface EngineStream {
  /** Stable identifier used as the baseline key. */
  name: string
  /** Raw terminal bytes to feed to each engine. */
  bytes: Uint8Array
  /** Grid geometry both engines are initialized with. */
  size: { cols: number; rows: number }
}

const ENC = new TextEncoder()

/** Build a stream from a string body (UTF-8 encoded). */
function stream(name: string, size: { cols: number; rows: number }, body: string): EngineStream {
  return { name, bytes: ENC.encode(body), size }
}

// ESC and CSI shorthands keep the sequences readable below.
const ESC = "\x1b"
const CSI = "\x1b["
// String Terminator for OSC 8 (ESC \).
const ST = "\x1b\\"

// ═══════════════════════════════════════════════════════════════════════════
// Streams
// ═══════════════════════════════════════════════════════════════════════════

/** Plain printable ASCII across a few wrapped lines — the agreement anchor. */
const plainAscii = stream(
  "plain-ascii",
  { cols: 40, rows: 10 },
  "Hello, world!\r\nThe quick brown fox jumps over\r\nthe lazy dog 0123456789 !@#$%^&*()",
)

/**
 * A dense burst of SGR: truecolor + 256-color FG/BG, bold/faint, italic, the
 * underline-style variants (single / double / curly / dotted / dashed via
 * `4:n`), and inverse toggled on and off mid-line. Underline sub-styles and
 * faint are the usual points of disagreement.
 */
const sgrStorm = stream(
  "sgr-storm",
  { cols: 40, rows: 10 },
  [
    `${CSI}38;2;255;96;0mTRUE${CSI}48;2;0;64;128mCOLOR${CSI}0m`,
    `${CSI}38;5;196m256fg${CSI}48;5;22m256bg${CSI}0m`,
    `${CSI}1mB${CSI}22m${CSI}2mF${CSI}22m${CSI}3mI${CSI}23m`,
    `${CSI}4msingle${CSI}21mdouble${CSI}0m`,
    `${CSI}4:3mcurly${CSI}4:4mdotted${CSI}4:5mdashed${CSI}0m`,
    `pre${CSI}7minv${CSI}27moff${CSI}7minv2${CSI}0mpost`,
  ].join("\r\n"),
)

/**
 * Progress-bar style carriage-return overwrites: the same line is rewritten in
 * place five times. The final visible state should be the last frame; engines
 * that mishandle CR-without-LF leave residue from earlier frames.
 */
const crOverwrite = stream(
  "cr-overwrite",
  { cols: 40, rows: 4 },
  "Loading [    ] 0%\r" +
    "Loading [=   ] 25%\r" +
    "Loading [==  ] 50%\r" +
    "Loading [=== ] 75%\r" +
    "Loading [====] 100%",
)

/**
 * Wide clusters against the right margin plus grapheme edge cases: a CJK glyph
 * that fits exactly in the last two columns, one placed one column too far to
 * fit (wrap behavior), a ZWJ family emoji (1 cluster vs 4 wide emoji vs broken),
 * and VS16 variation-selector emoji presentation.
 */
const wideCjkEmoji = stream(
  "wide-cjk-emoji",
  { cols: 20, rows: 8 },
  `${CSI}1;19H漢` + // fits exactly in cols 19-20
    `${CSI}2;20H語` + // one column short — must wrap or clip
    `${CSI}4;1H👨‍👩‍👧‍👦` + // ZWJ family cluster
    `${CSI}6;1HA❤️B ☀️`, // VS16 emoji presentation
)

/**
 * Alt-screen round trip: paint on the primary, enter the alternate screen
 * (?1049h, which also saves cursor + clears alt), paint something else, then
 * leave (?1049l, restoring primary + cursor) and keep writing. The alt content
 * must NOT leak into the restored primary; the cursor must land where it was.
 */
const altScreenRoundtrip = stream(
  "alt-screen-roundtrip",
  { cols: 40, rows: 8 },
  `${CSI}1;1HPRIMARY-LINE-ONE\r\nPRIMARY-LINE-TWO` +
    `${CSI}?1049h` +
    `${CSI}2;2HALT-SCREEN-PAINT` +
    `${CSI}?1049l` +
    `-BACK`,
)

/**
 * DECSTBM scroll region: set the top/bottom margins to rows 2-4, fill them, and
 * drive line feeds at the bottom margin so the region scrolls while rows 1 and
 * 5+ stay pinned. Region-scroll edge handling (what enters at the bottom, what
 * stays fixed) is a classic divergence.
 */
const marginsRegionScroll = stream(
  "margins-region-scroll",
  { cols: 40, rows: 8 },
  `${CSI}2;4r` + // top margin row 2, bottom margin row 4
    `${CSI}1;1HFIXED-TOP` +
    `${CSI}2;1HregionA\r\nregionB\r\nregionC\r\nregionD\r\nregionE` + // scrolls within 2-4
    `${CSI}6;1HFIXED-BOTTOM`,
)

/**
 * Pending-wrap (deferred wrap): writing exactly to the last column leaves the
 * cursor in a "wrap pending" state rather than moving; the NEXT glyph wraps.
 * Also checks that CR cancels the pending wrap. The narrow grid forces the edge.
 */
const wrapPending = stream(
  "wrap-pending",
  { cols: 10, rows: 5 },
  "0123456789AB" + // 10 fills row 0 (pending), A wraps to row 1, B follows
    `${CSI}3;1H` +
    "abcdefghij\rZ", // fill row 3, CR cancels pending wrap, Z overwrites col 0
)

/**
 * OSC 8 hyperlinks: a run of cells carrying a hyperlink URI, bracketed by
 * plain text and a link reset. Whether the `hyperlink` cell attribute is
 * tracked at all — and how the URI is normalized — differs across engines.
 */
const osc8Links = stream(
  "osc8-links",
  { cols: 40, rows: 4 },
  `plain ${ESC}]8;;https://example.com/a${ST}LINKED${ESC}]8;;${ST} plain` +
    `\r\n${ESC}]8;id=x;https://example.com/b${ST}IDLINK${ESC}]8;;${ST}`,
)

/**
 * DECSCUSR cursor-style variants (CSI n SP q), each followed by a printable
 * letter. diffBuffers compares cells, not cursor shape, so this stream really
 * verifies that every `CSI n SP q` is CLEANLY CONSUMED — an engine that fails
 * to parse it leaks the ` q` bytes into the grid as visible residue.
 */
const cursorStyle = stream(
  "cursor-style",
  { cols: 40, rows: 4 },
  `${CSI}0 qA${CSI}1 qB${CSI}2 qC${CSI}3 qD${CSI}4 qE${CSI}5 qF${CSI}6 qG`,
)

/**
 * Tab stops: default 8-column tabs, then TBC (clear all, CSI 3 g) followed by
 * two custom stops set with HTS (ESC H) and re-driven with HT (\t). Custom
 * tab-stop tables are frequently under-implemented.
 */
const tabs = stream(
  "tabs",
  { cols: 40, rows: 4 },
  `${CSI}1;1H\tTAB8\tTAB16` + // default stops at col 8, 16
    `${CSI}2;1H${CSI}3g` + // row 2 home, clear all tab stops
    `${CSI}2;4H${ESC}H` + // set a stop at col 4
    `${CSI}2;21H${ESC}H` + // set a stop at col 21
    `${CSI}2;1H\tP\tQ`, // home, tab→col4 P, tab→col21 Q
)

/** The full ordered corpus fed to the differential. */
export const CORPUS: EngineStream[] = [
  plainAscii,
  sgrStorm,
  crOverwrite,
  wideCjkEmoji,
  altScreenRoundtrip,
  marginsRegionScroll,
  wrapPending,
  osc8Links,
  cursorStyle,
  tabs,
]
