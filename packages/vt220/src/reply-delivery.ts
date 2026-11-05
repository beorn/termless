import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> engine response -> onResponse path.
// Native paste delegates to this Screen and returns bytes without entering that path.
// Re-audited bd3d32ae -> 7e6c993c: removing DEC-private 4 leaves byte feed and reply forwarding unchanged.
// This module deliberately never binds itself; determining adapter edits need re-audit.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/vt220/src/index.ts",
      blobOid: "601dd26eb7e753a5396ebdf72f1ef8ee2cc4355f",
    },
    {
      path: "packages/vt220/src/backend.ts",
      blobOid: "d3f9204da47be8e77a6b9942f4493acf91e0b68f",
    },
  ],
  delivery: {
    boundary: "feed-and-getCursor",
    engine: {
      kind: "source",
      repository: "git@github.com:beorn/vterm.git",
      treeOid: "4c946bbce73a95093ed16bab183b17032c622e21",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
