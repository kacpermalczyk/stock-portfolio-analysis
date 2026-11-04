// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      exclude: ["lightweight-charts"],
    },
  },
  adapter: cloudflare(),
  env: {
    schema: {
      OWNER_EMAIL: envField.string({ context: "server", access: "secret", optional: true }),
      OWNER_PASSWORD_HASH: envField.string({ context: "server", access: "secret", optional: true }),
      SESSION_SECRET: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
