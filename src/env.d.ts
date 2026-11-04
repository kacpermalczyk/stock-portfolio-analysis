declare namespace App {
  interface Locals {
    user: import("@/lib/auth").OwnerUser | null;
  }
}

// `astro:env/server` types are generated from the schema in astro.config.mjs.
