import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed/getCursor -> native readResponse -> onResponse path. Re-audited when the declared cell size
// reached the native constructor and resize: the CSI 14 t answer is appended to the same response buffer as PtyWrite,
// in stream order (native/src/lib.rs send_event), so the path is unchanged; bound to the native artifact built from
// these sources (Cargo.lock sha256 1f89f257), whose build receipt names the source commit.
// Re-audited for nullable blink/native blink forwarding: only cell readback changed; the reply path above is unchanged.
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
      blobOid: "7c4b8b266eafd3aaf4b95de3e3600436478486fd",
    },
    {
      path: "packages/alacritty/native/src/lib.rs",
      blobOid: "94fffa294d31bec073b790d9c77b00eab2419233",
    },
    {
      path: "src/load-native.ts",
      blobOid: "34e142550085450ab02138184626716ad0d6b546",
    },
  ],
  engine: {
    kind: "native",
    sha256: "11c87e7e7f23e6f224e9dc8c3296b0a91f5453a42038e5ad049aafa864f9bd50",
  },
}
