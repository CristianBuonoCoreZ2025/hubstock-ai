import { GoogleGenAI } from '@google/genai'

function getClient() {
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    throw new Error('GEMINI_API_KEY no está configurada')
  }
  return new GoogleGenAI({ apiKey: key })
}

export async function analyzeProductFromImage(input: {
  imageBase64: string
  mimeType: string
}): Promise<unknown> {
  const ai = getClient()
  const prompt = `Eres un asistente para inventario doméstico. Analiza la imagen de un producto y devuelve SOLO un JSON válido con esta forma exacta (sin markdown):
{"name":"string","brand":"string|null","format":"string|null","unit":"string|null","categoryGuess":"string|null","gtin":"string|null","notes":"string|null"}
gtin: código de barras EAN-13/UPC solo dígitos si es legible en el empaque; si no, null.
notes: observaciones breves; puede incluir texto crudo del código si ayuda.
Usa español para textos visibles al usuario. Si no hay producto claro, name puede ser "Desconocido".`

  const res = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: input.mimeType,
              data: input.imageBase64,
            },
          },
        ],
      },
    ],
  })

  const text = res.text?.trim() ?? ''
  return parseJsonLoose(text)
}

export async function analyzeReceiptFromImage(input: {
  imageBase64: string
  mimeType: string
}): Promise<unknown> {
  const ai = getClient()
  const prompt = `Extrae datos de una boleta o ticket de compra. Devuelve SOLO JSON válido (sin markdown) con forma:
{"storeName":"string|null","purchasedAt":"ISO8601 string|null","currency":"string","total":"number|null","items":[{"nameRaw":"string","gtin":"string|null","quantity":"number|null","unitPrice":"number|null","lineTotal":"number|null"}]}
gtin por línea: solo si el ticket muestra código de barras o SKU numérico de 8-14 dígitos claramente asociado a esa línea; si no, null.
Si no puedes leer la fecha, purchasedAt null.`

  const res = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: input.mimeType,
              data: input.imageBase64,
            },
          },
        ],
      },
    ],
  })

  const text = res.text?.trim() ?? ''
  return parseJsonLoose(text)
}

export async function analyzeStockCheckFromImage(input: {
  imageBase64: string
  mimeType: string
  zone: string
}): Promise<unknown> {
  const ai = getClient()
  const prompt = `Zona del hogar: ${input.zone}.
Estima productos visibles en la foto de despensa/refrigerador/etc.
Devuelve SOLO JSON válido (sin markdown):
{"detected":[{"nameGuess":"string","quantityGuess":"number|null","confidence":"number between 0 and 1"}]}
No inventes marcas imposibles de ver. Si la imagen no es clara, detected puede ser [].`

  const res = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: input.mimeType,
              data: input.imageBase64,
            },
          },
        ],
      },
    ],
  })

  const text = res.text?.trim() ?? ''
  return parseJsonLoose(text)
}

function parseJsonLoose(text: string): unknown {
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  return JSON.parse(cleaned) as unknown
}
