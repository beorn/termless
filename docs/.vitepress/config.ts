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
    ["meta", { property: "og:image", content: "https://termless.dev/og-image.svg" }],
    ["meta", { name: "twitter:card", content: "summary" }],
    [
      "script",
      { type: "application/ld+json" },
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "Termless",
        url: "https://termless.dev",
        description: "Headless terminal testing for every backend",
      }),
    ],
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
    const description = pageData.description || "Headless terminal testing for every backend"
    const cleanPath = pageData.relativePath.replace(/\.md$/, ".html").replace(/index\.html$/, "")
    pageData.frontmatter.head ??= []
    pageData.frontmatter.head.push(
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: description }],
      [
        "meta",
        {
          property: "og:url",
          content: `https://termless.dev/${cleanPath}`,
        },
      ],
      [
        "link",
        {
          rel: "canonical",
          href: `https://termless.dev/${cleanPath}`,
        },
      ],
    )

    // JSON-LD BreadcrumbList
    const segments = cleanPath
      .replace(/\.html$/, "")
      .split("/")
      .filter(Boolean)
    if (segments.length > 0) {
      const breadcrumbItems = [{ "@type": "ListItem", position: 1, name: "Home", item: "https://termless.dev/" }]
      for (let i = 0; i < segments.length; i++) {
        const path = segments.slice(0, i + 1).join("/")
        const name = segments[i].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
        breadcrumbItems.push({
          "@type": "ListItem",
          position: i + 2,
          name: pageData.title && i === segments.length - 1 ? pageData.title : name,
          item: `https://termless.dev/${path}`,
        })
      }
      pageData.frontmatter.head.push([
        "script",
        { type: "application/ld+json" },
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: breadcrumbItems,
        }),
      ])
    }
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
