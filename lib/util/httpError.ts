// Standard error response body for the whole framework.
//
//   { statusCode, error, code?, message? }
//
//   statusCode : HTTP status
//   error      : HTTP reason phrase ('Bad Request', 'Unauthorized', ...)
//   code       : optional machine-readable code ('TENANT_MISMATCH', 'MFA_REQUIRED', ...)
//   message    : optional human-readable message
//
// Use this instead of `reply.send(new Error(...))`, which loses the status in
// Fastify's async error path (collapses to 500/403).
const REASON: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error'
}

export interface HttpErrorBody {
  statusCode: number
  error: string
  code?: string
  message?: string
}

export function httpError(statusCode: number, message?: string, code?: string): HttpErrorBody {
  return {
    statusCode,
    error: REASON[statusCode] || 'Error',
    ...(code ? { code } : {}),
    ...(message ? { message } : {})
  }
}
