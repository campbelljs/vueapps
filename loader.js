const path = require("path");

const webpack = require("webpack");
const merge = require("webpack-merge");
const { exec } = require("child_process");

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

module.exports = {
  test(src) {
    return /\.vueapp$/.test(src);
  },
  load({ src, route }) {
    const { logger, isDev } = this;
    let instance = this;

    let webpackConfig = require(path.resolve(
      src,
      "node_modules/@vue/cli-service/webpack.config.js"
    ));
    // override config
    let buildDir = path.resolve(
      this.getDir("build"),
      ".vueapps",
      route.replace(/^\//, "")
    );

    webpackConfig = merge(webpackConfig, {
      // mode: "production",
      output: {
        path: buildDir,
        publicPath: route + "/"
      },
      context: src
    });

    if (isDev) {
      // hot middleware
      webpackConfig = merge(webpackConfig, {
        plugins: [new webpack.HotModuleReplacementPlugin()]
      });
      webpackConfig.entry.app.unshift(
        `webpack-hot-middleware/client?path=/vueapps_hot${route}`
      );
    }

    let compiler = webpack(webpackConfig);

    async function installAndCompile() {
      await installDeps(src);
      logger.verbose(`vueapps: [${route}] dependencies installed`);
      await new Promise((resolve, reject) => {
        compiler.hooks.done.tap("VueApps", () => {
          resolve();
        });

        if (isDev) {
          // dev middleware
          instance.server.middlewares
            .use(
              route,
              require("webpack-dev-middleware")(compiler, {
                stats: "minimal"
              })
            )
            .as(`vueapp:${route}`);
          instance.server.middlewares
            .use(
              require("webpack-hot-middleware")(compiler, {
                path: `/vueapps_hot${route}`
              })
            )
            .as(`vueapp:${route}:hot`);
        } else {
          compiler.run((err, stats) => {
            if (err) throw err;
            else {
              logger.verbose(stats.toString({ colors: true }));
            }
          });
        }
      });
      logger.verbose(`vueapps: [${route}] compilation done`);
    }

    let ready = installAndCompile();

    let app = { src, route, compiler, ready };
    if (this.$vueapps.apps[route])
      throw new Error(`VueApps conflict : many apps at route ${route}`);
    else this.$vueapps.apps[route] = app;
  }
};
