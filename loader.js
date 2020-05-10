const path = require("path");
const fs = require("fs-extra");

const webpack = require("webpack");
const merge = require("webpack-merge");
const { exec } = require("child_process");

const { hashElement } = require("folder-hash");

function installDeps(projectDir) {
  return new Promise((resolve, reject) => {
    exec("npm install", { cwd: projectDir }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function historyApiFallbackMiddleware(req, res, next) {
  if (/^[^\.]*(\.html)?$/.test(req.path)) {
    req.url = "/index.html";
  }
  next();
}

module.exports = {
  test(src) {
    return /\.vueapp$/.test(src);
  },
  load({ src, route }) {
    const { logger, isDev } = this;
    let instance = this;

    let vueappConfig = {
      historyApiFallback: false
    };
    let vueappConfigPath = path.resolve(src, "vueapp.config.js");
    if (fs.pathExistsSync(vueappConfigPath)) {
      vueappConfig = merge(vueappConfig, require(vueappConfigPath));
    }

    let id = route;

    let VUE_CLI_CONTEXT = process.env.VUE_CLI_CONTEXT;
    // set env (needed to make sure vue.config.js is loaded)
    process.env.VUE_CLI_CONTEXT = src;
    let webpackConfig = require(path.resolve(
      src,
      "node_modules/@vue/cli-service/webpack.config.js"
    ));
    // reset env var
    process.env.VUE_CLI_CONTEXT = VUE_CLI_CONTEXT;

    // override config
    let buildDir = path.resolve(
      this.$vueapps.buildDir,
      route.replace(/^\//, "")
    );

    webpackConfig = merge(webpackConfig, {
      output: {
        path: buildDir,
        publicPath: route + (route === "/" ? "" : "/")
      },
      context: src,
      resolve: {
        modules: ["node_modules", ...module.paths]
      }
    });

    if (isDev) {
      // hot middleware
      webpackConfig = merge(webpackConfig, {
        plugins: [new webpack.HotModuleReplacementPlugin()]
      });
      Object.keys(webpackConfig.entry).forEach(entry => {
        webpackConfig.entry[entry].unshift(
          `webpack-hot-middleware/client?path=/vueapps_hot${route}`
        );
      });
    }
    let compiler = webpack(webpackConfig);

    async function build() {
      await installDeps(src);
      logger.verbose(`vueapps: [${id}] dependencies installed`);
      await new Promise((resolve, reject) => {
        compiler.hooks.done.tap("VueApps", () => {
          resolve();
        });

        let { historyApiFallback } = vueappConfig;
        if (historyApiFallback) {
          instance.server.middlewares
            .before("vueapps-static")
            .use(route, historyApiFallbackMiddleware);
        }

        if (isDev) {
          // dev middleware
          instance.server.middlewares
            .use(
              route,
              require("webpack-dev-middleware")(compiler, {
                stats: "minimal"
              })
            )
            .as(`vueapp:${id}`);
          instance.server.middlewares
            .use(
              require("webpack-hot-middleware")(compiler, {
                path: `/vueapps_hot${route}`
              })
            )
            .as(`vueapp:${id}:hot`);
        } else {
          compiler.run((err, stats) => {
            if (err) throw err;
            else {
              logger.verbose(stats.toString({ colors: true }));
            }
          });
        }
      });
      logger.verbose(`vueapps: [${id}] compilation done`);
    }

    this.hooks["build:before"].tapPromise(`VueApps:${id}`, async function() {
      const { hash } = await hashElement(src, {
        folders: {
          ignore: ["**/node_modules/**"]
        }
      });

      let app = { id, src, route, compiler, build, hash };

      if (instance.$vueapps.apps[id])
        throw new Error(`VueApps conflict : many apps at route ${route}`);
      else instance.$vueapps.apps[id] = app;

      return;
    });
  }
};
