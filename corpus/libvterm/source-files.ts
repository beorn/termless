// Single source of truth for which libvterm `t/*.test` files this corpus
// extracts from. Shared by extract.ts (reads them from a local directory) and
// fetch.ts (fetches them from upstream at the pinned ref).
//
// Selection: ALL 43 `.test` files upstream. Unlike the ghostty suite there is
// no per-file judgement call here — libvterm's `t/` directory contains
// nothing but conformance cases, and which ones survive conversion is decided
// per CASE by extract.ts (and reported in COVERAGE.md), not per file. A file
// that contributes zero cases is still listed, because its rejection reasons
// are the coverage signal.
//
// `harness.c` and `run-test.pl` are deliberately absent: they are the upstream
// C/Perl runner, not cases. The attribute-letter vocabulary that extract.ts
// decodes (`B`, `U<n>`, `I`, `R`, `K`, `F<n>`, `S`, `^`, `_`) is defined by
// harness.c's cell printer, cited at extract.ts's ATTR_MAP.

export const SOURCE_FILES = [
  "02parser.test",
  "03encoding_utf8.test",
  "10state_putglyph.test",
  "11state_movecursor.test",
  "12state_scroll.test",
  "13state_edit.test",
  "14state_encoding.test",
  "15state_mode.test",
  "16state_resize.test",
  "17state_mouse.test",
  "18state_termprops.test",
  "20state_wrapping.test",
  "21state_tabstops.test",
  "22state_save.test",
  "25state_input.test",
  "26state_query.test",
  "27state_reset.test",
  "28state_dbl_wh.test",
  "29state_fallback.test",
  "30state_pen.test",
  "31state_rep.test",
  "32state_flow.test",
  "40state_selection.test",
  "60screen_ascii.test",
  "61screen_unicode.test",
  "62screen_damage.test",
  "63screen_resize.test",
  "64screen_pen.test",
  "65screen_protect.test",
  "66screen_extent.test",
  "67screen_dbl_wh.test",
  "68screen_termprops.test",
  "69screen_pushline.test",
  "69screen_reflow.test",
  "90vttest_01-movement-1.test",
  "90vttest_01-movement-2.test",
  "90vttest_01-movement-3.test",
  "90vttest_01-movement-4.test",
  "90vttest_02-screen-1.test",
  "90vttest_02-screen-2.test",
  "90vttest_02-screen-3.test",
  "90vttest_02-screen-4.test",
  "92lp1640917.test",
] as const
