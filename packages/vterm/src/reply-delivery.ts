import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> engine response -> onResponse path.
// Re-audited 7e6c993c -> 67dd396: independent mouse DECRQM replies remain inline;
// byte feed/onResponse forwarding is unchanged, and mouse encoding emits returned bytes only.
// This module deliberately never binds itself; determining adapter edits need re-audit.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/vterm/src/index.ts",
      blobOid: "cb5719799dcdd5ae24e6fcf0dcad9965035ce54c",
    },
    {
      path: "packages/vterm/src/backend.ts",
      blobOid: "5d27c551161fe41af00ac587bd9484d6becbbc7a",
    },
  ],
  delivery: {
    boundary: "feed-and-getCursor",
    engine: {
      kind: "source",
      repository: "git@github.com:beorn/vterm.git",
      treeOid: "e9d67d4b4ba7cb4caf0d0824b3b272c10e4b229e",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
