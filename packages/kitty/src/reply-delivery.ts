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
// Re-audited for OSC 52 (#32091): Window.clipboard_control runs kitty's own ClipboardRequestManager; an OSC 52 write
// commits to kitty's Clipboard held in process memory (no GLFW) and writes no child bytes. The headless window's one
// non-default option is clipboard_control read-clipboard/read-primary (kitty's default asks a human), reported in
// getClipboardState().control, so a read answers through kitty's own legacy OSC 52 encoder. A prompt kitty still
// raises (boss.confirm/choose) is answered with nothing and reported as a PERMISSION_PROMPT warning, replay-checked.
// This declaration excludes itself; determining adapter edits require re-audit.
// Re-audited for raw command-mark snapshots: callback recording adds no child replies or host lifecycle.
// Re-audited for chronological retained-buffer snapshots: negative CPU-cell coordinates and borrowed HistoryBuf Lines
// change cell/text enumeration only. Alternate snapshots exclude primary history. Response draining, replay ordering,
// Window callbacks, clipboard permissions and private command-mark recording below the cell loop remain unchanged.
// Re-audited for public command-end projection: the existing cached snapshot supplies copied raw entries; retaining
// that cache while dirty permits prefix validation. Command replay, response draining and the native bridge are unchanged.
// Re-audited for the native colour-preference mode property in the existing snapshot map.
// Command replay, native reply collection and callback delivery are unchanged.
// Re-audited for live native reverse/synchronized modes and the header-derived layout/receipt.
// Per-mode metadata errors preserve generic snapshots; command-end status remains an uncoerced string.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/kitty/src/index.ts",
      blobOid: "3f207f911646613cdc3d8b04f155f0686a96a077",
    },
    {
      path: "packages/kitty/src/backend.ts",
      blobOid: "1b7367a9737d1292618ea34a1c451bf3273c3b35",
    },
    {
      path: "packages/kitty/build/bridge.py",
      blobOid: "f9585e3ac10209eedd1bc8550bcb1a4a1b286f27",
    },
    {
      path: "packages/kitty/build/layout.c",
      blobOid: "49c0beef4424190e89d2884eac5efe4da50e3630",
    },
    {
      path: "packages/kitty/build/native-mode-layout.json",
      blobOid: "6bd0f2d5b6936f8f6298e4cb9ae4b228172a9502",
    },
    {
      path: "packages/kitty/build/native-mode-layout.receipt.json",
      blobOid: "b4c699ca3b37c928ffde1e98ebbd3fa885f6bbe8",
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
