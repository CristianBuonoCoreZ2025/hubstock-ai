/**
 * Parser HTML para páginas de categoría Jumbo.
 * Extrae productos del HTML de shelf pages como /despensa, /despensa?page=2
 */

export type JumboParsedProduct = {
  productId: string
  name: string
  brand: string | null
  price: number | null
  productUrl: string | null
  imageUrl: string | null
}

/**
 * Extrae el precio numérico de un string.
 * Soporta formatos: $1.234,56 / $1,234.56 / 1234.56 / etc.
 */
function extractPrice(priceStr: string): number | null {
  if (!priceStr) return null
  // Remover todo excepto dígitos, puntos y comas
  const cleaned = priceStr.replace(/[^\d.,]/g, '')
  // Detectar formato: si tiene coma antes del punto o viceversa
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // $1,234.56 → 1234.56
    // $1.234,56 → 1234.56
    const lastComma = cleaned.lastIndexOf(',')
    const lastDot = cleaned.lastIndexOf('.')
    if (lastComma > lastDot) {
      // European format: 1.234,56
      return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'))
    } else {
      // US format: 1,234.56
      return parseFloat(cleaned.replace(/,/g, ''))
    }
  } else if (cleaned.includes(',')) {
    // Podría ser decimal o separador de miles
    const parts = cleaned.split(',')
    if (parts.length === 2 && parts[1].length <= 2) {
      // Decimal: 1234,56 → 1234.56
      return parseFloat(cleaned.replace(',', '.'))
    } else {
      // Separador de miles: 1.234 → 1234
      return parseFloat(cleaned.replace(/,/g, ''))
    }
  } else if (cleaned.includes('.')) {
    const parts = cleaned.split('.')
    if (parts.length === 2 && parts[1].length === 2 && parseInt(parts[0]) > 99) {
      // Probablemente decimal con 2 decimales
      return parseFloat(cleaned)
    } else if (parts.length > 2 || (parts.length === 2 && parts[1].length !== 2)) {
      // Separador de miles: 1.234 → 1234
      return parseFloat(cleaned.replace(/\./g, ''))
    }
    return parseFloat(cleaned)
  }
  return parseFloat(cleaned) || null
}

/**
 * Extrae productos del HTML de una página de categoría Jumbo.
 * Busca múltiples patrones y los combina para mayor cobertura.
 */
