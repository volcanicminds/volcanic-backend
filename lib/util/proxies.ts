'use strict'

import { isIP } from 'node:net'

//
// Which proxies may tell the server who the client is.
//
// Behind a reverse proxy every request arrives from the proxy's address, so `req.ip` names the
// proxy and every per-IP limit counts all clients together. Fastify reads `X-Forwarded-For` only
// from the addresses given as `trustProxy`; from anyone else the header is a value the client
// wrote, and trusting it would let a client pick the IP its rate limit counts.
//
// So the list is explicit addresses and CIDR ranges, never `true`, and a malformed entry stops
// the boot: a typo must not silently trust nobody, nor somebody it did not name.
//

/** `TRUSTED_PROXIES` as Fastify's `trustProxy`: the listed addresses and ranges, or false when unset. */
export function trustedProxies(raw: string | undefined): string[] | false {
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (!entries.length) return false

  for (const entry of entries) {
    const [address, prefix, extra] = entry.split('/')
    const version = isIP(address)
    if (!version || extra !== undefined) {
      throw new Error(`TRUSTED_PROXIES: '${entry}' is not an IP address or a CIDR range`)
    }
    if (prefix === undefined) continue
    const bits = Number(prefix)
    if (!/^\d+$/.test(prefix) || bits > (version === 6 ? 128 : 32)) {
      throw new Error(`TRUSTED_PROXIES: '${entry}' has an invalid prefix length`)
    }
  }
  return entries
}
