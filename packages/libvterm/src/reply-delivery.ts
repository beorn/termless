import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> output sink -> onResponse path: init() attaches a growable sink through libvterm's
// vterm_output_set_callback (build/flat-api.c termless_vterm_output_attach), so no reply is dropped at the engine's
// 4096-byte outbuffer; feed() writes the input, then drains the whole sink in order into onResponse, and throws when
// the sink lost a reply to a failed allocation (src/backend.ts feed). Whole DA1, DA2 and DECRQSS replies behind a
// 5600-byte backlog were measured on this artifact (tests/window-ops-probes.test.ts). The WASM is the receipt's pair,
// built from build/flat-api.c and build/build.sh at libvterm v0.3.3.
// Re-audited for per-instance OSC 52 clipboard callbacks and the upstream unsigned-byte selection fix;
// feed/response delivery is unchanged, including replies behind the 5600-byte backlog.
// Re-audited for native reverse-property observation; callback acceptance and the reply sink are unchanged.
// Re-audited for the native application-cursor getter; it reads state without writing input or output.
// Re-audited with one property/history observer, native keypad read and recorded reflow enablement.
// Reply/selection sinks and feed draining retain the existing path; exact artifact tests verify this pair.
// This declaration excludes itself; determining adapter edits require re-audit.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/libvterm/src/index.ts",
      blobOid: "2b4708b1081e701b99893ca055ded781dc46cf25",
    },
    {
      path: "packages/libvterm/src/backend.ts",
      blobOid: "2fb638750f968bf7c2787e097eebc6b2512542c9",
    },
    {
      path: "packages/libvterm/src/wasm-bindings.ts",
      blobOid: "93283c5d0ee71d63a36e124f0264d32515234785",
    },
    {
      path: "packages/libvterm/wasm/libvterm.js",
      blobOid: "4b17ecd37448e2938f4e474dd95b6ba73d994f45",
    },
  ],
  delivery: {
    boundary: "feed-and-getCursor",
    engine: {
      kind: "wasm",
      sha256: "5ba1b9c894b1ddc608392c33f02b7910fd8da56c9448218c12a00bbe83020b87",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
