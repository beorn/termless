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
      blobOid: "63d6406b52cc48347fef2b9129e56905fb486060",
    },
    {
      path: "packages/libvterm/src/wasm-bindings.ts",
      blobOid: "2bbd4d5cf59b8d53db8f5c0329d2ed7853c43e45",
    },
    {
      path: "packages/libvterm/wasm/libvterm.js",
      blobOid: "973341a8e2303d25cb17f1a36d491aad6c55b3a1",
    },
  ],
  engine: {
    kind: "wasm",
    sha256: "5937bd79139ee5856bcf1bd619cc44fcd2d750d3def3066a74956678cdaaaeb2",
  },
}
