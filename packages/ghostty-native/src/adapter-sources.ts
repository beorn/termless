// Adapter identity only. This engine's reply-delivery capability is unchanged.
// Re-audited for chronological retained native rows: the rebuilt engine receipt binds the changed Zig source tree.
// Native paste uses the existing handle's encoder and copied bytes; it never feeds or drains the reply stream.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/ghostty-native/src/index.ts",
      blobOid: "35c9e35a5d60625ce1135b65ff38ae9278495a18",
    },
    {
      path: "packages/ghostty-native/src/backend.ts",
      blobOid: "c1efd57fbe0dd5dafc0a27bb0229696cd006fade",
    },
  ],
} as const
