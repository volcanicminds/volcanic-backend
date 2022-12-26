const { customAlphabet } = require('nanoid')
const nanoid = customAlphabet('AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz0123456789')

export function newAuthCode() {
  return nanoid(Number(process.env.AUTH_CODE_SIZE) || 10)
}
