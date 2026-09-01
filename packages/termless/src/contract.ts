/**
 * `termless/contract` — the Terminal read contract, TerminalBackend, and
 * region view types. No engine: everything here is shape, not an
 * implementation of any particular terminal emulator. A backend package
 * (`@termless/vterm`, `@termless/xtermjs`, …) implements {@link TerminalBackend};
 * anything folding a snapshot or a recording moment into a {@link Terminal}
 * targets this contract.
 *
 * Backend-arity rule: this subpath never imports a concrete engine. If you
 * never import `termless/backends`, you never have more than one engine.
 */

export type {
  Cell,
  CellView,
  Color,
  Cursor,
  CursorStyle,
  EmulatorWarning,
  KeyDescriptor,
  Region,
  RawOutput,
  Row,
  ScreenshotOptions,
  ScrollbackState,
  Terminal,
  TerminalBackend,
  TerminalCapabilities,
  TerminalMode,
  TerminalOptions,
  UnderlineStyle,
  WarningExtension,
} from "@termless/core"

export { hasExtension } from "@termless/core"

// Region view factories — build Region/Row views over any object shaped like
// a Terminal (a live backend, a snapshot fold, a recording moment — the
// contract doesn't care which).
export { createCellView, createRegion, createRow } from "@termless/core"

// Emulator warning registry — the side channel backends optionally implement
// (see WarningExtension) instead of console.log/warn.
export { pushWarning, drainWarnings, hasWarnings, clearWarnings } from "@termless/core"
