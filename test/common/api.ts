/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-useless-catch */
import axios from 'axios'
const http = axios.create({ baseURL: `http://0.0.0.0:${process.env.PORT?.replace(/\\n/gm, '\n') || 2231}/` })

import { DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD } from '../common/bootstrap.js'

export async function login(email = DEFAULT_ADMIN_EMAIL, password = DEFAULT_ADMIN_PASSWORD) {
  try {
    delete http.defaults.headers.common.Authorization
    const { data } = await http.post('/auth/login', {
      email,
      password
    })
    http.defaults.headers.common['Authorization'] = `Bearer ${data.token}`
    return data
  } catch (err) {
    console.log(err)
    throw err
  }
}

export async function logout() {
  try {
    delete http.defaults.headers.common.Authorization
  } catch (err) {
    throw err
  }
}

export async function get(...args: any) {
  try {
    const { data } = await http.get(args[0], args[1])
    return data
  } catch (err) {
    throw err
  }
}

export async function get_with_headers(...args: any) {
  try {
    const { data, headers } = await http.get(args[0], args[1])
    return { data, headers }
  } catch (err) {
    throw err
  }
}

export async function post(...args: any) {
  try {
    const { data } = await http.post(args[0], args[1], args[2])
    return data
  } catch (err) {
    throw err
  }
}

export async function put(...args: any) {
  try {
    const { data } = await http.put(args[0], args[1], args[2])
    return data
  } catch (err) {
    throw err
  }
}

export async function del(...args: any) {
  try {
    const { data } = await http.delete(args[0], args[1])
    return data
  } catch (err) {
    throw err
  }
}

export function toQueryString(data: any) {
  let qs = ''
  Object.keys(data).map((k) => {
    qs += `&${k}=${data[k]}`
  })
  return qs.slice(1).replace(' ', '%20')
}
