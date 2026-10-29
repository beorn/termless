import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> engine response -> onResponse path.
// This module deliberately never binds itself; determining adapter edits need re-audit.
export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  boundary: "feed-and-getCursor",
  adapterSources: [
    {
      path: "packages/xtermjs/src/index.ts",
      blobOid: "550e10110ec2baaf326d2958319b03ee8208feba",
    },
    {
      path: "packages/xtermjs/src/backend.ts",
      blobOid: "3034af8c2a83a561da44f75beb5d8e0bc9beec0c",
    },
  ],
  engine: {
    kind: "registry",
    lockIntegrity: "sha512-5Yj1QINYCyzrZtf8OFIHi47iQtI+0qYFPHmouEfG8dHNxbZ9Tb9YGSuLcsEwj9Z+OL75GJqPyJbyoFer80a2Hw==",
  },
}
