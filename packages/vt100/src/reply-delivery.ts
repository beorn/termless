import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> engine response -> onResponse path.
// This module deliberately never binds itself; determining adapter edits need re-audit.
export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  boundary: "feed-and-getCursor",
  adapterSources: [
    {
      path: "packages/vt100/src/index.ts",
      blobOid: "99833d737402f9d1d8e3e257e3a255d8aa1facc3",
    },
    {
      path: "packages/vt100/src/backend.ts",
      blobOid: "ebca0d82d5cdbe623d071142972911246e913b4d",
    },
  ],
  engine: {
    kind: "source",
    repository: "git@github.com:beorn/vterm.git",
    treeOid: "5ffc7ad9ae120d0bf93c64b0fdc712eb40892896",
  },
}
