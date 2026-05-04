/**
 * Prompts compartidos entre Gemini directo y OpenRouter (misma salida JSON).
 */

/** Análisis detallado de producto desde foto de etiqueta/empaque. */
export const PRODUCT_ANALYSIS_PROMPT = `Eres un experto en lectura de etiquetas de supermercado y empaques. Examina TODA la imagen: frente, marca, contenido neto, tipo de producto y envase.

Devuelve SOLO un JSON válido (sin markdown, sin texto fuera del JSON) con esta forma exacta:
{
  "name": "string",
  "brand": "string|null",
  "productType": "string|null",
  "presentation": "string|null",
  "netQuantity": number|null,
  "netUnit": "g"|"ml"|"L"|"kg"|null,
  "format": "string|null",
  "unit": "string|null",
  "categoryGuess": "string|null",
  "notes": "string|null"
}

Reglas obligatorias:
- "name": nombre comercial completo legible en el envase (no uses solo una palabra genérica como "pasta" si la etiqueta dice más; incluye variante: ej. "Fideos spaghetti N°5").
- "brand": marca registrada visible; null solo si no hay marca identificable.
- "productType": QUÉ es el producto (ej. pasta seca de trigo, aceite de girasol, leche entera UHT, detergente líquido ropa).
- "presentation": tipo de envase (bolsa, caja, botella PET, lata, brick, pote, pack multipack).
- "netQuantity" y "netUnit": contenido neto impreso en la etiqueta (ej. netQuantity 500, netUnit "g"; o 1 y "L"). Si hay varios bloques, el principal según el frente del producto.
- "format": una línea resumen humano: tipo + presentación + peso/volumen si aplica (ej. "Pasta seca · bolsa · 400 g").
- "unit": texto útil para inventario (ej. "400 g", "1 L", "6×330 ml").
- "notes": solo datos extra útiles (ingredientes llamativos, país de origen en etiqueta, advertencias); no repitas lo mismo de arriba.
- Todo en español. Si no hay producto reconocible: "name": "Desconocido" y null en campos que no apliquen.`

export const RECEIPT_ANALYSIS_PROMPT = `Extrae datos de una boleta o ticket de compra. Devuelve SOLO JSON válido (sin markdown) con forma:
{"storeName":"string|null","purchasedAt":"ISO8601 string|null","currency":"string","total":"number|null","items":[{"nameRaw":"string","quantity":"number|null","unitPrice":"number|null","lineTotal":"number|null"}]}
Si no puedes leer la fecha, purchasedAt null.`

export function stockCheckAnalysisPrompt(zone: string): string {
  const zoneLabel =
    zone === 'alacena'
      ? 'alacena / despensa'
      : zone === 'refrigerador'
        ? 'refrigerador'
        : zone === 'congelador'
          ? 'congelador'
          : zone === 'bano'
            ? 'baño / aseo'
            : zone === 'bodega'
              ? 'bodega'
              : 'otra zona'

  return `Eres un asistente para inventario doméstico. La foto corresponde a la zona: "${zoneLabel}".

Debes identificar productos de consumo VISIBLES en la imagen (empaques, botellas, latas, cajas). Todo el contenido textual que inventes o infieras debe estar EN ESPAÑOL.

Devuelve SOLO un JSON válido (sin markdown, sin texto antes ni después) con esta forma exacta:
{
  "detected": [
    {
      "nameGuess": "string — nombre del producto como lo vería el usuario en la etiqueta o envase",
      "brandGuess": "string|null — marca visible; null si no se distingue",
      "productType": "string|null — qué es (ej. leche entera UHT, arroz blanco, detergente líquido)",
      "presentation": "string|null — tipo de envase (brick, botella PET, bolsa, lata, pote, pack)",
      "netQuantity": number|null,
      "netUnit": "g"|"ml"|"L"|"kg"|null,
      "quantityGuess": number|null,
      "confidence": number,
      "notes": "string|null — solo detalle útil (ej. pack multipack, sabor, tamaño relativo)"
    }
  ]
}

Reglas:
- Usa EXACTAMENTE las claves del ejemplo en camelCase (nameGuess, brandGuess, productType, presentation, netQuantity, netUnit, quantityGuess, confidence, notes). No uses snake_case en las claves JSON.
- "netQuantity" + "netUnit": contenido neto IMPRESO en el envase si se lee en la foto (ej. 500 y "g"); si no se ve, null.
- "quantityGuess": cuántas UNIDADES del mismo producto ves repetidas o apiladas (ej. 3 botellas iguales → 3). Si hay una sola unidad visible, 1 o null si es ambiguo.
- "confidence": número entre 0 y 1 según tu certeza de que el ítem y datos coinciden con lo visible.
- No inventes marcas que no puedas fundamentar con la imagen. Si la foto es ilegible, "detected" puede ser [].
- Los valores descriptivos (nameGuess, brandGuess, productType, presentation, notes) SIEMPRE en español.`
}
