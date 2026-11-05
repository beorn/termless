// Adapter identity only. This engine's reply-delivery capability is unchanged.
// Re-audited for nullable conceal/strikethrough and public OSC notification/Cwd readback.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/vt100-rust/src/index.ts",
      blobOid: "3ddb74f3ae1f79bb356952103853232f69211268",
    },
    {
      path: "packages/vt100-rust/src/backend.ts",
      blobOid: "e23189b0b645a90313d497ec850386d70e0fd518",
    },
  ],
} as const
