import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> engine response -> onResponse path.
// This module deliberately never binds itself; determining adapter edits need re-audit.
export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  boundary: "feed-and-getCursor",
  adapterSources: [
    {
      path: "packages/vt220/src/index.ts",
      blobOid: "601dd26eb7e753a5396ebdf72f1ef8ee2cc4355f",
    },
    {
      path: "packages/vt220/src/backend.ts",
      blobOid: "40c6194a8194afc93aee22c0395e07431636e55d",
    },
  ],
  engine: {
    kind: "source",
    repository: "git@github.com:beorn/vterm.git",
    treeOid: "d4f46ec8ca9c9bfb9a8f0486cfcaa3b48715c1a8",
  },
}
