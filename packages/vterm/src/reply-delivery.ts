import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> engine response -> onResponse path.
// Re-audited for copied mark/Sixel readers and declarations; feed/response delivery and selected-buffer history are unchanged.
// This module deliberately never binds itself; determining adapter edits need re-audit.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/vterm/src/index.ts",
      blobOid: "cb5719799dcdd5ae24e6fcf0dcad9965035ce54c",
    },
    {
      path: "packages/vterm/src/backend.ts",
      blobOid: "308a934578c044ae95feaa29299531d9aa9eb4f7",
    },
  ],
  delivery: {
    boundary: "feed-and-getCursor",
    engine: {
      kind: "source",
      repository: "git@github.com:beorn/vterm.git",
      treeOid: "d7bc627e039005ee913b0b244ff9a2ee2235746a",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
