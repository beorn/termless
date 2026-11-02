import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> engine response -> onResponse path.
// Re-audited mouse-unavailable error-prefix edit: feed/getCursor and onResponse forwarding are unchanged.
// This module deliberately never binds itself; determining adapter edits need re-audit.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/xtermjs/src/index.ts",
      blobOid: "550e10110ec2baaf326d2958319b03ee8208feba",
    },
    {
      path: "packages/xtermjs/src/backend.ts",
      blobOid: "751d9fa074aa9c3519f2af1bb9d71222b3834e4e",
    },
  ],
  delivery: {
    boundary: "feed-and-getCursor",
    engine: {
      kind: "registry",
      lockIntegrity: "sha512-5Yj1QINYCyzrZtf8OFIHi47iQtI+0qYFPHmouEfG8dHNxbZ9Tb9YGSuLcsEwj9Z+OL75GJqPyJbyoFer80a2Hw==",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
