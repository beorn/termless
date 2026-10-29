import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited batch replay -> snapshot responses -> onResponse path: every fed byte is replayed through kitty's own VT parser
// inside `kitty +runpy` (build/bridge.py); each reply kitty's Screen writes through Callbacks.write, kitty's own DA1
// (on_da1 -> da1(get_options())) and colour reports included, returns base64 in the replay snapshot, and ensureSnapshot
// forwards the new bytes to onResponse by the next getCursor, refusing a replay that changes an earlier reply
// (src/backend.ts). A Window callback the bridge does not reproduce is drained as an UNREPRODUCED_CALLBACK warning, never
// answered; one that raises fails the feed. Re-audited when the declared cell size reached Screen's constructor (init
// only), which moves no callback route. Bound to the kitty 0.49.2 official launcher the hh flake builds at flake.lock
// blob 6116bd61 (/nix/store/fbpk67n6fd9kb95vl7ksrc7pkh3gx3qx-kitty-official-binary-0.49.2/bin/kitty); its bytes follow the lock.
// This declaration excludes itself; determining adapter edits require re-audit.
export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  boundary: "feed-and-getCursor",
  adapterSources: [
    { path: "packages/kitty/src/index.ts", blobOid: "3f207f911646613cdc3d8b04f155f0686a96a077" },
    { path: "packages/kitty/src/backend.ts", blobOid: "a68c7ccc054b1f8235191a2619afa031a6e8bb7f" },
    { path: "packages/kitty/build/bridge.py", blobOid: "12cdb590a80398cada26531d942729f90d6a5857" },
  ],
  engine: {
    kind: "native",
    sha256: "bb65c2d57e56eecca8143d73771432cf7dd386bccd36ae658950e5923a661886",
  },
}
