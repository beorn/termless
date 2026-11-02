import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> engine response -> onResponse path.
// This module deliberately never binds itself; determining adapter edits need re-audit.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/vt100/src/index.ts",
      blobOid: "99833d737402f9d1d8e3e257e3a255d8aa1facc3",
    },
    {
      path: "packages/vt100/src/backend.ts",
      blobOid: "cdb8be8c5ebbba68a5920cfa4df27c9deb31745a",
    },
  ],
  delivery: {
    boundary: "feed-and-getCursor",
    engine: {
      kind: "source",
      repository: "git@github.com:beorn/vterm.git",
      treeOid: "b941dae48b25ae8825c394750bda5245c9d93dfa",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
