const path = require('path')
export function normalizePatterns(path1: Array<string>, path2: Array<string>): Array<string> {
  // replaceAll is needed for windows
  return [
    path.join(__dirname, ...path1).replaceAll('\\', '/'),
    path.join(process.cwd(), ...path2).replaceAll('\\', '/')
  ]
}
