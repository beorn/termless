# Contributing to termless

## Getting Started

1. Fork and clone the repo
2. Install dependencies: `bun install`
3. Run tests: `bun vitest run`
4. Create a branch for your changes

## Development

### Code Style

- **Factory functions** — no classes, no globals
- **`using` cleanup pattern** — for resource management
- **Explicit dependency injection** — pass dependencies as arguments
- **No `require`** — ESM only

### Testing

```bash
bun vitest run                    # Run all tests
bun vitest run packages/xtermjs/  # Run tests for a specific package
```

Write tests for all new functionality. For rendering/terminal behavior, use the `viterm` matchers.

### Type Checking

```bash
bun run typecheck
```

## Packages

| Package | What it does |
|---------|-------------|
| `termless` (root) | Core types, Terminal API, PTY, SVG screenshots, key mapping |
| `termless-xtermjs` | xterm.js backend using @xterm/headless |
| `termless-ghostty` | Ghostty backend (ghostty-web WASM) |
| `viterm` | Vitest matchers, fixtures, and snapshot serializer |
| `termless-cli` | CLI tool and MCP server |

## Submitting Changes

1. Ensure tests pass: `bun vitest run`
2. Ensure types check: `bun run typecheck`
3. Write clear commit messages following [Conventional Commits](https://conventionalcommits.org)
4. Open a PR against `main`

## Reporting Issues

Open an issue at https://github.com/beorn/termless/issues with:
- What you expected
- What happened instead
- Minimal reproduction steps
