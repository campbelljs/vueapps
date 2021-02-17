const path = require("path");
const fs = require("fs-extra");

module.exports = {
  install(Campbell) {
    Campbell.appConfig.extendSchema({
      dir: {
        vueapps: {
          doc: "@campbell/vueapps's output dir",
          format: "dir",
          default: "./vueapps"
        }
      }
    });
  },
  app: {
    async beforeMount() {
      if (this.server) {
        if (
          false &&
          global.__CAMPBELL_VUEAPPS__ &&
          global.__CAMPBELL_VUEAPPS__.middlewares
        ) {
          const { dev, hot } = global.__CAMPBELL_VUEAPPS__.middlewares;
          this.server.middlewares.use(dev).as("vueapps:dev");
          this.server.middlewares.use(hot).as("vueapps:hot");
        } else {
          const createStaticMiddleware = require("serve-static");
          const createHistoryMiddleware = require("connect-history-api-fallback");
          const VUEAPPS_OUTPUT = this.$resolvePath("#vueapps");
          const manifestPath = path.resolve(VUEAPPS_OUTPUT, "manifest.json");
          if (await fs.pathExists(manifestPath)) {
            const manifest = await fs.readJson(manifestPath);
            for (var id in manifest) {
              const { route, historyApiFallback } = manifest[id];

              const staticMiddleware = createStaticMiddleware(
                path.resolve(VUEAPPS_OUTPUT, id)
              );
              let middleware;
              if (historyApiFallback) {
                const historyMiddleware = createHistoryMiddleware();
                middleware = (req, res, next) => {
                  historyMiddleware(req, res, () =>
                    staticMiddleware(req, res, next)
                  );
                };
              } else middleware = staticMiddleware;

              this.server.middlewares.use(route, middleware).as(`vueapp:${id}`);
            }
          }
        }
      } else {
        console.warn(`@campbell/vueapps needs @campbell/server to work`);
      }
    }
  }
};
