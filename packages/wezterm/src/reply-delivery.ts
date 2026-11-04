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
// This declaration excludes itself; determining adapter edits require re-audit.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/wezterm/src/index.ts",
      blobOid: "512606c5270ffd0cff55c1b70f5b3eda18a92df0",
    },
    {
      path: "packages/wezterm/src/backend.ts",
      blobOid: "4927c703afffd493858f85a7bc34f8e60d3ac30e",
    },
    {
      path: "packages/wezterm/native/src/lib.rs",
      blobOid: "d71174a89deb19e8c649a5edfe7da2d30d3bad7a",
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
      sha256: "3d5c4057292966fa11a2ca274b41ac15ae0831d0e22a0c639c1fd2163e7b5661",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
