/**
 * Prompts compartidos entre Gemini directo y OpenRouter (misma salida JSON).
 */

/** Análisis desde foto: puede haber varios productos o envases claros en la misma imagen. */
export const PRODUCT_ANALYSIS_PROMPT = `Eres un experto en lectura de etiquetas de supermercado y empaques. Examina TODA la imagen: puede incluir uno o más productos distintos visibles en el mismo encuadre (varios paquetes, botellas frente al fondo de nevera, varias unidades lado a lado).

Devuelve SOLO un JSON válido (sin markdown, sin texto fuera del JSON) con esta forma exacta:
{
  "products": [
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
      "notes": "string|null",
      "gtin": "string|null"
    }
  ]
}

Reglas obligatorias:
- "products": un objeto por cada producto EMPAQUE distinto que puedas distinguir sin inventar líneas repetidas triviales del mismo SKU (ej. tres latas iguales del mismo producto → suele bastar una entrada con datos del envase una vez).
- Para cada entrada:
  - "name": nombre comercial legible para ese ítem en la foto (include variante cuando la etiqueta la muestre: ej. "Fideos spaghetti N°5").
  - "brand": marca visible para ese elemento; null si no se distinguen.
  - "productType", "presentation", "netQuantity", "netUnit", "format", "unit", "notes", "gtin": igual criterio que antes pero por cada entrada; "gtin" solo dígitos 8–14 si está visible para ese objeto.
  - "categoryGuess": pista opcional sobre categoría tipo supermercado (en español).
- Si ves un solo producto claro en la foto, "products" es un array con un solo objeto.
- Si no hay ningún envase/producto reconocible, usa "products": [{"name":"Desconocido","brand":null,"productType":null,"presentation":null,"netQuantity":null,"netUnit":null,"format":null,"unit":null,"categoryGuess":null,"notes":null,"gtin":null}].
- Todo el texto descriptivo en español.
- Respeta SIEMPRE la clave "products" (array); no pongas solo un objeto en la raíz.`

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
