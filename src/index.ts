export type {
  Cell,
  CellView,
  CursorState,
  CursorStyle,
  KeyDescriptor,
  MouseEvent,
  RegionView,
  RGB,
  RowView,
  ScrollbackState,
  SpawnOptions,
  SvgScreenshotOptions,
  SvgTheme,
  Terminal,
  TerminalBackend,
  TerminalCapabilities,
  TerminalCreateOptions,
  TerminalMode,
  TerminalOptions,
  TerminalReadable,
  TextPosition,
  UnderlineStyle,
} from "./types.ts"

export { hasExtension } from "./types.ts"
export { createTerminal } from "./terminal.ts"
export { screenshotSvg } from "./svg.ts"
export { parseKey, keyToAnsi } from "./key-mapping.ts"
export { createCellView, createRegionView, createRowView } from "./views.ts"
