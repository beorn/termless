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

  head: [["link", { rel: "icon", type: "image/svg+xml", href: "/logo.svg" }]],

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
      message: "Released under the MIT License.",
      copyright: "Copyright © 2025-present",
    },
  },
})
