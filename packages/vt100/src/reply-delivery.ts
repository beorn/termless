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
      blobOid: "8aebcb9ad6788c86d75c068fc3b7102992bec2ff",
    },
  ],
  engine: {
    kind: "source",
    repository: "git@github.com:beorn/vterm.git",
    treeOid: "f8ee305b82b3a80e864d414afe402841334d0330",
  },
}
