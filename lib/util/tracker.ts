/* eslint-disable @typescript-eslint/no-explicit-any */
import dayjs from 'dayjs'
import type { FastifyRequest, FastifyReply } from '../../types/global.js'

export async function initialize(req: FastifyRequest, _reply: FastifyReply) {
  if (req.server['dataBaseManager'].isImplemented()) {
    const tc = getTrackingConfigIfEnabled(req)
    const allData = { ...req.parameters(), ...req.data() }

    if (tc) {
      try {
        if (allData && tc.entity && tc.primaryKey && tc.primaryKey in allData) {
          const key = allData[tc.primaryKey]
          req.trackingData = await req.server['dataBaseManager'].retrieveBy(tc.entity, key)
          if (log.t)
            log.trace(`Tracking changes: found id ${req.trackingData ? req.trackingData[tc.primaryKey] : null}`)
        }
      } catch (error) {
        log.error(`Tracking changes: error on ${tc.code}`)
        log.error(error)
      }
    }
  }
}

export async function track(req: FastifyRequest, _reply: FastifyReply, payload: any) {
  if (req.server['dataBaseManager'].isImplemented()) {
    const tc = getTrackingConfigIfEnabled(req)
    if (tc) {
      try {
        const contents: any[] = []
        const { entity, changeEntity } = tc
        const userId = req.user?.getId()
        const oldData = req.trackingData

        const status =
          req.method?.toUpperCase() === 'POST' ? 'create' : req.method?.toUpperCase() === 'DELETE' ? 'delete' : 'update'

        const id =
          tc.primaryKey && payload && tc.primaryKey in payload
            ? payload[tc.primaryKey]
            : tc.primaryKey && oldData && tc.primaryKey in oldData
            ? oldData[tc.primaryKey]
            : undefined

        if (!id) {
          log.error('Tracking changes: id / primary key not found')
          return
        }

        let addChange = false
        if (status === 'delete') {
          addChange = true
        } else {
          const fields = tc.fields?.includes || Object.keys(payload) || []
          const excludes: string[] = tc.fields?.excludes || []

          fields.forEach((field) => {
            if (!excludes.includes(field)) {
              const oldValue = oldData != null && field in oldData ? oldData[field] : undefined
              const newValue = payload != null && field in payload ? payload[field] : undefined
              if (newValue !== undefined && isFieldChanged(oldValue, newValue)) {
                contents.push({ key: field, old: oldValue, new: newValue })
                addChange = true
              }
            }
          })
        }

        if (addChange) {
          if (log.t) log.trace(`Tracking changes: add ${changeEntity} for ${entity}, ${id}, ${userId}, ${status}`)
          await req.server['dataBaseManager'].addChange(entity, id, status, userId, contents, changeEntity)
        }
      } catch (error) {
        log.error(`Tracking changes: error on ${tc.code}`)
        log.error(error)
      }
    }
  }
}

function getTrackingConfigIfEnabled(req) {
  try {
    const code = `${req.method?.toUpperCase()}::${req.routeOptions?.config?.url || req.routeConfig?.url || req.url}`
    return code in global.tracking && global.tracking[code].enable ? { code, ...global.tracking[code] } : null
  } catch (error) {
    log.error(error)
  }
}

function isFieldChanged(oldValue, newValue) {
  if ((oldValue instanceof Date || newValue instanceof Date) && oldValue != null && newValue != undefined) {
    return !dayjs(oldValue).isSame(dayjs(newValue))
  }

  if ((oldValue instanceof Object || newValue instanceof Object) && oldValue != null && newValue != undefined) {
    const primaryKey = global.trackingConfig?.primaryKey
    const oldId =
      oldValue != null && primaryKey in oldValue
        ? oldValue[primaryKey]
        : typeof oldValue === 'string'
        ? oldValue
        : undefined
    const newId =
      newValue != null && primaryKey in newValue
        ? newValue[primaryKey]
        : typeof newValue === 'string'
        ? newValue
        : undefined
    return oldId !== undefined && newId !== undefined ? oldId != newId : false
  }

  return oldValue != newValue
}
