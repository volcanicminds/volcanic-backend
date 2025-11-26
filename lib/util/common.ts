import { FastifyRequest } from 'fastify'
import type { Data } from '../../types/global.js'

export function getData(req: FastifyRequest): Data {
  if (!req) return {}

  const hasValues = (obj) => Object.values(obj || {}).some((v) => v !== null && typeof v !== 'undefined')
  const data: any = hasValues(req.query) ? req.query : hasValues(req.body) ? req.body : null
  return !data ? ({} as Data) : { ...data }
}

export function getParams(req: FastifyRequest): Data {
  if (!req) return {}
  const data: any = req.params || {}
  return !data ? ({} as Data) : { ...data }
}
