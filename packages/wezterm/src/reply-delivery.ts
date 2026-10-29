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
      blobOid: "add275f27e84bd64fa9706aab499905db16b3349",
    },
    {
      path: "packages/wezterm/native/src/lib.rs",
      blobOid: "5287c25e5141ed813cdf30788c273264de32b0a2",
    },
    {
      path: "src/load-native.ts",
      blobOid: "34e142550085450ab02138184626716ad0d6b546",
    },
  ],
  engine: {
    kind: "native",
    sha256: "569316adf59d849d4fa6b6fc56a3ebb26d178000231ec50a36ff968cbd931490",
  },
}
