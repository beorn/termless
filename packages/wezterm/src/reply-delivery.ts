import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> native response barrier -> readResponse -> onResponse path:
// the engine writes replies into an unbounded SharedWriter buffer (native/src/lib.rs:33-41); feed() sends a paste barrier
// through that writer and waits until the flush that ends with it, failing loudly after 500 ms (lib.rs:188-228, 230-238);
// the TypeScript feed then drains the whole buffer into onResponse (src/backend.ts feed). Re-audited when the pixel
// geometry reached the native constructor and resize, and again when its check moved to src/terminal/types.ts
// declaredPixelGeometry, neither of which touches that path; bound to the native artifact built
// from these sources (Cargo.lock sha256 8eaeab73), whose build receipt names the source commit.
// Re-audited for nullable blink/native blink forwarding: only cell readback changed; the reply path above is unchanged.
// Re-audited for owned OSC 8 URI readback: the existing synchronous reply path is unchanged.
// Re-audited for existing underlineColor forwarding: cell extraction changes no response/callback route.
// Re-audited for productViewport absence metadata only; feed/response delivery is unchanged.
// Re-audited for absolute retained-row readback and enumeration: feed/response delivery is unchanged.
// Re-audited for stored overline cell/empty-cell projection: feed/response delivery is unchanged.
// Re-audited for the stored parsed-toast list: the notification handler only records toasts; feed/response delivery is
// unchanged.
// Re-audited for stored conceal cell/empty-cell projection: feed/response delivery is unchanged.
// This declaration excludes itself; determining adapter edits require re-audit.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/wezterm/src/index.ts",
      blobOid: "512606c5270ffd0cff55c1b70f5b3eda18a92df0",
    },
    {
      path: "packages/wezterm/src/backend.ts",
      blobOid: "e78a7cedb068806bd9cbe883a2f2c9a8ad78b6fa",
    },
    {
      path: "packages/wezterm/native/src/lib.rs",
      blobOid: "74a771a53bed838ae98f9e6333d5079f14843040",
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
      sha256: "4a15c6d9ceca951d5120f72b1473adc144eb7011abe877d8e65024946246b881",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
