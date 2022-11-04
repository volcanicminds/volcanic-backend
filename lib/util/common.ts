import { FastifyRequest } from 'fastify'
import { Data } from '../../types/global'

export function getData(req: FastifyRequest): Data {
  if (!req) return {}

  const hasValues = (obj) => Object.values(obj || {}).some((v) => v !== null && typeof v !== 'undefined')
  const data: any = hasValues(req.query) ? req.query : hasValues(req.body) ? req.body : null
  return !data ? ({} as Data) : { ...data }
}
