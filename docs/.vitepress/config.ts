import { defineConfig } from "vitepress"
import llmstxt from "vitepress-plugin-llms"
import {
  glossaryPlugin,
  seoHead,
  seoTransformPageData,
  validateGlossary,
  loadTerminalGlossary,
  loadEcosystemGlossary,
} from "vitepress-enrich"
import siteGlossary from "../content/glossary.json"

// Site-specific terms + shared terminal vocabulary + ecosystem cross-links
const glossary = [...siteGlossary, ...loadTerminalGlossary(), ...loadEcosystemGlossary({ exclude: ["termless.dev"] })]

const tapeLanguage = {
  name: "tape",
  scopeName: "source.tape",
  patterns: [
    {
      match: "^\\s*#.*$",
      name: "comment.line.number-sign.tape",
    },
    {
      match:
        "^\\s*(Set|Type(?:@\\S+)?|Sleep|Screenshot|Hide|Show|Source|Require|Output|Expect|Enter|Tab|Space|Backspace|Delete|Escape|Up|Down|Left|Right|Home|End|PageUp|PageDown|Ctrl\\+\\S+|Alt\\+\\S+)\\b",
      name: "keyword.control.tape",
    },
    {
      match: '"(?:[^"\\\\]|\\\\.)*"',
      name: "string.quoted.double.tape",
    },
    {
      match: "\\b\\d+(?:\\.\\d+)?(?:ms|s)?\\b",
      name: "constant.numeric.tape",
    },
  ],
}

const seoOptions = {
  hostname: "https://termless.dev",
  siteName: "Termless",
  description: "Headless terminal testing for every backend",
  ogImage: "https://termless.dev/og-image.png",
  author: {
    name: "Bjørn Stabell",
    url: "https://beorn.codes",
    sameAs: ["https://github.com/beorn", "https://x.com/bjornstabell"],
  },
  codeRepository: "https://github.com/beorn/termless",
}

