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
      blobOid: "ec7139f4208553d299897f3434ae8576869980f1",
    },
  ],
  engine: {
    kind: "registry",
    lockIntegrity: "sha512-5Yj1QINYCyzrZtf8OFIHi47iQtI+0qYFPHmouEfG8dHNxbZ9Tb9YGSuLcsEwj9Z+OL75GJqPyJbyoFer80a2Hw==",
  },
}
