// Adapter identity only. This engine's reply-delivery capability is unchanged.
// Re-audited for nullable conceal/strikethrough and public OSC notification/Cwd readback.
// OSC777 uses the same native callback owner and copied metadata read path; reply delivery is unchanged.
export const adapterDeclaration = {
  sources: [
    {
      path: "packages/vt100-rust/src/index.ts",
      blobOid: "3ddb74f3ae1f79bb356952103853232f69211268",
    },
    {
      path: "packages/vt100-rust/src/backend.ts",
      blobOid: "b6080f968928d9ed40969bd15de3573180287272",
    },
  ],
} as const
