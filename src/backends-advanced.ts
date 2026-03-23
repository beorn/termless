/**
 * Registry subpath — discovery, resolution, health checks.
 * Import from "termless/backends" for these advanced APIs.
 */
export {
  loadManifest,
  isBackendInstalled,
  getInstalledVersion,
  backendNames,
  defaultBackendNames,
  installedBackendNames,
  getBackendStatus,
  resolveBackend,
  createTerminalByName,
  resolveAllInstalled,
  checkBackendHealth,
  checkAllHealth,
  getInstallCommand,
  detectPackageManager,
  _resetManifestCache,
} from "./backends.ts"
export type { BackendManifest, BackendManifestEntry, BackendStatus, BackendHealthResult } from "./backends.ts"
