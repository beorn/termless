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
      blobOid: "427b9d4782a9924135ff0c32e2406b117df9cf22",
    },
  ],
} as const
