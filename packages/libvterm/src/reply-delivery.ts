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
// Re-audited for the native-key extension declaration; keyboard capture and reply delivery are unchanged.
// Re-audited for shared OSC 9/777 state fallbacks: only completed payloads enter the observer's separate histories;
// both families reuse one append/cleanup path and failed-allocation latch. The callback
// writes no replies, leaves OSC52 selection ownership intact, and preserves feed draining and reset cleanup.
// Re-audited for completed OSC 7/633 CWD payloads on this same fallback: the existing accumulator and failure latch
// own the copied value, pointer/length reads emit no output, and explicit reset/teardown clear its buffers.
// Other OSC commands remain declined; notification, clipboard and reply paths are unchanged on this rebuilt pair.
// This declaration excludes itself; determining adapter edits require re-audit.
// Number-only unhandled OSC reports share the observer's existing allocation latch and clear path;
// their first-fragment append preserves fallback return values and emits no replies.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/libvterm/src/index.ts",
      blobOid: "2b4708b1081e701b99893ca055ded781dc46cf25",
    },
    {
      path: "packages/libvterm/src/backend.ts",
      blobOid: "deb23c67ed4fdef31ee81066dd7021da1033976e",
    },
    {
      path: "packages/libvterm/src/wasm-bindings.ts",
      blobOid: "86ef3f64c5424f474bc46621f2547e23a1d19895",
    },
    {
      path: "packages/libvterm/wasm/libvterm.js",
      blobOid: "393db9b3cba3e2895160a94e92003dd4be806a1b",
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
      sha256: "6ab1a659db995b67753b633f162e65f01e2a0f3649e8a554aabf76775d172f0c",
    },
  },
} as const

export const replyDelivery: ReplyDeliveryExtension["replyDelivery"] = {
  ...adapterDeclaration.delivery,
  adapterSources: adapterDeclaration.sources,
}
