const fs = require('fs')
const path = require('path')

const MAIN_DIRECTORY = './'
const INCLUDE_FILES = ['package.json', 'tsconfig.json', 'README.md', '.nvmrc', 'index.ts', 'index.d.ts']
const SUB_DIRECTORIES = ['lib', 'types']
const OUTPUT_FILE = 'OUTPUT.md'

/**
 * Recursively collects .js and .ts files from a given directory.
 *
 * @param {string} directory - _The directory to scan recursively._
 * @returns {Array<{ relativePath: string }>} - _List of file objects with relative paths._
 */
const getFilesFromDirectory = (directory) => {
  let filesList = []
  const items = fs.readdirSync(directory)

  items.forEach((item) => {
    const itemPath = path.join(directory, item)
    const stats = fs.statSync(itemPath)

    if (stats.isDirectory()) {
      filesList = filesList.concat(getFilesFromDirectory(itemPath))
    } else if (
      item.endsWith('.html') ||
      item.endsWith('.vue') ||
      item.endsWith('.css') ||
      item.endsWith('.json') ||
      item.endsWith('.js') ||
      item.endsWith('.ts') ||
      item.endsWith('.md')
    ) {
      filesList.push({ relativePath: path.relative(MAIN_DIRECTORY, itemPath) })
    }
  })

  return filesList
}

/**
 * Retrieves files from the specified subdirectories.
 *
 * @returns {Object} - _Object containing individual subdirectory files and a combined list._
 */
const getFilesFromSubDirectories = () => {
  const subDirectoryFiles = {}
  let combinedFiles = []

  SUB_DIRECTORIES.forEach((dir) => {
    const files = getFilesFromDirectory(dir)
    subDirectoryFiles[dir] = files
    combinedFiles = combinedFiles.concat(files)
  })

  return { subDirectoryFiles, combinedFiles }
}

async function generateMarkdown() {
  const rootFiles = fs
    .readdirSync(MAIN_DIRECTORY)
    .filter(
      (file) =>
        file.endsWith('.html') ||
        (file.endsWith('.ts') && file !== 'combine.ts') ||
        (file.endsWith('.js') && file !== 'combine.js') ||
        INCLUDE_FILES.includes(file)
    )
    .map((file) => ({ relativePath: file }))

  const { subDirectoryFiles, combinedFiles } = getFilesFromSubDirectories()
  const allFiles = [...rootFiles, ...combinedFiles]
  const currentISOString = new Date().toISOString()

  const markdownLines = []
  markdownLines.push('# Full Project - Updated At ' + currentISOString, '')
  markdownLines.push('Below are all the files, materials and documentation of the project to analyze.', '')
  markdownLines.push('```bash')
  markdownLines.push('./')

  rootFiles.forEach((file) => {
    markdownLines.push(`├── ${file.relativePath}`)
  })

  if (SUB_DIRECTORIES.length > 0) {
    SUB_DIRECTORIES.forEach((dir) => {
      markdownLines.push(`├── ${dir}`)

      const sortedSubFiles = subDirectoryFiles[dir].sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      sortedSubFiles.forEach((file) => {
        const displayPath = file.relativePath.replace(new RegExp(`^(${SUB_DIRECTORIES.join('|')})[\\\\/]`), '')
        markdownLines.push(`    ├── ${displayPath}`)
      })
    })
  }
  markdownLines.push('```', '')

  markdownLines.push('## Source Files Index', '')
  allFiles.forEach((file) => {
    const filePath = file.relativePath

    const slug = filePath.replace(/[\/.]/g, '-')
    markdownLines.push(`- [${filePath}](#file-${slug})`)
  })
  markdownLines.push('')

  for (const file of allFiles) {
    const filePath = file.relativePath
    const fullPath = path.join(MAIN_DIRECTORY, filePath)

    const language = filePath.endsWith('.md') ? 'markdown' : filePath.endsWith('.ts') ? 'typescript' : 'javascript'

    const fileContent = fs.readFileSync(fullPath, 'utf-8')
    markdownLines.push(`## File: ${filePath}`, '')
    markdownLines.push('```' + language)
    markdownLines.push(fileContent)
    markdownLines.push('```', '')
  }

  fs.writeFileSync(OUTPUT_FILE, markdownLines.join('\n'))
  console.log(`Markdown file generated: ${OUTPUT_FILE}`)
}

generateMarkdown()
