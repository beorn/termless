import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> engine response -> onResponse path.
// This module deliberately never binds itself; determining adapter edits need re-audit.
export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  boundary: "feed-and-getCursor",
  adapterSources: [
    {
      path: "packages/vterm/src/index.ts",
      blobOid: "cb5719799dcdd5ae24e6fcf0dcad9965035ce54c",
    },
    {
      path: "packages/vterm/src/backend.ts",
      blobOid: "8d9702184c26c9adaa063997e20b8c9a9a4bc668",
    },
  ],
  engine: {
    kind: "source",
    repository: "git@github.com:beorn/vterm.git",
    treeOid: "617ae6002c7befea7b3e43d11bf23e6b433e3d65",
  },
}
