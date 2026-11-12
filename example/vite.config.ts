import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Until api.queria.io is available, serve /v1/datasets/{handle}/{name} from the queria.io catalog API. */
const datasetsApi = (): Plugin => ({
  name: "datasets-api",
  configureServer: (server) => {
    server.middlewares.use("/v1/datasets", (req, res, next) => {
      fetch(`https://queria.io/api/catalog/datasets${req.url}`)
        .then(async (upstream) => {
          const body = (await upstream.json()) as { dataset?: unknown };
          res.statusCode = upstream.status;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(body.dataset ?? body));
        })
        .catch(next);
    });
  },
});

export default defineConfig({ root: "example", plugins: [react(), datasetsApi()] });
