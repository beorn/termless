// Adapter identity only. This engine's reply-delivery capability is unchanged.
// Re-audited for chronological retained native rows: the rebuilt engine receipt binds the changed Zig source tree.
// Both TypeScript sources stay unchanged; cell conversion, feed/response draining and mode forwarding retain their paths.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/ghostty-native/src/index.ts",
      blobOid: "35c9e35a5d60625ce1135b65ff38ae9278495a18",
    },
    {
      path: "packages/ghostty-native/src/backend.ts",
      blobOid: "f5832c21a5837f636effa3ee2dfc1f8a4e7b8b25",
    },
  ],
} as const
