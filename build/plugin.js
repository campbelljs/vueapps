const path = require("path");
const fs = require("fs-extra");

const crypto = require("crypto");

const webpack = require("webpack");
const { exec } = require("child_process");
const WebpackBar = require("webpackbar");

const glob = require("glob");
const gitignoreToGlob = require("gitignore-to-glob");
const { hashElement } = require("folder-hash");

async function getVueApps(base, vueAppsInfos) {
  if (!path.isAbsolute(base))
    throw new TypeError(`base must be an absolute path: ${base} isn't`);
  return await new Promise((resolve, reject) => {
    glob("**/*.vueapp", { cwd: base }, (err, res) => {
      if (err) reject(err);
      else
        resolve(
          res.map(
            (src) =>
              new VueApp({
                ...vueAppsInfos,
                base,
                src: path.resolve(base, src),
              })
          )
        );
    });
  });
}

class VueApp {
  constructor({
    manifest,
    VUEAPPS_OUTPUT,
    isDev,
    base,
    src,
    route,
    ...config
  } = {}) {
    // resolve route and src
    this.route = route;
    if (!path.isAbsolute(src)) {
      throw new TypeError(`src must be an absolute path. "${src}" isn't`);
    } else this.src = src;
    if (!this.route) {
      // parse route from route from base and src
      if (!base)
        throw new Error("Can't determine route, please specify a base option");
      if (!path.isAbsolute(base))
        throw new TypeError(`base must be an absolute path. "${bases}" isn't`);
      const relative = path.relative(base, src);
      if (
        !(relative && !relative.startsWith("..") && !path.isAbsolute(relative))
      )
        throw new Error(`base (${base}) must be a parent of src (${src})`);
      let _route = path
        .relative(base, src.replace(/\.vueapp$/, ""))
        .split(path.sep);
      if (_route.length && _route[_route.length - 1] === "index") _route.pop();
      _route = _route.map((el) => (/^_/.test(el) ? el.replace(/^_/, ":") : el));
      this.route = "/" + _route.join("/");
    }

    this.isDev = !!isDev;

    this.id = crypto
      .createHash("sha1")
      .update(`${this.route}:${this.src}`)
      .digest("hex")
      .slice(0, 8);

    this.cached = {};
    if (this.id in manifest) Object.assign(this.cached, manifest[this.id]);

    this.outputDir = path.resolve(VUEAPPS_OUTPUT, this.id);

    this.config = {
      historyApiFallback: false,
      installDependencies: true,
    };

    const configFile = path.resolve(this.src, "vueapp.config.js");
    if (fs.pathExistsSync(configFile)) {
      this.injectConfig(require(configFile));
    }
    this.injectConfig(config);
  }
  injectConfig(config) {
    Object.assign(this.config, config);
  }
  async prepare() {
    const { id, src, route, isDev, outputDir } = this;

    if (this.config.installDependencies) {
      if (this.cached.hash && this.cached.hash === (await this.getHash())) {
        // no need to generate hash once again
        this.hash = this.cached.hash;
        this.debug(
          "hash didn't changed, skipping the installation of dependencies"
        );
      } else {
        this.debug("installing dependencies ...");
        await this.installDependencies();
        this.debug("dependencies installed");
      }
    }
    // hash may already been calculated above
    if (!this.hash) {
      this.debug("generating hash...");
      this.hash = await this.getHash();
      this.debug(`hash generated: ${this.hash}`);
    }

    const vueCLIService = new (require(path.resolve(
      src,
      "node_modules/@vue/cli-service/lib/Service"
    )))(src);
    vueCLIService.init(process.env.NODE_ENV);
    // tweak settings
    vueCLIService.projectOptions.outputDir = outputDir;
    vueCLIService.projectOptions.publicPath =
      route + (route === "/" ? "" : "/");

    const chainableWebpackConfig = vueCLIService.resolveChainableWebpackConfig();
    const configName = `vueapp-${this.id}`;
    chainableWebpackConfig.name(configName);
    // fix babel cwd
    chainableWebpackConfig.module
      .rule("js")
      .use("babel-loader")
      .loader("babel-loader")
      .tap((options) => ({ ...options, cwd: src }));
    // fix eslint cwd
    chainableWebpackConfig.module
      .rule("eslint")
      .use("eslint-loader")
      .loader("eslint-loader")
      .tap((options) => ({ ...options, cwd: src }));
    chainableWebpackConfig
      .plugin("WebpackBar")
      .use(WebpackBar, [{ name: `${id} (${route})` }]);
    chainableWebpackConfig.plugin("friendly-errors").tap((prevArgs) => {
      const args = [...prevArgs];
      args[0].clearConsole = false;
      return args;
    });

    if (isDev) {
      chainableWebpackConfig
        .plugin("hmr")
        .use(require("webpack/lib/HotModuleReplacementPlugin"));

      // https://github.com/webpack/webpack/issues/6642
      // https://github.com/vuejs/vue-cli/issues/3539
      chainableWebpackConfig.output.globalObject(
        `(typeof self !== 'undefined' ? self : this)`
      );

      const entries = Array.from(
        chainableWebpackConfig.entryPoints.store.keys()
      );
      entries.forEach((entryName) => {
        const entry = chainableWebpackConfig.entry(entryName);
        const sources = [
          // TODO: maybe we shoudl make the path specific to the VueApp instance

          `${path.dirname(
            require.resolve("webpack-hot-middleware")
          )}/client?path=/__campbell_vueapps_hot&name=${configName}`,
        ];
        entry.store.forEach((src) => sources.push(src));
        entry.clear();
        sources.forEach((src) => entry.add(src));
      });
    }

    const webpackConfig = vueCLIService.resolveWebpackConfig(
      chainableWebpackConfig
    );

    this.webpackConfig = webpackConfig;
  }
  async getHash() {
    // FIXME: this can take about 2500 ms
    const gitignoreSources = await new Promise((resolve, reject) => {
      glob("**/.gitignore", { cwd: this.src, absolute: true }, (err, res) => {
        if (err) reject(err);
        else resolve(res);
      });
    });
    const ignore = [];
    gitignoreSources.forEach((src) =>
      ignore.push(
        ...gitignoreToGlob(src).map((pattern) => pattern.replace(/^!/, ""))
      )
    );
    const res = await hashElement(this.src, {
      files: {
        ignoreRootName: true,
        exclude: ignore,
        matchPath: true,
      },
      folders: {
        ignoreRootName: true,
        exclude: ignore,
        matchPath: true,
      },
    });

    return res.hash;
  }
  async installDependencies() {
    return await new Promise((resolve, reject) => {
      exec("npm install", { cwd: this.src }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }
  debug(...args) {
    console.log(`vueapps: [${this.id} | ${this.route}]`, ...args);
  }
}

module.exports = {
  hooks: {
    build: async function (builder) {
      const VUEAPPS_OUTPUT = path.resolve(
        builder.resolvePath("#output"),
        "vueapps"
      );
      const isDev = builder.isDev;
      await fs.ensureDir(VUEAPPS_OUTPUT);
      if (!isDev) await fs.emptyDir(VUEAPPS_OUTPUT);
      const manifestPath = path.resolve(VUEAPPS_OUTPUT, "manifest.json");
      const manifest = (await fs.pathExists(manifestPath))
        ? await fs.readJson(manifestPath)
        : {};
      async function saveManifest() {
        await fs.outputJson(manifestPath, manifest);
      }

      const vueAppsInfos = {
        manifest,
        VUEAPPS_OUTPUT,
        isDev,
      };
      const vueapps = [];
      if ("vueapps" in builder.config) {
        if ("apps" in builder.config.vueapps) {
          vueapps.push(
            ...Array.from(builder.config.vueapps.apps).map(
              (opts) =>
                new VueApp({
                  ...vueAppsInfos,
                  ...opts,
                })
            )
          );
        }
      }
      vueapps.push(
        ...(await getVueApps(builder.resolvePath("#public"), vueAppsInfos))
      );

      // stop if no vueapps
      if (!vueapps.length) return;

      await Promise.all(vueapps.map((v) => v.prepare()));
      vueapps.forEach((app) => {
        const { hash, route } = app;
        const { historyApiFallback } = app.config;
        manifest[app.id] = {
          id: app.id,
          hash,
          route,
          historyApiFallback,
        };
      });
      await saveManifest();
      const compiler = webpack(vueapps.map((v) => v.webpackConfig));
      if (builder.isDev) {
        const middlewares = {};
        // FIXME: this needs a trailing slash to resolve the app
        // FIXME: historyApiFallback should be handled in dev mode too
        middlewares.dev = require("webpack-dev-middleware")(compiler, {
          stats: {
            ...webpack.Stats.presetToOptions("minimal"),
          },
        });
        middlewares.hot = require("webpack-hot-middleware")(compiler, {
          path: "/__campbell_vueapps_hot",
        });
        // compilation will be handled by webpack-dev-middleware
        global.__CAMPBELL_VUEAPPS__ = {
          middlewares,
          manifest,
        };
      } else {
        // run compilation
        await new Promise((resolve, reject) => {
          compiler.run((err, stats) => {
            if (err) reject(err);
            else {
              if (stats.hasErrors()) {
                console.error(
                  stats.toString({
                    colors: true,
                  })
                );
                reject(new Error("vueapps compilation failed"));
              } else {
                console.log(stats.toString("minimal"));
                resolve();
              }
            }
          });
        });
        console.log("\nvueapps: every app compiled successfully\n");
      }
    },
  },
};
