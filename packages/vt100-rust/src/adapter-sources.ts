// Adapter identity only. This engine's reply-delivery capability is unchanged.
// Re-audited for nullable conceal and strikethrough; native ABI and reply delivery are unchanged.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/vt100-rust/src/index.ts",
      blobOid: "3ddb74f3ae1f79bb356952103853232f69211268",
    },
    {
      path: "packages/vt100-rust/src/backend.ts",
      blobOid: "645f53ce78ddacfc4ad3ce995de4f5f88956b1ed",
    },
  ],
} as const
