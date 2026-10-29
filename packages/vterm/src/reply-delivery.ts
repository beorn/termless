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
      blobOid: "a9ecf13886ba4256b6c85f2e61133faada304e91",
    },
  ],
  engine: {
    kind: "source",
    repository: "git@github.com:beorn/vterm.git",
    treeOid: "2ee13d2cb894e86ee9575dd6945f42028df44966",
  },
}
