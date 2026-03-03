export type {
  Cell,
  CursorState,
  CursorStyle,
  KeyDescriptor,
  MouseEvent,
  RGB,
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
