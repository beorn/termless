// Adapter identity only. This engine's reply-delivery capability is unchanged.
// Re-audited for nullable conceal/strikethrough and public OSC notification readback.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/vt100-rust/src/index.ts",
      blobOid: "3ddb74f3ae1f79bb356952103853232f69211268",
    },
    {
      path: "packages/vt100-rust/src/backend.ts",
      blobOid: "f19d7ffbb9093440786b791ceb90132946cae49a",
    },
  ],
} as const
