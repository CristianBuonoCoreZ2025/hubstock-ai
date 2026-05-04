import { GoogleGenAI } from '@google/genai'
import { parseModelJsonLoose } from '@/server/parse-model-json'
import {
  PRODUCT_ANALYSIS_PROMPT,
  RECEIPT_ANALYSIS_PROMPT,
  stockCheckAnalysisPrompt,
} from '@/server/vision-prompts'

export function getGeminiVisionModel(): string {
  const fromEnv = process.env.GEMINI_MODEL?.trim()
  return fromEnv && fromEnv.length > 0 ? fromEnv : 'gemini-2.0-flash'
}

function getClient() {
  const key = process.env.GEMINI_API_KEY?.trim()
  if (!key) {
    throw new Error('GEMINI_API_KEY no está configurada')
  }
  return new GoogleGenAI({ apiKey: key })
}

export async function geminiAnalyzeProductFromImage(input: {
  imageBase64: string
  mimeType: string
}): Promise<unknown> {
  const ai = getClient()
  const prompt = PRODUCT_ANALYSIS_PROMPT

  const model = getGeminiVisionModel()
  const res = await ai.models.generateContent({
    model,
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
  return parseModelJsonLoose(text)
}

export async function geminiAnalyzeReceiptFromImage(input: {
  imageBase64: string
  mimeType: string
}): Promise<unknown> {
  const ai = getClient()
  const prompt = RECEIPT_ANALYSIS_PROMPT

  const model = getGeminiVisionModel()
  const res = await ai.models.generateContent({
    model,
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
  return parseModelJsonLoose(text)
}

export async function geminiAnalyzeStockCheckFromImage(input: {
  imageBase64: string
  mimeType: string
  zone: string
}): Promise<unknown> {
  const ai = getClient()
  const prompt = stockCheckAnalysisPrompt(input.zone)

  const model = getGeminiVisionModel()
  const res = await ai.models.generateContent({
    model,
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
  return parseModelJsonLoose(text)
}
