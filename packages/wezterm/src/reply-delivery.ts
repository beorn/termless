import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> native response barrier -> readResponse -> onResponse path:
// the engine writes replies into an unbounded SharedWriter buffer (native/src/lib.rs:33-41); feed() sends a paste barrier
// through that writer and waits until the flush that ends with it, failing loudly after 500 ms (lib.rs:188-228, 230-238);
// the TypeScript feed then drains the whole buffer into onResponse (src/backend.ts feed). Re-audited when the pixel
// geometry reached the native constructor and resize, and again when its check moved to src/terminal/types.ts
// declaredPixelGeometry, neither of which touches that path; bound to the native artifact built
// from these sources (Cargo.lock sha256 8eaeab73), whose build receipt names the source commit.
// Re-audited for nullable blink/native blink forwarding: only cell readback changed; the reply path above is unchanged.
// This declaration excludes itself; determining adapter edits require re-audit.
export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  boundary: "feed-and-getCursor",
  adapterSources: [
    {
      path: "packages/wezterm/src/index.ts",
      blobOid: "512606c5270ffd0cff55c1b70f5b3eda18a92df0",
    },
    {
      path: "packages/wezterm/src/backend.ts",
      blobOid: "f49e2f8054e6bfea9ad7b4086d8710ec8e67c374",
    },
    {
      path: "packages/wezterm/native/src/lib.rs",
      blobOid: "671656550ffaa64a3b8468abd4c60569b9e0dc18",
    },
    {
      path: "src/load-native.ts",
      blobOid: "34e142550085450ab02138184626716ad0d6b546",
    },
  ],
  engine: {
    kind: "native",
    sha256: "99a6bc50445e2bee31ed87ecfd06c0b317ba96a262d700bcdae9e44d5401ced8",
  },
}
