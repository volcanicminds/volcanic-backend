/* eslint-disable @typescript-eslint/no-explicit-any */
// Consumer-app CUSTOM global middleware. Referenced as `global.auditStamp` in a
// route's `middlewares`, the framework resolves it from src/middleware/. Exporting
// a `preHandler` hook makes it run before the handler — here it stamps a response
// header so a test can prove the custom middleware actually executed.
export function preHandler(_req: any, reply: any, done: any) {
  reply.header('x-audited', 'widgets')
  done()
}
