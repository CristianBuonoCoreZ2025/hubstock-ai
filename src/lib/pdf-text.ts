import { existsSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { pathToFileURL } from 'url'

/**
 * Ruta absoluta al worker de pdf.js.
 * No usar `createRequire(import.meta.url)`: en Turbopack `import.meta.url` apunta al chunk y
 * `require.resolve` devuelve rutas virtuales (`.../[project]/node_modules/...`) que no existen en disco.
 */
function getPdfjsLegacyWorkerFileUrl(): string {
  const requireFromProjectRoot = createRequire(join(process.cwd(), 'package.json'))
  let workerPath: string
  try {
    const pkgJson = requireFromProjectRoot.resolve('pdfjs-dist/package.json')
    workerPath = join(dirname(pkgJson), 'legacy', 'build', 'pdf.worker.mjs')
  } catch {
    workerPath = join(
      process.cwd(),
      'node_modules',
      'pdfjs-dist',
      'legacy',
      'build',
      'pdf.worker.mjs',
    )
  }
  if (!existsSync(workerPath)) {
    throw new Error(
      `No se encontró pdf.worker.mjs en ${workerPath}. Ejecuta npm install en la raíz del proyecto.`,
    )
  }
  return pathToFileURL(workerPath).href
}

/**
 * Extrae texto de un PDF en base64 (servidor). Usa `pdf-parse` v2 (`PDFParse`).
 */
export async function extractPdfTextFromBase64(base64: string): Promise<string> {
  const { PDFParse } = await import('pdf-parse')
  PDFParse.setWorker(getPdfjsLegacyWorkerFileUrl())
  const buf = Buffer.from(base64, 'base64')
  const parser = new PDFParse({ data: new Uint8Array(buf) })
  try {
    const result = await parser.getText()
    return result.text.trim()
  } finally {
    await parser.destroy()
  }
}
