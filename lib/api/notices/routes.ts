//
// The notices of the tenant plane for whoever reads them: every `NoticeSource` registered on the
// plane is asked, each answers for the reader, and the framework keeps which ones the reader has
// seen. The control plane's are read at `/system/notices`.
//
// `notices` is reserved by both catalogues, one per plane, as `governance-log` is (lib/loader/roles.ts).
//
export default {
  config: {
    title: 'Notices',
    description: 'What the packages tell the administrators of this tenant',
    controller: 'controller',
    tags: ['notices'],
    version: false,
    // The console draws the notices on a page of its own, and the list is no list of rows.
    manifest: { exclude: true }
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      requireCapability: 'notices',
      handler: 'notices.find',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Read the notices',
        description: 'Every current notice of the tenant plane for the reader, seen or not, newest first, and the sources that failed',
        response: { 200: { $ref: 'noticeListSchema#' } }
      }
    },
    {
      method: 'POST',
      path: '/seen',
      requireCapability: 'notices',
      handler: 'notices.seen',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Mark notices seen',
        description: 'Ids as `<source>:<id>`, 1 to 100; an id its source does not serve now is ignored',
        body: { $ref: 'noticeSeenBodySchema#' },
        response: { 204: { type: 'null' } }
      }
    }
  ]
}