export function extractProductsFromJumboShelfHtml(
  html: string,
  baseUrl: string,
): JumboParsedProduct[] {
  const products: JumboParsedProduct[] = []
  const seen = new Set<string>()

  // ========== MÉTODO 1: JSON-LD (Structured Data) ==========
  try {
    const jsonLdMatches = html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)
    for (const match of jsonLdMatches) {
      try {
        const jsonStr = match[1].trim()
        const data = JSON.parse(jsonStr)
        
        // Buscar ItemList que contiene products
        const findProducts = (obj: unknown): Array<Record<string, unknown>> => {
          if (!obj || typeof obj !== 'object') return []
          const results: Array<Record<string, unknown>> = []
          const typedObj = obj as Record<string, unknown>
          
          if (Array.isArray(typedObj)) {
            for (const item of typedObj) {
              if (item && typeof item === 'object') {
                const typedItem = item as Record<string, unknown>
                if (typedItem['@type'] === 'Product') {
                  results.push(typedItem)
                } else if (typedItem['@type'] === 'ItemList' && Array.isArray(typedItem.itemListElement)) {
                  results.push(...typedItem.itemListElement.map((e: { item?: Record<string, unknown> }) => e.item).filter((x): x is Record<string, unknown> => !!x))
                }
              }
            }
          } else {
            if (typedObj['@type'] === 'Product') {
              results.push(typedObj)
            } else if (typedObj['@type'] === 'ItemList' && Array.isArray(typedObj.itemListElement)) {
              results.push(...typedObj.itemListElement.map((e: { item?: Record<string, unknown> }) => e.item).filter((x): x is Record<string, unknown> => !!x))
            }
          }
          return results
        }
        
        const items = findProducts(data)
        
        for (const item of items) {
          if (!item || typeof item !== 'object') continue
          
          // Buscar ID en múltiples lugares
          const id = String(item.sku || item.productID || item['@id'] || '').trim()
          if (!id || seen.has(id)) continue
          
          seen.add(id)
          
          let price: number | null = null
          const offers = item.offers as Record<string, unknown> | undefined
          if (offers?.price) {
            price = extractPrice(String(offers.price))
          }
          
          const brand = item.brand as Record<string, unknown> | string | undefined
          const brandName = typeof brand === 'object' ? brand?.name : brand
          
          const image = item.image
          const imageUrl = Array.isArray(image) ? image[0] : image
          
          products.push({
            productId: id,
            name: typeof item.name === 'string' ? item.name.trim() : 'Sin nombre',
            brand: typeof brandName === 'string' ? brandName.trim() : null,
            price,
            productUrl: typeof item.url === 'string' ? item.url : null,
            imageUrl: typeof imageUrl === 'string' ? imageUrl : null,
          })
        }
      } catch {
        // Ignorar JSON malformado
      }
    }
  } catch {
    // Ignorar errores del matcher
  }

  // ========== MÉTODO 2: Script de hidratación VTEX IO (dehydratedState) ==========
  // Jumbo ahora usa React Query / VTEX IO con un script grande que contiene
  // dehydratedState.queries[].state.data.products
  try {
    const scripts = html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)
    for (const scriptMatch of scripts) {
      const text = scriptMatch[1].trim()
      if (!text.includes('dehydratedState') || !text.includes('products')) continue
      try {
        const parsed = JSON.parse(text)
        const queries = parsed?.dehydratedState?.queries as Array<Record<string, unknown>> | undefined
        if (!Array.isArray(queries)) continue
        for (const q of queries) {
          const queryData = (q?.state as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined
          const queryProducts = queryData?.products as Array<Record<string, unknown>> | undefined
          if (!Array.isArray(queryProducts)) continue
          for (const product of queryProducts) {
            const reference = String(product?.reference || product?.productId || '').trim()
            if (!reference || seen.has(reference)) continue
            seen.add(reference)

            const slug = typeof product?.slug === 'string' ? product.slug : ''
            const productUrl = slug ? `https://www.jumbo.cl/${slug}/p` : null

            const item = Array.isArray(product?.items) ? product.items[0] as Record<string, unknown> | undefined : undefined
            const name = typeof item?.name === 'string' ? item.name.trim() : typeof product?.name === 'string' ? product.name.trim() : 'Sin nombre'
            const brand = typeof product?.brand === 'string' ? product.brand.trim() : null
            const price = typeof item?.price === 'number' && item.price > 0 ? item.price : null
            const imageUrl = Array.isArray(item?.images) && typeof item.images[0] === 'string' ? item.images[0] : null

            products.push({
              productId: reference,
              name,
              brand,
              price,
              productUrl,
              imageUrl,
            })
          }
        }
      } catch {
        // Ignorar JSON malformado
      }
    }
  } catch {
    // Ignorar errores del matcher
  }

  // ========== MÉTODO 3: data-product-id en cualquier elemento ==========
  // Buscar todos los elementos que tienen data-product-id
  const productIdRegex = /data-product-id=["'](\d+)["']/gi
  let idMatch
  const productIds = new Set<string>()
  
  while ((idMatch = productIdRegex.exec(html)) !== null) {
    const id = idMatch[1]?.trim()
    if (id && !seen.has(id)) {
      productIds.add(id)
    }
  }
  
  console.log(`[jumbo-parser] Found ${productIds.size} unique data-product-id values`)
  
  // Para cada ID encontrado, buscar su contenedor de producto
  for (const id of productIds) {
    if (seen.has(id)) continue
    
    // Buscar la posición de este ID en el HTML
    const idRegex = new RegExp(`data-product-id=["']${id}["']`, 'i')
    const idMatchPos = html.search(idRegex)
    if (idMatchPos === -1) continue
    
    // Extraer un chunk de HTML alrededor del producto (2000 chars antes y después)
    const contextStart = Math.max(0, idMatchPos - 2000)
    const contextEnd = Math.min(html.length, idMatchPos + 2000)
    const context = html.slice(contextStart, contextEnd)
    
    // Buscar nombre - múltiples patrones
    let name = 'Sin nombre'
    const namePatterns = [
      /<h3[^>]*class=["'][^"]*product-name[^"]*["'][^>]*>([^<]+)</i,
      /<h3[^>]*class=["'][^"]*name[^"]*["'][^>]*>([^<]+)</i,
      /<a[^>]*class=["'][^"]*product-name[^"]*["'][^>]*>([^<]+)</i,
      /class=["'][^"]*shelf-product-title[^"]*["'][^>]*>([^<]+)</i,
      /<h3[^>]*>([^<]{10,200})</,
      /<h2[^>]*>([^<]{10,200})</,
      /<a[^>]*title=["']([^"]{10,200})["']/i,
      /<span[^>]*class=["'][^"]*productName[^"]*["'][^>]*>([^<]+)</i,
    ]
    
    for (const pattern of namePatterns) {
      const nameMatch = context.match(pattern)
      if (nameMatch) {
        const candidate = nameMatch[1].trim()
        if (candidate.length > 2 && candidate.length < 200) {
          name = candidate
          break
        }
      }
    }
    
    // Buscar precio - múltiples patrones
    let price: number | null = null
    const pricePatterns = [
      /class=["'][^"]*best-price[^"]*["'][^>]*>([^<]+)<[^>]*class=["'][^"]*price[^"]*["'][^>]*>([\d.,]+)/i,
      /class=["'][^"]*price[^"]*["'][^>]*>(?:[^<]*<[^>]*>)?\$?\s*([\d.,]+)/i,
      /class=["'][^"]*shelf-price[^"]*["'][^>]*>(?:[^<]*<[^>]*>)?\$?\s*([\d.,]+)/i,
      /<span[^>]*class=["'][^"]*price[^"]*["'][^>]*>(?:[^<]*<[^>]*>)?\$?\s*([\d.,]+)/i,
      /<div[^>]*class=["'][^"]*price[^"]*["'][^>]*>(?:[^<]*<[^>]*>)?\$?\s*([\d.,]+)/i,
    ]
    
    for (const pattern of pricePatterns) {
      const priceMatch = context.match(pattern)
      if (priceMatch) {
        const priceStr = priceMatch[1] || priceMatch[2]
        if (priceStr) {
          const extracted = extractPrice(priceStr)
          if (extracted && extracted > 0) {
            price = extracted
            break
          }
        }
      }
    }
    
    // Buscar URL del producto
    let productUrl: string | null = null
    const urlPatterns = [
      new RegExp(`data-product-id=["']${id}["'][^>]*href=["']([^"]+)["']`, 'i'),
      new RegExp(`href=["']([^"]+)["'][^>]*data-product-id=["']${id}["']`, 'i'),
      /<a[^>]*href=["']([^"]+)["'][^>]*class=["'][^"]*product[^"]*["']/i,
    ]
    
    for (const pattern of urlPatterns) {
      const urlMatch = context.match(pattern)
      if (urlMatch) {
        let url = urlMatch[1]
        if (url && !url.startsWith('http')) {
          url = url.startsWith('/') ? `https://www.jumbo.cl${url}` : `https://www.jumbo.cl/${url}`
        }
        if (url && url.includes('jumbo.cl')) {
          productUrl = url
          break
        }
      }
    }
    
    // Buscar imagen
    let imageUrl: string | null = null
    const imgPatterns = [
      new RegExp(`data-product-id=["']${id}["'][^>]*data-src=["']([^"]+)["']`, 'i'),
      new RegExp(`data-product-id=["']${id}["'][^>]*src=["']([^"]+)["']`, 'i'),
      /<img[^>]*src=["']([^"]+)["'][^>]*class=["'][^"]*product[^"]*["']/i,
      /<img[^>]*data-src=["']([^"]+)["'][^>]*class=["'][^"]*product[^"]*["']/i,
    ]
    
    for (const pattern of imgPatterns) {
      const imgMatch = context.match(pattern)
      if (imgMatch) {
        let url = imgMatch[1]
        if (url && !url.startsWith('http')) {
          url = url.startsWith('/') ? `https://www.jumbo.cl${url}` : `https://www.jumbo.cl/${url}`
        }
        if (url) {
          imageUrl = url
          break
        }
      }
    }
    
    seen.add(id)
    products.push({
      productId: id,
      name,
      brand: null,
      price,
      productUrl,
      imageUrl,
    })
  }

  // ========== MÉTODO 3: Buscar elementos de shelf de VTEX ==========
  // Patrón común en sitios VTEX: elementos con clase shelf-item o similar
  const shelfPatterns = [
    /<div[^>]*class=["'][^"]*shelf-item[^"]*["'][^>]*>[\s\S]*?<\/div>(?:\s*<\/div>)?/gi,
    /<li[^>]*class=["'][^"]*shelf-item[^"]*["'][^>]*>[\s\S]*?<\/li>/gi,
    /<article[^>]*class=["'][^"]*product[^"]*["'][^>]*>[\s\S]*?<\/article>/gi,
    /<div[^>]*class=["'][^"]*vtex[^"]*product[^"]*["'][^>]*>[\s\S]*?<\/div>(?:\s*<\/div>)?/gi,
    /<section[^>]*class=["'][^"]*Product[^"]*["'][^>]*>[\s\S]*?<\/section>/gi,
  ]
  
  for (const shelfPattern of shelfPatterns) {
    const shelfMatches = html.matchAll(shelfPattern)
    for (const shelfMatch of shelfMatches) {
      const shelfHtml = shelfMatch[0]
      
      // Extraer ID
      const idMatch = shelfHtml.match(/data-product-id=["'](\d+)["']/i) ||
                       shelfHtml.match(/class=["'][^"]*productId[^"]*["'][^>]*>(\d+)</i)
      if (!idMatch) continue
      
      const id = idMatch[1]
      if (seen.has(id)) continue
      
      // Extraer nombre
      const nameMatch = shelfHtml.match(/<h[23][^>]*class=["'][^"]*name[^"]*["'][^>]*>([^<]+)</i) ||
                       shelfHtml.match(/<h3[^>]*>([^<]{5,200})</) ||
                       shelfHtml.match(/<a[^>]*class=["'][^"]*product-name[^"]*["'][^>]*>([^<]+)</i) ||
                       shelfHtml.match(/<span[^>]*class=["'][^"]*productName[^"]*["'][^>]*>([^<]+)</i)
      const name = nameMatch?.[1]?.trim() || 'Sin nombre'
      
      // Extraer precio
      const priceMatch = shelfHtml.match(/class=["'][^"]*best-price[^"]*["'][^>]*>(?:[^<]*<[^>]*>)?\$?\s*([\d.,]+)/i) ||
                        shelfHtml.match(/class=["'][^"]*price[^"]*["'][^>]*>(?:[^<]*<[^>]*>)?\$?\s*([\d.,]+)/i) ||
                        shelfHtml.match(/>(\$[\d.,]+)</)
      const price = priceMatch ? extractPrice(priceMatch[1]) : null
      
      // Extraer URL
      const urlMatch = shelfHtml.match(/href=["']([^"]+)["']/i)
      let productUrl = urlMatch?.[1] || null
      if (productUrl && !productUrl.startsWith('http')) {
        productUrl = productUrl.startsWith('/') ? `https://www.jumbo.cl${productUrl}` : `https://www.jumbo.cl/${productUrl}`
      }
      
      seen.add(id)
      products.push({
        productId: id,
        name,
        brand: null,
        price,
        productUrl,
        imageUrl: null,
      })
    }
  }

  // ========== MÉTODO 4: Buscar elementos con clase Product específica de VTEX ==========
  // Jumbo/VTEX usa clases como vtex-product-summary-2-x-container
  const vtexProductMatches = html.matchAll(/<div[^>]*class=["'][^"]*vtex-product-summary[^"]*["'][^>]*data-product-id=["'](\d+)["'][^>]*>/gi)
  for (const match of vtexProductMatches) {
    const id = match[1]
    if (seen.has(id)) continue
    
    // Encontrar el cierre de este div
    const startIdx = match.index!
    let depth = 1
    let endIdx = startIdx + match[0].length
    while (depth > 0 && endIdx < html.length) {
      const nextOpen = html.indexOf('<div', endIdx)
      const nextClose = html.indexOf('</div>', endIdx)
      if (nextClose === -1) break
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++
        endIdx = nextOpen + 4
      } else {
        depth--
        endIdx = nextClose + 6
      }
    }
    
    const productHtml = html.slice(startIdx, endIdx)
    
    // Extraer nombre
    const nameMatch = productHtml.match(/<h3[^>]*class=["'][^"]*name[^"]*["'][^>]*>([^<]+)</i) ||
                     productHtml.match(/<span[^>]*class=["'][^"]*productBrand[^"]*["'][^>]*>([^<]+)</i)
    const name = nameMatch?.[1]?.trim() || 'Sin nombre'
    
    // Extraer precio
    const priceMatch = productHtml.match(/class=["'][^"]*selling-price[^"]*["'][^>]*>(?:[^<]*<[^>]*>)?\$?\s*([\d.,]+)/i) ||
                      productHtml.match(/class=["'][^"]*price[^"]*["'][^>]*>(?:[^<]*<[^>]*>)?\$?\s*([\d.,]+)/i)
    const price = priceMatch ? extractPrice(priceMatch[1]) : null
    
    // Extraer URL
    const urlMatch = productHtml.match(/href=["']([^"]+)["']/i)
    let productUrl = urlMatch?.[1] || null
    if (productUrl && !productUrl.startsWith('http')) {
      productUrl = productUrl.startsWith('/') ? `https://www.jumbo.cl${productUrl}` : `https://www.jumbo.cl/${productUrl}`
    }
    
    // Extraer imagen
    const imgMatch = productHtml.match(/src=["'](https:\/\/[^"]+\.jumbo\.cl\/[^"]+)["']/i) ||
                    productHtml.match(/data-src=["'](https:\/\/[^"]+\.jumbo\.cl\/[^"]+)["']/i)
    const imageUrl = imgMatch?.[1] || null
    
    seen.add(id)
    products.push({
      productId: id,
      name,
      brand: null,
      price,
      productUrl,
      imageUrl,
    })
  }

  console.log(`[jumbo-parser] Encontrados ${products.length} productos en ${baseUrl}`)
  return products
}

/**
 * Detecta si una URL es de categoría Jumbo (HTML) vs API VTEX.
 */
export function isJumboHtmlCategoryUrl(url: string): boolean {
  // URLs como /despensa, /despensa?page=2 son HTML
  // URLs como /_v/api/ son JSON API
  const p = url.toLowerCase()
  if (p.includes('/_v/') || p.includes('/api/')) return false
  
  // Tiene patrón de categoría /slug o /slug?param
  const pathMatch = new URL(url).pathname.match(/^\/[a-z0-9-]+$/i)
  return pathMatch !== null
}
