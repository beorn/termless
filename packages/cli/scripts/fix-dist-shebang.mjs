// tsdown copies a source file's shebang verbatim into its emitted output. `src/cli.ts` declares
// `#!/usr/bin/env bun` because the workspace raw-TS bin only runs under Bun (it imports workspace
// ESM packages like loggily and @silvery/commander directly), but the packed CLI (package.json
// `publishConfig.bin`) targets Node >=22 — where the bundled single-file ESM has no unresolvable
// imports and lowering of `using` to try/finally makes it safe. This restores the Node shebang
// in the built file after `tsdown` runs. Modeled after vendor/gitomic/scripts/fix-dist-shebang.mjs.
import { readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"

const distBinPath = new URL("../dist/cli.mjs", import.meta.url)
const sourceShebang = "#!/usr/bin/env bun"
const publishedShebang = "#!/usr/bin/env node"

if (!existsSync(distBinPath)) {
  // If dist/cli.mjs wasn't built (e.g. partial entry build), do nothing
  process.exit(0)
}

const content = await readFile(distBinPath, "utf8")
const newlineIndex = content.indexOf("\n")
if (newlineIndex === -1) {
  throw new Error(`dist/cli.mjs: expected a shebang line followed by file content, got a single line`)
}

const firstLine = content.slice(0, newlineIndex)
if (firstLine === publishedShebang) {
  // Already fixed
  process.exit(0)
}

if (firstLine !== sourceShebang) {
  throw new Error(
    `dist/cli.mjs: expected first line ${JSON.stringify(sourceShebang)}, got ${JSON.stringify(firstLine)}; ` +
      "tsdown shebang emit or src/cli.ts shebang changed — update this script rather than shipping the wrong one",
  )
}

await writeFile(distBinPath, publishedShebang + content.slice(newlineIndex))
