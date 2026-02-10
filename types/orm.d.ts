export interface VQuery {
  page?: number
  pageSize?: number
  take?: number
  skip?: number
  sort?: string[] | string
  _logic?: string
  [key: string]: unknown
}

export interface VHeaders {
  'v-count': number
  'v-total': number
  'v-page': number
  'v-pageSize': number
  'v-pageCount': number
}

export interface VFindResult<T> {
  records: T[]
  headers: VHeaders
}
