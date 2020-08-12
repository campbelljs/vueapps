const path = require("path");
const fs = require("fs-extra");

const webpack = require("webpack");
const merge = require("webpack-merge");
const { exec } = require("child_process");

// const glob = require("glob");
// const parseGitignore = require("parse-gitignore");
const { hashElement } = require("folder-hash");

function installDeps(projectDir) {
  return new Promise((resolve, reject) => {
    exec("npm install --dev", { cwd: projectDir }, (error, stdout, stderr) => {
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

    let vueappConfig = {
      historyApiFallback: false,
      installDependencies: true,
    };
    let buildDir = path.resolve(
      this.$vueapps.buildDir,
      route.replace(/^\//, "")
    );
    let id = route;

    let vueappConfigPath = path.resolve(src, "vueapp.config.js");
    if (fs.pathExistsSync(vueappConfigPath)) {
      vueappConfig = merge(vueappConfig, require(vueappConfigPath));
    }

    let build = async () => {
      if (vueappConfig.installDependencies) {
        logger.verbose(`vueapps: [${id}] installing dependencies`);
        await installDeps(src);
        logger.verbose(`vueapps: [${id}] dependencies installed`);
      } else {
        logger.verbose(
          `vueapps: [${id}] skipping the installation of dependencies`
        );
      }

      let getWebpackConfig = () => {
        let VUE_CLI_CONTEXT = process.env.VUE_CLI_CONTEXT;
        let CAMPBELL_VUEAPPS_OUTPUT_DIR =
          process.env.CAMPBELL_VUEAPPS_OUTPUT_DIR;
        // set env (needed to make sure vue.config.js is loaded)
        process.env.VUE_CLI_CONTEXT = src;
        process.env.CAMPBELL_VUEAPPS_OUTPUT_DIR = buildDir;
        let webpackConfig = require(path.resolve(
          src,
          "node_modules/@vue/cli-service/webpack.config.js"
        ));

        // reset env var
        process.env.VUE_CLI_CONTEXT = VUE_CLI_CONTEXT;
        process.env.CAMPBELL_VUEAPPS_OUTPUT_DIR = CAMPBELL_VUEAPPS_OUTPUT_DIR;

        // override config

        webpackConfig = merge(webpackConfig, {
          output: {
            path: buildDir,
            publicPath: route + (route === "/" ? "" : "/"),
          },
          context: src,
          resolve: {
            modules: ["node_modules", ...module.paths],
          },
        });

        if (isDev) {
          // hot middleware
          webpackConfig = merge(webpackConfig, {
            plugins: [new webpack.HotModuleReplacementPlugin()],
          });
          Object.keys(webpackConfig.entry).forEach((entry) => {
            webpackConfig.entry[entry].unshift(
              `webpack-hot-middleware/client?path=/vueapps_hot${route}`
            );
          });
        }
        return webpackConfig;
      };
      let webpackConfig = getWebpackConfig();

      let compiler = webpack(webpackConfig);

      await new Promise((resolve, reject) => {
        compiler.hooks.done.tap("VueApps", () => {
          resolve();
          logger.verbose(`vueapps: [${id}] compilation done`);
        });

        let { historyApiFallback } = vueappConfig;
        if (historyApiFallback) {
          this.server.middlewares
            .before("vueapps-static")
            .use(route, historyApiFallbackMiddleware);
        }

        if (isDev) {
          // dev middleware
          this.server.middlewares
            .use(
              route,
              require("webpack-dev-middleware")(compiler, {
                stats: "minimal",
              })
            )
            .as(`vueapp:${id}`);
          this.server.middlewares
            .use(
              require("webpack-hot-middleware")(compiler, {
                path: `/vueapps_hot${route}`,
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
    };

    let app = { id, src, route, build };

    if (this.$vueapps.apps[id])
      throw new Error(`VueApps conflict : many apps at route ${route}`);
    else this.$vueapps.apps[id] = app;

    let setHash = async () => {
      // glob("**/.gitignore", function(er, files) {
      //   console.log(files);
      // });
      const { hash } = await hashElement(src, {
        files: {
          ignoreRootName: true,
        },
        folders: {
          ignoreRootName: true,
          exclude: ["node_modules"],
        },
      });

      this.$vueapps.apps[id].hash = hash;
    };
    this.hooks["build:before"].tapPromise(`VueApps:${id}`, setHash);
  },
};
