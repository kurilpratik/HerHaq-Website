import { defineConfig } from "astro/config";
import netlify from "@astrojs/netlify";
import dotenv from "dotenv";

// Vite only exposes .env through import.meta.env, but the API routes and the
// reconcile script both read process.env so they can share one code path.
// This config runs in the same Node process as the dev server and the build,
// so loading .env here populates process.env for local runs. On Netlify there
// is no .env file and the real environment is already in process.env; dotenv
// does not override existing values, so deployed config always wins.
dotenv.config();

export default defineConfig({
  site: "https://herhaq.com",
  output: "server",
  adapter: netlify(),
});
