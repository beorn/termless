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
// This declaration excludes itself; determining adapter edits require re-audit.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/libvterm/src/index.ts",
      blobOid: "2b4708b1081e701b99893ca055ded781dc46cf25",
    },
    {
      path: "packages/libvterm/src/backend.ts",
      blobOid: "f0431b2b3b1824d3028e7a039d55278d2cddc0e8",
    },
    {
      path: "packages/libvterm/src/wasm-bindings.ts",
      blobOid: "55ddc684464e525e63cd523d2d6a638c4c6dbcd9",
    },
    {
      path: "packages/libvterm/wasm/libvterm.js",
      blobOid: "d28bc97333d33129c7c9764a331a3d47f088f7b3",
    },
  ],
  delivery: {
    boundary: "feed-and-getCursor",
    engine: {
      kind: "wasm",
      sha256: "712298aff45c7c53a22dc028b13cb58dae1e984199b520bbbc0475ae64d83159",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
