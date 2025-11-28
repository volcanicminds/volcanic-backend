/* eslint-disable @typescript-eslint/no-explicit-any */
import { start } from './index.js'

// internal debug purpose
;(global as any).npmDebugServerStarted = true

start()
