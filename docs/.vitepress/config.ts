import { defineConfig } from "vitepress"
import llmstxt from "vitepress-plugin-llms"

export default defineConfig({
  vite: {
    plugins: [
      llmstxt({
        // Auto-generates llms.txt and llms-full.txt at build time
      }),
    ],
  },

  title: "Termless",
  description:
    "Headless terminal testing — like Playwright, but for terminal apps. Write tests once, run against any backend.",
  base: "/",

  sitemap: { hostname: "https://termless.dev" },

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/logo.svg" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "Termless" }],
    ["meta", { name: "twitter:card", content: "summary" }],
    [
      "script",
      {
        defer: "",
        src: "https://static.cloudflareinsights.com/beacon.min.js",
        "data-cf-beacon": '{"token": "f8fcb4e438a34026a53adc961ef0968c"}',
      },
    ],
  ],

  transformPageData(pageData) {
    const title = pageData.title || "Termless"
    const description =
      pageData.description || "Headless terminal testing for every backend"
    pageData.frontmatter.head ??= []
    pageData.frontmatter.head.push(
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: description }],
      [
        "meta",
        {
          property: "og:url",
          content: `https://termless.dev/${pageData.relativePath.replace(/\.md$/, ".html").replace(/index\.html$/, "")}`,
        },
      ],
    )
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
        text: "Advanced",
        items: [
          { text: "Silvery Integration", link: "/advanced/silvery-integration" },
          { text: "Emulator Differences", link: "/emulator-differences" },
        ],
      },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/beorn/termless" }],

    outline: { level: [2, 3] },

    search: {
      provider: "local",
    },

    footer: {
      message: 'Feature matrix at <a href="https://terminfo.dev">Terminfo.dev</a>',
      copyright: "Copyright © 2025-present",
    },
  },
})
