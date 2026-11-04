// Adapter identity only. This engine's reply-delivery capability is unchanged.
// Re-audited for chronological retained native rows: the rebuilt engine receipt binds the changed Zig source tree.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/ghostty-native/src/index.ts",
      blobOid: "35c9e35a5d60625ce1135b65ff38ae9278495a18",
    },
    {
      path: "packages/ghostty-native/src/backend.ts",
      blobOid: "530fcdf3da0f9899a793b98851e88b8d1f7779fd",
    },
  ],
} as const
