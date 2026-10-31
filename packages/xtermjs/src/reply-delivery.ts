import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> engine response -> onResponse path.
// This module deliberately never binds itself; determining adapter edits need re-audit.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/xtermjs/src/index.ts",
      blobOid: "550e10110ec2baaf326d2958319b03ee8208feba",
    },
    {
      path: "packages/xtermjs/src/backend.ts",
      blobOid: "923e41d80147e4f136719e46ce9a2fc7dfb31683",
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
