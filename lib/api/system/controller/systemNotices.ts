import { FastifyReply, FastifyRequest } from 'fastify'
import * as notices from '../../../util/notices.js'

export const find = (req: FastifyRequest, reply: FastifyReply) => notices.find(req, reply, 'control')

export const seen = (req: FastifyRequest, reply: FastifyReply) => notices.seen(req, reply, 'control')
