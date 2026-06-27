// Consumer-app PLUGIN overrides (merged by name over the lib defaults). Enables
// the three plugins that ship OFF by default, so the fixture suite can exercise
// them: response compression, multipart parsing, and raw-body capture.
export default [
  { name: 'compress', enable: true, options: { threshold: 0 } }, // threshold 0 → even small responses compress
  { name: 'multipart', enable: true, options: {} },
  { name: 'rawBody', enable: true, options: {} }
]
