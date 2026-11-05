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
// Re-audited for native keyboard/mouse input capture: synchronous callback swaps restore the original reply sink
// in finally without changing selection callbacks; tests retain a queued reply prefix and OSC52 state after failures.
// Re-audited for native paste input capture: start/unichar/end uses this same callback swap, preserves queued replies
// and OSC52 ownership on errors, and keeps primary plus cleanup failures. Native handles stay private.
// This declaration excludes itself; determining adapter edits require re-audit.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/libvterm/src/index.ts",
      blobOid: "2b4708b1081e701b99893ca055ded781dc46cf25",
    },
    {
      path: "packages/libvterm/src/backend.ts",
      blobOid: "1077a72090bc8e54b63523c4517f7e9bb51c774f",
    },
    {
      path: "packages/libvterm/src/wasm-bindings.ts",
      blobOid: "07d73897f201bea0b234148f5fb6ed55d3779f90",
    },
    {
      path: "packages/libvterm/wasm/libvterm.js",
      blobOid: "98c3d4f3875dc2499d2118ade86270be8dfc1ee0",
    },
    {
      path: "src/terminal/key-mapping.ts",
      blobOid: "a687ff18768ae42b315f689122bcef07244b036e",
    },
  ],
  delivery: {
    boundary: "feed-and-getCursor",
    engine: {
      kind: "wasm",
      sha256: "156dcc22456fd7e9527ba178c795759d7e5668a99d3b56fa1dd93b3abf27f5f0",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
