// Adapter identity only. This engine's reply-delivery capability is unchanged.
// Re-audited for nullable conceal readback; the native ABI and reply delivery are unchanged.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/vt100-rust/src/index.ts",
      blobOid: "3ddb74f3ae1f79bb356952103853232f69211268",
    },
    {
      path: "packages/vt100-rust/src/backend.ts",
      blobOid: "ff4e01f618e27d525dfb997c7dbc5e9c0b9554e0",
    },
  ],
} as const
