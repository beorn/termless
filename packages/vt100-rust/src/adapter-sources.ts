// Adapter identity only. This engine's reply-delivery capability is unchanged.
// Re-audited for public OSC notification readback; reply delivery is unchanged.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/vt100-rust/src/index.ts",
      blobOid: "3ddb74f3ae1f79bb356952103853232f69211268",
    },
    {
      path: "packages/vt100-rust/src/backend.ts",
      blobOid: "70ed4aa275e50c0ad400716d9cf45264d4d4a8ef",
    },
  ],
} as const
