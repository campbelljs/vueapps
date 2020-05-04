const path = require("path");
const fs = require("fs-extra");
const express = require("express");

module.exports = {
  name: "vueapps",
  async install() {
    let buildDir = path.resolve(this.getDir("build"), ".vueapps");
    await fs.ensureDir(buildDir);
    await fs.emptyDir(buildDir);

    this.$vueapps = {
      buildDir,
      apps: {}
    };
    let $vueapps = this.$vueapps;

    // add hook
    this.hooks["start:before"].tapPromise("VueApps", async function() {
      await Promise.all(Object.values($vueapps.apps).map(app => app.ready));
    });

    if (this.server) {
      this.server.loaders.push(require("./loader"));

      this.server.use(express.static(buildDir));
    }
  }
};
