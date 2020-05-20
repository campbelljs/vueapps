const path = require("path");
const fs = require("fs-extra");
const express = require("express");

const _get = require("lodash/get");

module.exports = {
  name: "vueapps",
  async install() {
    const { isDev, logger } = this;

    let vueAppsDir = path.resolve(this.getDir("build"), "vueapps");
    let buildDir = path.resolve(vueAppsDir, "build");
    let cachePath = path.resolve(vueAppsDir, ".cache.json");

    await fs.ensureDir(vueAppsDir);
    if (isDev) await fs.emptyDir(vueAppsDir);

    await fs.ensureDir(buildDir);
    if (!(await fs.pathExists(cachePath))) {
      await fs.outputJson(cachePath, {});
    }

    let cache = await fs.readJson(cachePath);

    this.$vueapps = {
      buildDir,
      apps: {},
      cache,
    };
    let $vueapps = this.$vueapps;

    this.hooks["ui:configure-nuxt"].tap("VueApps", function (cfg) {
      if (!cfg.ignore) cfg.ignore = [];
      cfg.ignore.push("**/*.vueapp", "**/*.vueapp/**");
    });

    // add hook
    this.hooks["build"].tapPromise("VueApps", async function () {
      let apps = Object.values($vueapps.apps);
      await Promise.all(
        apps.map((app) =>
          (async () => {
            let prevHash = _get(cache, [app.id, "hash"]);
            if (prevHash !== app.hash) {
              await app.build();
            }
            if (!isDev) cache[app.id] = { hash: app.hash };
          })()
        )
      );

      await fs.writeJson(cachePath, cache);
      logger.info(`vueapps: built !`);
    });

    if (this.server) {
      this.server.loaders.push(require("./loader"));

      this.server.middlewares
        .use(express.static(buildDir, { extensions: ["html"] }))
        .as("vueapps-static");
    }
  },
};
