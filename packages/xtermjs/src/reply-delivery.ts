import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> engine response -> onResponse path.
// Re-audited pixel event binding: synchronous feed/getCursor and onResponse forwarding are unchanged.
// OSC777 uses a non-consuming public handler; feed and response delivery remain unchanged.
// This module deliberately never binds itself; determining adapter edits need re-audit.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/xtermjs/src/index.ts",
      blobOid: "550e10110ec2baaf326d2958319b03ee8208feba",
    },
    {
      path: "packages/xtermjs/src/backend.ts",
      blobOid: "3038734b7e267c72f5aec90ab5366d2ab995ce6e",
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