export default defineConfig({
  vite: {
    plugins: [
      llmstxt({
        // Auto-generates llms.txt and llms-full.txt at build time
      }),
    ],
    ssr: {
      noExternal: ["vitepress-enrich"],
    },
  },

  title: "Termless",
  description:
    "Headless terminal testing — like Playwright, but for terminal apps. Write tests once, run against any backend.",
  base: "/",
  lastUpdated: true,

  sitemap: { hostname: "https://termless.dev" },

  markdown: {
    languages: [tapeLanguage],
    config(md) {
      md.use(glossaryPlugin, { entities: glossary })
    },
  },

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/logo.svg" }],
    ...seoHead(seoOptions),
    [
      "script",
      {
        defer: "",
        src: "https://static.cloudflareinsights.com/beacon.min.js",
        "data-cf-beacon": '{"token": "f8fcb4e438a34026a53adc961ef0968c"}',
      },
    ],
  ],

  transformPageData: seoTransformPageData(seoOptions),

  buildEnd(siteConfig) {
    validateGlossary(glossary, siteConfig)
  },

  themeConfig: {
    logo: "/logo.svg",
    siteTitle: "Termless",

    nav: [
      {
        text: "Concepts",
        items: [
          { text: "Overview", link: "/concepts/overview" },
          { text: "Backend", link: "/concepts/backend" },
          { text: "Terminal", link: "/concepts/terminal" },
          { text: "Recording", link: "/concepts/recording" },
        ],
      },
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Terminal Model", link: "/guide/terminal-model" },
          { text: "Writing Tests", link: "/guide/writing-tests" },
          { text: "Screenshots", link: "/guide/screenshots" },
          { text: "Best Practices", link: "/guide/best-practices" },
          { text: "Recording Sessions", link: "/guide/recording-sessions" },
          { text: "Tracing Visual Bugs", link: "/guide/tracing-visual-bugs" },
          { text: "Web Player", link: "/guide/web-player" },
          { text: "Backends", link: "/guide/backends" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI", link: "/reference/cli" },
          { text: "MCP Server", link: "/reference/mcp" },
          { text: "Recording Formats", link: "/reference/formats/" },
          { text: "Terminal API", link: "/api/terminal" },
          { text: "Backend API", link: "/api/backend" },
          { text: "Cell & Types", link: "/api/cell" },
          { text: "Matchers", link: "/api/matchers" },
        ],
      },
      {
        text: "Advanced",
        items: [
          { text: "Cross-Backend Conformance", link: "/advanced/compat-matrix" },
          { text: "Silvery Integration", link: "/advanced/silvery-integration" },
        ],
      },
      {
        text: "Links",
        items: [
          { text: "Terminfo.dev", link: "https://terminfo.dev" },
          { text: "GitHub", link: "https://github.com/beorn/termless" },
          { text: "npm", link: "https://www.npmjs.com/package/termless" },
        ],
      },
    ],

    sidebar: [
      {
        text: "Concepts",
        items: [
          { text: "Overview", link: "/concepts/overview" },
          { text: "Backend", link: "/concepts/backend" },
          { text: "Terminal", link: "/concepts/terminal" },
          { text: "Recording", link: "/concepts/recording" },
        ],
      },
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Terminal Model", link: "/guide/terminal-model" },
        ],
      },
      {
        text: "Testing",
        items: [
          { text: "Writing Tests", link: "/guide/writing-tests" },
          { text: "Screenshots", link: "/guide/screenshots" },
          { text: "Best Practices", link: "/guide/best-practices" },
        ],
      },
      {
        text: "Backends",
        items: [
          { text: "Backend Capabilities", link: "/guide/backends" },
          { text: "Multi-Backend Testing", link: "/guide/multi-backend" },
          { text: "Cross-Backend Conformance", link: "/advanced/compat-matrix" },
          { text: "Terminal Census", link: "/census" },
        ],
      },
      {
        text: "Recording",
        items: [
          { text: "Recording Sessions", link: "/guide/recording-sessions" },
          { text: "Tracing Visual Bugs", link: "/guide/tracing-visual-bugs" },
          { text: "Web Player", link: "/guide/web-player" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI", link: "/reference/cli" },
          { text: "MCP Server", link: "/reference/mcp" },
        ],
      },
      {
        text: "Recording Formats",
        items: [
          { text: "Overview", link: "/reference/formats/" },
          { text: ".tape", link: "/reference/formats/tape" },
          { text: ".cast", link: "/reference/formats/asciicast" },
          { text: ".rec", link: "/reference/formats/rec" },
        ],
      },
      {
        text: "API Reference",
        items: [
          { text: "Terminal", link: "/api/terminal" },
          { text: "Backend", link: "/api/backend" },
          { text: "Cell & Types", link: "/api/cell" },
          { text: "Matchers", link: "/api/matchers" },
        ],
      },
      {
        text: "Matcher Reference",
        collapsed: true,
        items: [
          { text: "Overview", link: "/matchers/" },
          { text: "toHaveAttrs", link: "/matchers/to-have-attrs" },
          { text: "toHaveCursor", link: "/matchers/to-have-cursor" },
          { text: "toContainText", link: "/matchers/to-contain-text" },
          { text: "toContainOutput", link: "/matchers/to-contain-output" },
          { text: "toHaveText", link: "/matchers/to-have-text" },
          { text: "toMatchLines", link: "/matchers/to-match-lines" },
          { text: "toBeBold", link: "/matchers/to-be-bold" },
          { text: "toBeItalic", link: "/matchers/to-be-italic" },
          { text: "toBeDim", link: "/matchers/to-be-dim" },
          { text: "toBeStrikethrough", link: "/matchers/to-be-strikethrough" },
          { text: "toBeInverse", link: "/matchers/to-be-inverse" },
          { text: "toBeWide", link: "/matchers/to-be-wide" },
          { text: "toHaveUnderline", link: "/matchers/to-have-underline" },
          { text: "toHaveFg", link: "/matchers/to-have-fg" },
          { text: "toHaveBg", link: "/matchers/to-have-bg" },
          { text: "toHaveCursorAt", link: "/matchers/to-have-cursor-at" },
          { text: "toHaveCursorStyle", link: "/matchers/to-have-cursor-style" },
          { text: "toHaveCursorVisible", link: "/matchers/to-have-cursor-visible" },
          { text: "toHaveCursorHidden", link: "/matchers/to-have-cursor-hidden" },
          { text: "toBeInMode", link: "/matchers/to-be-in-mode" },
          { text: "toHaveTitle", link: "/matchers/to-have-title" },
          { text: "toHaveScrollbackLines", link: "/matchers/to-have-scrollback-lines" },
          { text: "toBeAtBottomOfScrollback", link: "/matchers/to-be-at-bottom-of-scrollback" },
          { text: "toHaveClipboardText", link: "/matchers/to-have-clipboard-text" },
          { text: "toMatchTerminalSnapshot", link: "/matchers/to-match-terminal-snapshot" },
          { text: "toMatchSvgSnapshot", link: "/matchers/to-match-svg-snapshot" },
        ],
      },
      {
        text: "Advanced",
        items: [
          { text: "Silvery Integration", link: "/advanced/silvery-integration" },
          { text: "Emulator Differences", link: "/emulator-differences" },
        ],
      },
      {
        text: "More",
        items: [
          { text: "Recipes", link: "/guide/recipes" },
          { text: "FAQ", link: "/guide/faq" },
          { text: "Comparison", link: "/guide/comparison" },
          { text: "Why Termless?", link: "/why" },
        ],
      },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/beorn/termless" }],

    outline: { level: [2, 3] },

    search: {
      provider: "local",
    },

    footer: {
      message:
        'Results at <a href="https://terminfo.dev">terminfo.dev</a> · Tests TUIs built with <a href="https://silvery.dev">Silvery</a>',
      copyright: 'Built by <a href="https://beorn.codes">Bjørn Stabell</a>',
    },
  },
})
