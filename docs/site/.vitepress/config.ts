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

  title: "termless",
  description:
    "Headless terminal testing — like Playwright, but for terminal apps. Write tests once, run against any backend.",
  base: "/termless/",

  head: [["link", { rel: "icon", href: "/termless/favicon.ico" }]],

  themeConfig: {
    siteTitle: "termless",

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API", link: "/api/terminal" },
      {
        text: "Advanced",
        items: [
          { text: "Cross-Backend Conformance", link: "/advanced/compat-matrix" },
          { text: "inkx Integration", link: "/advanced/inkx-integration" },
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

    sidebar: {
      "/guide/": [
        {
          text: "Introduction",
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
            { text: "Multi-Backend Testing", link: "/guide/multi-backend" },
          ],
        },
        {
          text: "Tools",
          items: [{ text: "CLI & MCP Server", link: "/guide/cli" }],
        },
        {
          text: "Advanced",
          collapsed: false,
          items: [
            { text: "Cross-Backend Conformance", link: "/advanced/compat-matrix" },
            { text: "inkx Integration", link: "/advanced/inkx-integration" },
          ],
        },
      ],
      "/api/": [
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
          text: "Guide",
          collapsed: false,
          items: [
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Writing Tests", link: "/guide/writing-tests" },
            { text: "Screenshots", link: "/guide/screenshots" },
          ],
        },
      ],
      "/advanced/": [
        {
          text: "Advanced",
          items: [
            { text: "Cross-Backend Conformance", link: "/advanced/compat-matrix" },
            { text: "inkx Integration", link: "/advanced/inkx-integration" },
          ],
        },
        {
          text: "Guide",
          collapsed: false,
          items: [
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Writing Tests", link: "/guide/writing-tests" },
            { text: "Multi-Backend Testing", link: "/guide/multi-backend" },
          ],
        },
      ],
    },

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
