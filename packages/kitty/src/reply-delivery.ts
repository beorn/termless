import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited batch replay -> snapshot responses -> onResponse path: every fed byte is replayed through kitty's own VT parser
// inside `kitty +runpy` (build/bridge.py); each reply kitty's Screen writes through Callbacks.write, kitty's own DA1
// (on_da1 -> da1(get_options())) and colour reports included, returns base64 in the replay snapshot, and ensureSnapshot
// forwards the new bytes to onResponse by the next getCursor, refusing a replay that changes an earlier reply
// (src/backend.ts). A Window callback the bridge does not reproduce is drained as an UNREPRODUCED_CALLBACK warning, never
// answered; one that raises fails the feed. Bound to the kitty 0.49.2 official launcher's sha256.
// This declaration excludes itself; determining adapter edits require re-audit.
export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  boundary: "feed-and-getCursor",
  adapterSources: [
    { path: "packages/kitty/src/index.ts", blobOid: "3f207f911646613cdc3d8b04f155f0686a96a077" },
    { path: "packages/kitty/src/backend.ts", blobOid: "3dadab79f60b19509875513a35f07407c53e4419" },
    { path: "packages/kitty/build/bridge.py", blobOid: "fa5689a1db08de60578231a4bd0476b82ba16b1a" },
  ],
  engine: {
    kind: "native",
    sha256: "c490c7d98fbf5a9acbcff14b8153cb5beae2f3df47ae30211119116a25ac9bbc",
  },
}
