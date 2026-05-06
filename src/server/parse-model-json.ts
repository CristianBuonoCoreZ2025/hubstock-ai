/** Extrae JSON del texto del modelo (quita cercos ``` si los hay). */
export function parseModelJsonLoose(text: string): unknown {
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  if (!cleaned) {
    throw new SyntaxError('model_empty_json')
  }
  return JSON.parse(cleaned) as unknown
}
