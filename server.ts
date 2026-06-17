/* eslint-disable @typescript-eslint/no-explicit-any */
import { start } from './index.js'

// internal debug purpose
;(global as any).npmDebugServerStarted = true

start().catch((err) => {
  // Known fatal config errors already call process.exit(1) before this point;
  // this guards every other startup failure from becoming an unhandled rejection.
  console.error('Fatal: server failed to start', err)
  process.exit(1)
})
