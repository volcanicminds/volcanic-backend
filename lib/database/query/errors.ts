//
// Every way a query can be wrong, with a stable machine-readable code.
//
// The list is the point of this file. v4 answered a malformed query by quietly running a
// different one: an unparseable `_logic` became an AND of everything (D-13), an unknown sort
// field was skipped with a log line, an empty value became the literal string `notFound`, and
// a range with an ISO timestamp in it was dropped. Each of those returns a plausible result
// set for a question nobody asked, which is worse than an error because nobody notices.
//
export type QueryErrorCode =
  | 'QUERY_UNKNOWN_FIELD'
  | 'QUERY_UNKNOWN_OPERATOR'
  | 'QUERY_INVALID_VALUE'
  | 'QUERY_EMPTY_VALUE'
  | 'QUERY_SENSITIVE_FIELD'
  | 'QUERY_RELATION_NOT_ALLOWED'
  | 'QUERY_INVALID_RANGE'
  | 'QUERY_OPERATOR_NOT_SUPPORTED_BY_ENGINE'
  | 'QUERY_LOGIC_INVALID'
  | 'QUERY_LOGIC_TOO_COMPLEX'
  | 'QUERY_LOGIC_UNKNOWN_ALIAS'
  | 'QUERY_LOGIC_UNUSED_ALIAS'
  | 'QUERY_LOGIC_MISSING_ALIAS'
  | 'QUERY_DUPLICATE_CONDITION'
  | 'QUERY_WITH_DELETED_NOT_ALLOWED'
  | 'QUERY_INVALID_PAGE'

export class QueryError extends Error {
  readonly statusCode = 400
  readonly code: QueryErrorCode

  constructor(code: QueryErrorCode, message: string) {
    super(message)
    this.name = 'QueryError'
    this.code = code
  }
}

/** Names the offending parameter, never echoes the value: an error must not reflect input. */
export const queryError = (code: QueryErrorCode, message: string) => new QueryError(code, message)
