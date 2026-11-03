import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed/getCursor -> native readResponse -> onResponse path. Re-audited when the declared cell size
// reached the native constructor and resize: the CSI 14 t answer is appended to the same response buffer as PtyWrite,
// in stream order (native/src/lib.rs send_event), so the path is unchanged; bound to the native artifact built from
// these sources (Cargo.lock sha256 1f89f257), whose build receipt names the source commit.
// Re-audited for nullable blink/native blink forwarding: only cell readback changed; the reply path above is unchanged.
// Re-audited for owned OSC 8 URI readback and propagated cell-read errors: feed/getCursor/readResponse are unchanged.
// Re-audited for existing underlineColor forwarding: cell extraction changes no response/callback route.
// Re-audited for absolute retained-row cell/line/range reads: feed, getCursor and readResponse are unchanged.
// Re-audited for alternate-scroll readback: getMode reads the existing flag; the reply route is unchanged.
// Re-audited for existing Cell.hidden readback: get_cell projects CellFlags::HIDDEN; feed, getCursor and readResponse are unchanged.
// This declaration excludes itself; determining adapter edits require re-audit.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/alacritty/src/index.ts",
      blobOid: "b4154cbd6ef4a83ce2cbf3dcf26ff13d645efd05",
    },
    {
      path: "packages/alacritty/src/backend.ts",
      blobOid: "27b78b1264cd5d2ed72705ba36c9735b29e874c5",
    },
    {
      path: "packages/alacritty/native/src/lib.rs",
      blobOid: "1779ff4f042f7f285ab3d396da039408b492be10",
    },
    {
      path: "src/load-native.ts",
      blobOid: "34e142550085450ab02138184626716ad0d6b546",
    },
  ],
  delivery: {
    boundary: "feed-and-getCursor",
    engine: {
      kind: "native",
      sha256: "9839e138d9e6f13e84adc3022f67964f0451e2e6416294952e22286412994f61",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
