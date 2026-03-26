// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  output: "server",
  site: "https://altareen.com",
  integrations: [sitemap()],
  adapter: node({
    mode: "standalone",
    
  }),
});