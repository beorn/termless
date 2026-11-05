import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> native response barrier -> readResponse -> onResponse path:
// the engine writes replies into an unbounded SharedWriter buffer (native/src/lib.rs:33-41); feed() sends a paste barrier
// through that writer and waits until the flush that ends with it, failing loudly after 500 ms (lib.rs:188-228, 230-238);
// the TypeScript feed then drains the whole buffer into onResponse (src/backend.ts feed). Re-audited when the pixel
// geometry reached the native constructor and resize, and again when its check moved to src/terminal/types.ts
// declaredPixelGeometry, neither of which touches that path; bound to the native artifact built
// from these sources, whose build receipt names the source commit and Cargo.lock digest.
// Re-audited for nullable blink/native blink forwarding: only cell readback changed; the reply path above is unchanged.
// Re-audited for owned OSC 8 URI readback: the existing synchronous reply path is unchanged.
// Re-audited for existing underlineColor forwarding: cell extraction changes no response/callback route.
// Re-audited for productViewport absence metadata only; feed/response delivery is unchanged.
// Re-audited for absolute retained-row readback and enumeration: feed/response delivery is unchanged.
// Re-audited for stored overline cell/empty-cell projection: feed/response delivery is unchanged.
// Re-audited for the stored parsed-toast list: the notification handler only records toasts; feed/response delivery is
// unchanged.
// Re-audited for stored conceal cell/empty-cell projection: feed/response delivery is unchanged.
// Re-audited for the readonly DECCKM getter and maintained Cargo source: feed/response delivery is unchanged.
// Re-audited for readonly current Progress enum projection: no feed, parser, writer, barrier or reply path changes.
// Native paste encoding uses the existing barrier before and after send_paste, returning only bytes
// appended after the queued-reply boundary. Pending replies retain their order and never include paste bytes.
// Native key encoding reuses that boundary around key_down; queued replies are never drained by input encoding.
// Native key, paste and mouse share one writer boundary; mouse_event returns only newly appended input bytes.
// The queued DSR control remains in the response stream and is delivered once.
// This declaration excludes itself; determining adapter edits require re-audit.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/wezterm/src/index.ts",
      blobOid: "512606c5270ffd0cff55c1b70f5b3eda18a92df0",
    },
    {
      path: "packages/wezterm/src/backend.ts",
      blobOid: "4b376877280d09535bc67a6f99fc5d68b40529e3",
    },
    {
      path: "packages/wezterm/native/src/lib.rs",
      blobOid: "69a9d1ebc4fd86d46c131a378a9d897cdd6824b3",
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
      sha256: "4753e20984ab7e15ea7ef8d4ddf9bd11237f79146087939e9c37771aaadbf186",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
