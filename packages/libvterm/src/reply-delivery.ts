import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> output sink -> onResponse path: init() attaches a growable sink through libvterm's
// vterm_output_set_callback (build/flat-api.c termless_vterm_output_attach), so no reply is dropped at the engine's
// 4096-byte outbuffer; feed() writes the input, then drains the whole sink in order into onResponse, and throws when
// the sink lost a reply to a failed allocation (src/backend.ts feed). Whole DA1, DA2 and DECRQSS replies behind a
// 5600-byte backlog were measured on this artifact (tests/window-ops-probes.test.ts). The WASM is the receipt's pair,
// built from build/flat-api.c and build/build.sh at libvterm v0.3.3.
// This declaration excludes itself; determining adapter edits require re-audit.
export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  boundary: "feed-and-getCursor",
  adapterSources: [
    {
      path: "packages/libvterm/src/index.ts",
      blobOid: "2b4708b1081e701b99893ca055ded781dc46cf25",
    },
    {
      path: "packages/libvterm/src/backend.ts",
      blobOid: "6b4f3e08d3cf4aa84e3a73ab659f078892d98c6e",
    },
    {
      path: "packages/libvterm/src/wasm-bindings.ts",
      blobOid: "46559e9cbcdf10f1969fce00be442cb271fafeaa",
    },
    {
      path: "packages/libvterm/wasm/libvterm.js",
      blobOid: "cbc2ed6cdc71344fa0f3414a7626c3f5d2545362",
    },
  ],
  engine: {
    kind: "wasm",
    sha256: "170517ec73b25039ce2870efa6f2cc79e710aaa87b42bd08dcd5ced693012446",
  },
}
