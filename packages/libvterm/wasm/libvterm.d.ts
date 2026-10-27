/** Generated Emscripten factory; the caller validates the returned module. */
export default function createLibvtermModule(options?: {
  locateFile?: (name: string, scriptDirectory: string) => string
}): Promise<{
  _termless_vterm_screen_observe_props(screen: number, record: number): void
}>
