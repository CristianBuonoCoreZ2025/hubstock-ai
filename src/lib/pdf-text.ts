/**
 * Extrae texto de un PDF en base64 (servidor). Usa `pdf-parse` v2 (`PDFParse`).
 */
export async function extractPdfTextFromBase64(base64: string): Promise<string> {
  const { PDFParse } = await import('pdf-parse')
  const buf = Buffer.from(base64, 'base64')
  const parser = new PDFParse({ data: new Uint8Array(buf) })
  try {
    const result = await parser.getText()
    return result.text.trim()
  } finally {
    await parser.destroy()
  }
}
