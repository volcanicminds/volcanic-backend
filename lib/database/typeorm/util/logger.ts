export function trace(data) {
  if (global.isLoggingEnabled && global.log?.trace) {
    global.log.trace(data)
  }
}

export function debug(data) {
  if (global.isLoggingEnabled && global.log?.debug) {
    global.log.debug(data)
  }
}

export function info(data) {
  if (global.isLoggingEnabled && global.log?.info) {
    global.log.info(data)
  }
}

export function warn(data) {
  if (global.isLoggingEnabled && global.log?.warn) {
    global.log.warn(data)
  }
}

export function error(data) {
  if (global.isLoggingEnabled && global.log?.error) {
    global.log.error(data)
  }
}

export function fatal(data) {
  if (global.isLoggingEnabled && global.log?.fatal) {
    global.log.fatal(data)
  }
}
