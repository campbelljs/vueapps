## Documentation

> **WARNING**: loaders using cwd might need to be configured manually (we already patch babel-loader and eslint-loader)

### Usage

The build plugin will look for dirs ending with .vueapp in the public directory and automatically register vueapps with corresponding path

```js
// campbell.config.js
module.exports = {
  presets: [require("@campbell/vueapps/build/preset")],
  vueapps: {
    // here you can add vueapps manually
    apps: [
      {
        src: path.resolve(__dirname, "./vueapps/test-app"),
        route: "/vueapps/test"
      }
    ]
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
