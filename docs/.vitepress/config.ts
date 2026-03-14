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

    sidebar: {
      "/guide/": [
        {
          text: "Get Started",
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
            { text: "Multi-Backend Testing", link: "/guide/multi-backend" },
            { text: "Backend Capabilities", link: "/guide/backend-capabilities" },
            { text: "Cross-Backend Conformance", link: "/advanced/compat-matrix" },
          ],
        },
        {
          text: "Tools",
          items: [{ text: "CLI & MCP Server", link: "/guide/cli" }],
        },
        {
          text: "Integrations",
          collapsed: false,
          items: [{ text: "Silvery Integration", link: "/advanced/silvery-integration" }],
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
            { text: "Best Practices", link: "/guide/best-practices" },
          ],
        },
      ],
      "/advanced/": [
        {
          text: "Advanced",
          items: [
            { text: "Cross-Backend Conformance", link: "/advanced/compat-matrix" },
            { text: "Silvery Integration", link: "/advanced/silvery-integration" },
          ],
        },
        {
          text: "Guide",
          collapsed: false,
          items: [
            { text: "Getting Started", link: "/guide/getting-started" },
            { text: "Writing Tests", link: "/guide/writing-tests" },
            { text: "Multi-Backend Testing", link: "/guide/multi-backend" },
            { text: "Backend Capabilities", link: "/guide/backend-capabilities" },
            { text: "Best Practices", link: "/guide/best-practices" },
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
