//
// A consumer's plugin configuration. Each entry REPLACES the framework's entry of the same
// name, whole — which is why the test asserts that `cors` comes back as `false` here and not
// as the framework's default options object.
//
export default [
  { name: 'cors', enable: false, options: {} },
  { name: 'helmet', enable: true, options: { global: false } },
  { name: 'somethingOfOurOwn', enable: true, options: { mine: true } }
]
