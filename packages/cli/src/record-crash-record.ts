/**
 * The process crash record for the live `termless record` overlay (ADR-0031 decision 3, hh #31167): the process entry's one crash
 * handler writes the FATAL record, lets silvery record and restore the pane, flushes within a bound and exits 1.
 *
 * Version-tolerant on purpose. A silvery with `recordAppCrash` registers no process listener of its own and needs
 * loggily's `installCrashHandler`; the silvery this repository's own install pins still owns its listeners, so it gets
 * nothing here. The module types below compile against both. The tolerance goes when this repository's pins carry
 * both functions (hh #35075). Dynamic imports only: the overlay path loads silvery anyway.
 */
type Restore = (error: Error) => void
interface SilveryRuntimeCrashRecord {
  readonly recordAppCrash?: Restore
}
interface LoggilyCrashHandler {
  readonly createLogger: (name: string) => unknown
  readonly installCrashHandler?: (options: { logger: never; restore: Restore }) => Disposable
}

/** Install the crash handler for one overlay lifetime; dispose it when the recording has ended. */
export async function installRecordCrashRecord(): Promise<Disposable | undefined> {
  const [silveryRuntime, loggily]: [SilveryRuntimeCrashRecord, LoggilyCrashHandler] = await Promise.all([
    import("silvery/runtime"),
    import("loggily"),
  ])
  const restore = silveryRuntime.recordAppCrash
  // silent-fallback-allow: a silvery without recordAppCrash still owns its own crash listeners, so its record is kept.
  if (restore === undefined) return undefined
  if (loggily.installCrashHandler === undefined) {
    throw new Error(
      "termless record: this silvery leaves process crashes to the entry (recordAppCrash), but this loggily has no " +
        "installCrashHandler; a crash would lose its record. Install loggily with installCrashHandler (0.14.0 or later).",
    )
  }
  return loggily.installCrashHandler({ logger: loggily.createLogger("termless:record") as never, restore })
}
