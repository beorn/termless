import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> engine response -> onResponse path.
// Native paste delegates to this Screen and returns bytes without entering that path.
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
      blobOid: "012de550a2c26b3c4b4e159a5e1de2e46a48bf22",
    },
  ],
  delivery: {
    boundary: "feed-and-getCursor",
    engine: {
      kind: "source",
      repository: "git@github.com:beorn/vterm.git",
      treeOid: "10200d527767cbaa3608b4f9df2eddb37da8e104",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
