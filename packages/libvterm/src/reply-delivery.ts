import type { ReplyDeliveryExtension } from "../../../src/terminal/types.ts"

// Audited synchronous feed -> output sink -> onResponse path: init() attaches a growable sink through libvterm's
// vterm_output_set_callback (build/flat-api.c termless_vterm_output_attach), so no reply is dropped at the engine's
// 4096-byte outbuffer; feed() writes the input, then drains the whole sink in order into onResponse, and throws when
// the sink lost a reply to a failed allocation (src/backend.ts feed). Whole DA1, DA2 and DECRQSS replies behind a
// 5600-byte backlog were measured on this artifact (tests/window-ops-probes.test.ts). The WASM is the receipt's pair,
// built from build/flat-api.c and build/build.sh at libvterm v0.3.3.
// Re-audited for per-instance OSC 52 clipboard callbacks and the upstream unsigned-byte selection fix;
// feed/response delivery is unchanged, including replies behind the 5600-byte backlog.
// This declaration excludes itself; determining adapter edits require re-audit.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/libvterm/src/index.ts",
      blobOid: "2b4708b1081e701b99893ca055ded781dc46cf25",
    },
    {
      path: "packages/libvterm/src/backend.ts",
      blobOid: "caa5dc6c4ac4e3dac45977466919d2c1dcd3e851",
    },
    {
      path: "packages/libvterm/src/wasm-bindings.ts",
      blobOid: "2bbd4d5cf59b8d53db8f5c0329d2ed7853c43e45",
    },
    {
      path: "packages/libvterm/wasm/libvterm.js",
      blobOid: "1e784be87614ab924b96844009919b7c21ce150e",
    },
  ],
  delivery: {
    boundary: "feed-and-getCursor",
    engine: {
      kind: "wasm",
      sha256: "7ebe1b994b58ca867dcd19e9cdeb10b8839b6c1f0dbdea024f875a9f57560a23",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
