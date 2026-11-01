import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> engine response -> onResponse path.
// Re-audited for selected-buffer history reads: only snapshots/counts changed; feed/response delivery is unchanged.
// This module deliberately never binds itself; determining adapter edits need re-audit.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/vterm/src/index.ts",
      blobOid: "cb5719799dcdd5ae24e6fcf0dcad9965035ce54c",
    },
    {
      path: "packages/vterm/src/backend.ts",
      blobOid: "ae08fca0a071207d6dfc1ec2735ea6b3e72c0e18",
    },
  ],
  delivery: {
    boundary: "feed-and-getCursor",
    engine: {
      kind: "source",
      repository: "git@github.com:beorn/vterm.git",
      treeOid: "f10a184811894462b9ca7b65d6aab8ffd2fdd0bd",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
