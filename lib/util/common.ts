/* eslint-disable @typescript-eslint/no-explicit-any */
import { FastifyRequest } from 'fastify'
import type { Data } from '../../types/global.js'

/**
 * Copy of `obj` without the keys whose value is `undefined`.
 *
 * `null` is kept on purpose: in a body it is a value ("clear this field"), and dropping it
 * would silently turn a clear into a no-op. `undefined` is not a value JSON can carry, so a
 * key holding it says nothing and must not win over the other source.
 */
function defined(obj: any): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj || {})) {
    if (typeof obj[key] !== 'undefined') out[key] = obj[key]
  }
  return out
}

/**
 * Query string and body merged into one bag, **the body winning** on a key present in both.
 *
 * The body wins because it is the payload of the request, while the query string is
 * addressing: when a caller sends both, the one they meant to send is the body. Callers that
 * need one source without the other have `queryData()` and `bodyData()`.
 */
export function getData(req: FastifyRequest): Data {
  if (!req) return {}
  return { ...defined(req.query), ...defined(req.body) } as Data
}

/** Only the query string, for a route that must not read the body. */
export function getQueryData(req: FastifyRequest): Data {
  if (!req) return {}
  return { ...defined(req.query) } as Data
}

/** Only the body, for a route that must not be steerable from the URL. */
export function getBodyData(req: FastifyRequest): Data {
  if (!req) return {}
  return { ...defined(req.body) } as Data
}

export function getParams(req: FastifyRequest): Data {
  if (!req) return {}
  const data: any = req.params || {}
  return !data ? ({} as Data) : { ...data }
}
