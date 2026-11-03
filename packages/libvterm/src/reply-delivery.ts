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
      blobOid: "7ec9158d768f85b2a096047509d23b1067bc944b",
    },
    {
      path: "packages/libvterm/src/wasm-bindings.ts",
      blobOid: "ff2e94b23c10d85ffb770e3e749e836b8b9227d4",
    },
    {
      path: "packages/libvterm/wasm/libvterm.js",
      blobOid: "5bf4785f2313c4b4825d6e2e45945431e94fac9d",
    },
  ],
  delivery: {
    boundary: "feed-and-getCursor",
    engine: {
      kind: "wasm",
      sha256: "361f44f0019504628460e0125615b6c2decc8496a039fe152c7832b4772befc9",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
