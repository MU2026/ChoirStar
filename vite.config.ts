import { defineConfig } from "vite";
import { websiteBookmarklet } from "./src/website.ts";

// Serve the exact same self-contained exporter as the full desktop bookmarklet.
const helper = () =>
  decodeURIComponent(websiteBookmarklet().slice("javascript:".length));

export default defineConfig({
  plugins: [
    {
      name: "website-helper",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (
            request.url?.split("?")[0] !==
            `${server.config.base}website-helper.js`
          )
            return next();
          response.setHeader("Content-Type", "text/javascript; charset=utf-8");
          response.setHeader("Access-Control-Allow-Origin", "*");
          response.end(helper());
        });
      },
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "website-helper.js",
          source: helper(),
        });
      },
    },
  ],
});
