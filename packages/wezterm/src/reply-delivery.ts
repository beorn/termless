import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> native response barrier -> readResponse -> onResponse path:
// the engine writes replies into an unbounded SharedWriter buffer (native/src/lib.rs:33-41); feed() sends a paste barrier
// through that writer and waits until the flush that ends with it, failing loudly after 500 ms (lib.rs:172-212, 214-222);
// the TypeScript feed then drains the whole buffer into onResponse (src/backend.ts feed). Bound to the native artifact
// built from these unchanged sources (Termless a552d932, Cargo.lock sha256 8eaeab73).
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
      blobOid: "9f9af63f2bcc439be7f809bdb7d60643ed1fbe4b",
    },
    {
      path: "packages/wezterm/native/src/lib.rs",
      blobOid: "59dc70811d17b3cfcdede9d33ab8edf86bbf05e2",
    },
    {
      path: "src/load-native.ts",
      blobOid: "34e142550085450ab02138184626716ad0d6b546",
    },
  ],
  engine: {
    kind: "native",
    sha256: "84da518e3f298a0ed75f186db6e39d87e99b8f0c8508dd7252ec0cafee77fe12",
  },
}
