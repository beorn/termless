import { defineConfig } from "vitepress"
import llmstxt from "vitepress-plugin-llms"
import { glossaryPlugin, seoHead, seoTransformPageData, validateGlossary } from "@bearly/vitepress-enrich"
import glossary from "../content/glossary.json"

const seoOptions = {
  hostname: "https://termless.dev",
  siteName: "Termless",
  description: "Headless terminal testing for every backend",
  ogImage: "https://termless.dev/og-image.svg",
  author: "Bjørn Stabell",
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
      noExternal: ["@bearly/vitepress-enrich"],
    },
  },

  title: "Termless",
  description:
    "Headless terminal testing — like Playwright, but for terminal apps. Write tests once, run against any backend.",
  base: "/",
  lastUpdated: true,

  sitemap: { hostname: "https://termless.dev" },

  markdown: {
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
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API", link: "/api/terminal" },
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
        text: "Tools",
        items: [{ text: "CLI & MCP Server", link: "/guide/cli" }],
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
          { text: "toContainText", link: "/matchers/to-contain-text" },
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
