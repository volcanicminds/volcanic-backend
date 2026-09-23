//
// T-12.40: a run with the network switched off, loaded with `--import` before the suites.
//
// Every connection that would leave the machine throws, and so does every name resolution, so a
// suite that reached a real provider fails instead of passing on whatever that provider answered.
// Loopback and Unix sockets stay open: a local database is not the network this is about.
//
import net from 'node:net'
import dns from 'node:dns'

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])

const refuse = (what) => {
  throw new Error(`no network in this run: ${what} was attempted`)
}

const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  // `net.connect` passes its normalised arguments as one array; a caller may pass options or a port.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]
  const options = first !== null && typeof first === 'object' ? first : { port: first, host: args[1] }
  if (!options.path && !LOOPBACK.has(options.host ?? 'localhost')) refuse(`a connection to ${options.host}:${options.port}`)
  return connect.apply(this, args)
}

const lookup = dns.lookup
dns.lookup = function (host, ...rest) {
  if (!LOOPBACK.has(host)) refuse(`a lookup of ${host}`)
  return lookup.call(this, host, ...rest)
}
const lookupPromise = dns.promises.lookup
dns.promises.lookup = function (host, ...rest) {
  if (!LOOPBACK.has(host)) return Promise.reject(new Error(`no network in this run: a lookup of ${host} was attempted`))
  return lookupPromise.call(this, host, ...rest)
}
