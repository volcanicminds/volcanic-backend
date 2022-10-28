'use strict'

export default function yn(value: any, defaultValue: boolean): boolean {
  if (value === undefined || value === null) {
    return defaultValue
  }

  const val = String(value).trim()

  if (/^(?:y|yes|true|1|on)$/i.test(val)) {
    return true
  }

  if (/^(?:n|no|false|0|off)$/i.test(val)) {
    return false
  }

  return defaultValue || false
}
