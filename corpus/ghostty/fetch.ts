#!/usr/bin/env bun
// Fetches the ghostty terminal-core Zig source files that extract.ts reads
// (see source-files.ts) from the upstream repo's `main` branch.
//
// Standalone script: node:fs / node:path / node:url only, no termless
// imports (matches extract.ts's independence requirement).
//
// Usage:
//   bun fetch.ts [outDir]     # default outDir: ./src (gitignored scratch,
//                              # not checked in - see README.md)
//   bun extract.ts <outDir>   # then feed that dir to extract.ts

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCE_FILES } from "./source-files.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const UPSTREAM_RAW = "https://raw.githubusercontent.com/ghostty-org/ghostty/main/src/terminal";

async function main(): Promise<void> {
  const outDir = process.argv[2] ?? join(SCRIPT_DIR, "src");
  mkdirSync(outDir, { recursive: true });

  let ok = 0;
  const failures: string[] = [];
  for (const file of SOURCE_FILES) {
    const url = `${UPSTREAM_RAW}/${file}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`FAILED ${file}: HTTP ${res.status}`);
      failures.push(file);
      continue;
    }
    const text = await res.text();
    writeFileSync(join(outDir, file), text, "utf8");
    ok++;
    console.log(`fetched ${file} (${text.length.toLocaleString()} bytes)`);
  }

  console.log(`\n${ok}/${SOURCE_FILES.length} files fetched to ${outDir}`);
  if (failures.length > 0) {
    console.error(`Failed: ${failures.join(", ")}`);
    console.error(
      "A 404 usually means the file moved or was renamed upstream - check " +
        "https://github.com/ghostty-org/ghostty/tree/main/src/terminal and update source-files.ts.",
    );
    process.exit(1);
  }
}

main();
