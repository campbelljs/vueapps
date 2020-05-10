## Documentation

> **WARNING**: files ignored by git could change the hash

> **WARNING**: Make sure to add this in vue.config.js (this might be handled by a vue cli plugin later)

```js
module.exports = {
  // @campbell/vueapps
  outputDir: process.env.CAMPBELL_VUEAPPS_OUTPUT_DIR,
  chainWebpack: config => {
    // fix babel cwd
    config.module
      .rule("js")
      .use("babel-loader")
      .loader("babel-loader")
      .tap(options => {
        return { ...options, cwd: __dirname };
      });
  }
};
```

you can add a vueapp.config.js file
in your app's root dir :

```js
module.exports = {
  historyApiFallback: true // default : false
};
```

> **WARNING**: HMR not working with historyApiFallback
