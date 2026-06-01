#!/usr/bin/env python3
"""
Sube los productos scrapeados de Lider a la app HUB-STOCK-AI.
Lee el JSON generado por scraper.py y hace POST al endpoint de importación.

Uso:
    python upload_to_app.py --json productos_lider.json --url https://tu-app.vercel.app

Si no se especifica --url, intenta leer APP_BASE_URL del entorno.
"""

import json
import sys
import argparse
import urllib.request
import urllib.error
from pathlib import Path


def flatten_products(json_data):
    """Aplana la estructura anidada del JSON de scraper.py."""
    products = []
    for cat_name, cat_data in json_data.items():
        subcats = cat_data.get("subcategorias", {})
        for subcat_name, subcat_data in subcats.items():
            items = subcat_data.get("items", {})
            for item_name, item_products in items.items():
                for p in item_products:
                    if not p.get("nombre"):
                        continue
                    products.append({
                        "id": p.get("id", ""),
                        "nombre": p.get("nombre", ""),
                        "marca": p.get("marca", ""),
                        "fabricante": p.get("fabricante", ""),
                        "precio": p.get("precio", ""),
                        "precio_anterior": p.get("precio_anterior", ""),
                        "precio_unitario": p.get("precio_unitario", ""),
                        "imagen_url": p.get("imagen_url", ""),
                        "url_producto": p.get("url_producto", ""),
                        "descripcion_corta": p.get("descripcion_corta", ""),
                        "categoria": cat_name,
                        "subcategoria": subcat_name,
                        "listing_url": p.get("url_producto", ""),
                    })
    return products


def upload_products(products, base_url):
    """Hace POST al endpoint de importación de la app."""
    url = f"{base_url.rstrip('/')}/api/retail-scrapping/import-lider-products"
    payload = json.dumps({"products": products}).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {"ok": False, "error": f"HTTP {e.code}: {body[:200]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="Sube productos de Lider a HUB-STOCK-AI")
    parser.add_argument("--json", default="productos_lider.json", help="Ruta al JSON de productos")
    parser.add_argument("--url", default=None, help="URL base de la app (ej: https://tu-app.vercel.app)")
    args = parser.parse_args()

    base_url = args.url or ""
    if not base_url:
        print("Error: especifica --url o define APP_BASE_URL")
        print("Ejemplo: python upload_to_app.py --url https://tu-app.vercel.app")
        sys.exit(1)

    json_path = Path(args.json)
    if not json_path.exists():
        print(f"Error: no se encontró {json_path}")
        sys.exit(1)

    print(f"Leyendo {json_path}...")
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    products = flatten_products(data)
    print(f"Productos encontrados: {len(products)}")

    if not products:
        print("No hay productos para subir.")
        sys.exit(0)

    print(f"Subiendo a {base_url}...")
    result = upload_products(products, base_url)

    if result.get("ok"):
        print(f"OK: {result.get('inserted', 0)} productos insertados")
        print(f"Run ID: {result.get('runId', 'N/A')}")
        print(f"Snapshots: {result.get('snapshots', 0)}")
    else:
        print(f"Error: {result.get('error', 'desconocido')}")
        sys.exit(1)


if __name__ == "__main__":
    main()
