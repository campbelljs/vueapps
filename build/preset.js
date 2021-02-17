const path = require("path");

module.exports = config => {
  if (!("vueapps" in config)) {
    config.vueapps = [];
  }
  config.plugins.push(path.resolve(__dirname, "plugin"));
  config.injectPlugins.push(path.resolve(__dirname, "..", "lib"));
};
