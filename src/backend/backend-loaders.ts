/**
 * The literal loader for every backend that backends.json names (27837, @cto 26cf4eaa).
 *
 * A variable `import(pkg)` hides the target from every consumer module graph, so the km-daemon closure digest could
 * not follow it and the whole `vendor/termless` root read as a named limit. One literal `import("@termless/<name>")`
 * per entry lets the bundler trace each backend AND everything that backend imports (native bindings, @xterm and the
 * rest). This map must stay the same set as the `package` values in backends.json; tests/backend-loaders.test.ts
 * asserts it, so a backend added to one but not the other fails.
 *
 * The cost is accepted: a change to any termless backend now restarts km dependents, which is correct under static
 * reachability because the resident may load any backend that backends.json names.
 */
export const backendLoaders = {
  "@termless/xtermjs": () => import("@termless/xtermjs"),
  "@termless/ghostty": () => import("@termless/ghostty"),
  "@termless/vt100": () => import("@termless/vt100"),
  "@termless/vt220": () => import("@termless/vt220"),
  "@termless/vterm": () => import("@termless/vterm"),
  "@termless/alacritty": () => import("@termless/alacritty"),
  "@termless/wezterm": () => import("@termless/wezterm"),
  "@termless/peekaboo": () => import("@termless/peekaboo"),
  "@termless/vt100-rust": () => import("@termless/vt100-rust"),
  "@termless/libvterm": () => import("@termless/libvterm"),
  "@termless/ghostty-native": () => import("@termless/ghostty-native"),
  "@termless/kitty": () => import("@termless/kitty"),
} as const satisfies Record<string, () => Promise<unknown>>

/** The backend package names the loader map holds. */
export type BackendPackage = keyof typeof backendLoaders
