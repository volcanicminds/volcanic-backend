//
// `TRUSTED_PROXIES`: who may tell the server the client's address.
//
// What is worth pinning is both directions. Behind a proxy that is not trusted, every client has
// the proxy's address and shares one rate limit; a forwarded header trusted from anyone lets a
// client choose the address its limit counts.
//
import { expect } from 'expect'
import fastify from 'fastify'
import { trustedProxies } from '../../lib/util/proxies.js'

const PROXY = '10.0.0.5'
const CLIENT = '203.0.113.7'

async function ipSeen(trustProxy: string[] | false, remoteAddress: string, forwardedFor?: string): Promise<string> {
  const server = fastify({ trustProxy })
  server.get('/ip', async (req) => ({ ip: req.ip }))
  try {
    const res = await server.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress,
      headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}
    })
    return res.json().ip
  } finally {
    await server.close()
  }
}

describe('util/proxies · TRUSTED_PROXIES', () => {
  it('is off when unset or blank', () => {
    expect(trustedProxies(undefined)).toBe(false)
    expect(trustedProxies('')).toBe(false)
    expect(trustedProxies(' , ')).toBe(false)
  })

  it('takes addresses and CIDR ranges, IPv4 and IPv6, trimmed', () => {
    expect(trustedProxies(' 10.0.0.5 , 172.16.0.0/12,::1, fd00::/8')).toEqual(['10.0.0.5', '172.16.0.0/12', '::1', 'fd00::/8'])
  })

  it('refuses an entry that is not an address or a range, so a typo stops the boot', () => {
    expect(() => trustedProxies('10.0.0.5,proxy.local')).toThrow("TRUSTED_PROXIES: 'proxy.local' is not an IP address or a CIDR range")
    expect(() => trustedProxies('true')).toThrow('is not an IP address')
    expect(() => trustedProxies('10.0.0.0/8/1')).toThrow('is not an IP address')
  })

  it('refuses a prefix length the address family cannot have', () => {
    expect(() => trustedProxies('10.0.0.0/33')).toThrow("TRUSTED_PROXIES: '10.0.0.0/33' has an invalid prefix length")
    expect(() => trustedProxies('fd00::/129')).toThrow('has an invalid prefix length')
    expect(() => trustedProxies('10.0.0.0/x')).toThrow('has an invalid prefix length')
  })

  it('reads the client from X-Forwarded-For when the request comes from a listed proxy', async () => {
    expect(await ipSeen(trustedProxies(PROXY), PROXY, CLIENT)).toBe(CLIENT)
    expect(await ipSeen(trustedProxies('10.0.0.0/8'), PROXY, CLIENT)).toBe(CLIENT)
  })

  it('ignores X-Forwarded-For from an address not listed', async () => {
    expect(await ipSeen(trustedProxies(PROXY), '198.51.100.9', CLIENT)).toBe('198.51.100.9')
  })

  it('ignores X-Forwarded-For when unset, so a client cannot pick its own address', async () => {
    expect(await ipSeen(trustedProxies(undefined), PROXY, CLIENT)).toBe(PROXY)
  })
})
