import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed/getCursor -> native readResponse -> onResponse path. Re-audited when the declared cell size
// reached the native constructor and resize: the CSI 14 t answer is appended to the same response buffer as PtyWrite,
// in stream order (native/src/lib.rs send_event), so the path is unchanged; bound to the native artifact built from
// these sources (Cargo.lock sha256 1f89f257), whose build receipt names the source commit.
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
      blobOid: "7d21892bcc3f3abeb070be6c566cb114fd03e893",
    },
    {
      path: "packages/alacritty/native/src/lib.rs",
      blobOid: "f88194a69fb43e4d45244f1da70e149c50905b16",
    },
    {
      path: "src/load-native.ts",
      blobOid: "34e142550085450ab02138184626716ad0d6b546",
    },
  ],
  engine: {
    kind: "native",
    sha256: "5d818656c9d58c8c68bec9f7bca1a55cc65ccf9fc078f9a3da0b872a28bf547a",
  },
}
