import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed/getCursor -> native readResponse -> onResponse path.
// This declaration excludes itself; determining adapter edits require re-audit.
export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  boundary: "feed-and-getCursor",
  adapterSources: [
    {
      path: "packages/alacritty/src/index.ts",
      blobOid: "b4154cbd6ef4a83ce2cbf3dcf26ff13d645efd05",
    },
    {
      path: "packages/alacritty/src/backend.ts",
      blobOid: "3aad477a50e156d3ae12b594c0023ff7cdb634d7",
    },
    {
      path: "packages/alacritty/native/src/lib.rs",
      blobOid: "9b4f27fdff4d07575ed559a1186e5a144a8ec9d4",
    },
    {
      path: "src/load-native.ts",
      blobOid: "34e142550085450ab02138184626716ad0d6b546",
    },
  ],
  engine: {
    kind: "native",
    sha256: "e6e16113863355b77d0aa3b359bd40c7066fb144e005fbc324fecfa3f4869bea",
  },
}
