import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited batch replay -> snapshot responses -> onResponse path: every fed byte is replayed through kitty's own VT parser
// inside `kitty +runpy` (build/bridge.py); each reply kitty's Screen writes through Callbacks.write, kitty's own DA1
// (on_da1 -> da1(get_options())) and colour reports included, returns base64 in the replay snapshot, and ensureSnapshot
// forwards the new bytes to onResponse by the next getCursor, refusing a replay that changes an earlier reply
// (src/backend.ts). A Window callback the bridge does not reproduce is drained as an UNREPRODUCED_CALLBACK warning, never
// answered; one that raises fails the feed. Re-audited when the declared cell size reached Screen's constructor (init
// only), which moves no callback route. Re-audited for stored cell hyperlink metadata: CPU-cell extraction and URI
// normalization change only the snapshot's cells, preserving response/callback collection and delivery. Bound to the
// kitty 0.49.2 official launcher the hh flake builds at flake.lock
// blob 6116bd61 (/nix/store/fbpk67n6fd9kb95vl7ksrc7pkh3gx3qx-kitty-official-binary-0.49.2/bin/kitty); its bytes follow the lock.
// Re-audited for existing underlineColor forwarding: cell extraction changes no response/callback route.
// Re-audited for OSC99 capability queries: Window.desktop_notify and NotificationManager use kitty own protocol
// DesktopIntegration and Channel in the single headless window; replies reach Callbacks.write synchronously.
// Non-query notification payloads remain UNREPRODUCED_CALLBACK; no desktop integration/display is initialized.
// Re-audited for OSC 52 (#32091): Window.clipboard_control runs kitty's own ClipboardRequestManager under default
// clipboard_control; an OSC 52 write commits to kitty's Clipboard held in process memory (no GLFW) and writes no child
// bytes; a read reaches the read-clipboard-ask prompt (boss.confirm/choose), host input a human supplies: the bridge
// answers nothing and reports it as a PERMISSION_PROMPT warning, replay-checked, never as UNREPRODUCED_CALLBACK.
// This declaration excludes itself; determining adapter edits require re-audit.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/kitty/src/index.ts",
      blobOid: "3f207f911646613cdc3d8b04f155f0686a96a077",
    },
    {
      path: "packages/kitty/src/backend.ts",
      blobOid: "5418421dc2f827d7e2d17f5b816255b29499b62a",
    },
    {
      path: "packages/kitty/build/bridge.py",
      blobOid: "875c664a930dffc2ce41412fb02add06226b8751",
    },
  ],
  delivery: {
    boundary: "feed-and-getCursor",
    engine: {
      kind: "native",
      sha256: "bb65c2d57e56eecca8143d73771432cf7dd386bccd36ae658950e5923a661886",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
