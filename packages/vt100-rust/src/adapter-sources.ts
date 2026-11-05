// Adapter identity only. This engine's reply-delivery capability is unchanged.
// Re-audited for nullable conceal/strikethrough and public OSC notification/Cwd readback.
// OSC777 uses the same native callback owner and copied metadata read path; reply delivery is unchanged.
// Unhandled OSC/CSI reports copy native callback fields on the same owner; handling and reply delivery are unchanged.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/vt100-rust/src/index.ts",
      blobOid: "3ddb74f3ae1f79bb356952103853232f69211268",
    },
    {
      path: "packages/vt100-rust/src/backend.ts",
      blobOid: "ddabecd4881be4f6b63f1c35f9c2265b53d35df4",
    },
  ],
} as const
