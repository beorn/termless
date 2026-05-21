/**
 * Registry subpath — discovery, resolution, health checks.
 * Import from "termless/backends" for these advanced APIs.
 */
export {
  backend,
  backends,
  isReady,
  entry,
  manifest,
  buildBackend,
  createTerminalByName,
  getInstalledVersion,
  detectPackageManager,
} from "./backends.ts"
export type { BackendEntry, Manifest, ResolveOptions } from "./backends.ts"
