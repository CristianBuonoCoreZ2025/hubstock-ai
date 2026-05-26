/**
 * Script de prueba temporal: verifica que el parser extraiga
 * URL real, imagen, nombre, precio y SKU del HTML de Lider.
 */

import { extractListedProductsFromRetailHtml } from './src/server/retail-capture/extract-products-from-retail-html'

const html = `<!DOCTYPE html>
<html lang=es-CL><head>
<script nonce=_mkoNx_8g3OfJYE8 type="application/ld+json">{"@context":"https://schema.org","@type":"CollectionPage","name":"Sopas Y Cremas Instantáneas: Despensa","url":"https://super.lider.cl/browse/alimentos-instantaneos/despensa/sopas-y-cremas/46589040_52225904_18233142","mainEntity":{"@context":"https://schema.org","@type":"ItemList","numberOfItems":44,"itemListElement":[{"@type":"ListItem","position":1,"url":"https://super.lider.cl/ip/alimentos-instantaneos/00780295000663","name":"Sopa de Caracolitos (5 Porciones) Sobre, 76 g","image":"https://i5.walmartimages.cl/asr/36308184-105d-493f-8d44-746e7ea0dcbf.ce677188062ae2e4c3c3d0d8deb5583a.jpeg?null"}]}}</script>
</head><body>
<script id=__NEXT_DATA__ type="application/json" nonce=_mkoNx_8g3OfJYE8>{"props":{"pageProps":{"initialData":{"searchResult":{"title":"Sopas y Cremas","itemStacks":[{"items":[{"__typename":"Product","usItemId":"00780295000663","name":"Sopa de Caracolitos (5 Porciones) Sobre, 76 g","brand":"Maggi","canonicalUrl":"/ip/alimentos-instantaneos/00780295000663","price":630,"imageInfo":{"thumbnailUrl":"https://i5.walmartimages.cl/asr/36308184-105d-493f-8d44-746e7ea0dcbf.ce677188062ae2e4c3c3d0d8deb5583a.jpeg?null"},"priceInfo":{"linePrice":"$630"}}]}]}}}}}</script>
</body></html>`

const pageUrl = 'https://super.lider.cl/browse/alimentos-instantaneos/despensa/sopas-y-cremas/46589040_52225904_18233142'

const products = extractListedProductsFromRetailHtml(html, pageUrl)

console.log('Products found:', products.length)
for (const p of products.slice(0, 3)) {
  console.log({
    name: p.name,
    price: p.price,
    absoluteUrl: p.absoluteUrl,
    sku: p.sku,
    brand: p.brand,
    imageUrl: p.imageUrl,
  })
}
