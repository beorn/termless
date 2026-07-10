// Single source of truth for which ghostty src/terminal/*.zig files this
// corpus extracts from. Shared by extract.ts (reads them from a local
// checkout) and fetch.ts (fetches them from upstream `main`).
//
// Selection: every src/terminal/*.zig file that (a) has at least one
// `test "..." { ... }` block upstream and (b) exercises terminal-emulation
// *behavior* rather than generic infrastructure.
//
// Deliberately excluded despite having tests: hash_map.zig (generic hash map
// unit tests) and bitmap_allocator.zig (generic allocator unit tests) -
// neither tests anything a JS terminal emulator would need to replicate.
//
// Deliberately excluded because they have zero `test "..."` blocks upstream
// (verified by census at extraction time, 2026-07-08): ansi.zig,
// charsets.zig, csi.zig, cursor.zig, highlight.zig, hyperlink.zig, kitty.zig,
// lib.zig, main.zig, osc.zig, parse_table.zig, point.zig, ref_counted_set.zig,
// search.zig, selection_codepoints.zig, sys.zig, tmux.zig. Subdirectories
// (apc/, c/, kitty/, osc/, res/, search/, tmux/) hold non-.zig or
// implementation-detail files and were not surveyed - re-run the census
// (`gh api repos/ghostty-org/ghostty/contents/src/terminal --jq '.[].name'`
// plus a per-file `grep -c '^test "'`) periodically to catch new files.
export const SOURCE_FILES = [
  "Terminal.zig",
  "Screen.zig",
  "PageList.zig",
  "page.zig",
  "stream.zig",
  "stream_terminal.zig",
  "Parser.zig",
  "Selection.zig",
  "SelectionGesture.zig",
  "ScreenSet.zig",
  "formatter.zig",
  "style.zig",
  "sgr.zig",
  "modes.zig",
  "color.zig",
  "apc.zig",
  "dcs.zig",
  "device_attributes.zig",
  "device_status.zig",
  "size.zig",
  "size_report.zig",
  "focus.zig",
  "mouse.zig",
  "render.zig",
  "Tabstops.zig",
  "UTF8Decoder.zig",
  "StringMap.zig",
  "x11_color.zig",
] as const
