#!/usr/bin/env python3
"""
Scraper de Lider que guarda DIRECTAMENTE en Supabase.
Corre en tu PC (donde Lider no bloquea) y escribe a las tablas:
- scrapping
- scrapping_runs
- catalog_retail_snapshots

Requiere:
    pip install supabase requests

Variables de entorno:
    SUPABASE_URL=https://xxxxx.supabase.co
    SUPABASE_SERVICE_ROLE_KEY=eyJ...

Uso:
    python scraper_to_supabase.py
"""

import json
import os
import re
import sys
import time
import hashlib
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ============ SUPABASE CONFIG ============
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: definí SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY")
    print("Ejemplo:")
    print('  export SUPABASE_URL="https://tu-proyecto.supabase.co"')
    print('  export SUPABASE_SERVICE_ROLE_KEY="eyJ..."')
    sys.exit(1)

SUPABASE_REST = f"{SUPABASE_URL}/rest/v1"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}

# ============ LIDER CONFIG ============
BASE_URL = "https://super.lider.cl"
REQUEST_DELAY = 1.0


def create_session():
    session = requests.Session()
    retry = Retry(total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
    })
    return session


def extract_products_from_html(html_text):
    """Extrae productos de __NEXT_DATA__"""
    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html_text, re.DOTALL)
    if not match:
        return [], 0
    try:
        next_data = json.loads(match.group(1))
    except json.JSONDecodeError:
        return [], 0

    page_props = next_data.get("props", {}).get("pageProps", {})
    initial_data = page_props.get("initialData", {})
    search_result = initial_data.get("searchResult", {})
    item_stacks = search_result.get("itemStacks", [])

    products = []
    total_count = 0

    for stack in item_stacks:
        total_count = max(total_count, stack.get("count", 0))
        for item in stack.get("items", []):
            item_type = item.get("__typename", "")
            if item_type in ["TileTakeOverProductPlaceholder", "AdPlaceholder", ""]:
                continue
            name = item.get("name", "")
            if not name:
                continue

            price_info = item.get("priceInfo", {}) or {}
            image_info = item.get("imageInfo", {}) or {}
            image_obj = item.get("image", {}) or {}

            image_url = ""
            if image_info and image_info.get("thumbnailUrl"):
                image_url = image_info["thumbnailUrl"]
            elif isinstance(image_obj, dict) and image_obj.get("thumbnailUrl"):
                image_url = image_obj["thumbnailUrl"]
            elif isinstance(image_obj, str):
                image_url = image_obj

            product_id = item.get("id", "") or item.get("usItemId", "")
            canonical_url = item.get("canonicalUrl", "")

            products.append({
                "id": product_id,
                "nombre": name,
                "marca": item.get("brand", "") or "",
                "fabricante": item.get("manufacturerName", "") or "",
                "precio": price_info.get("linePrice", "") or "",
                "precio_anterior": price_info.get("wasPrice", "") or "",
                "precio_unitario": price_info.get("unitPrice", "") or "",
                "imagen_url": image_url,
                "url_producto": f"https://super.lider.cl{canonical_url}" if canonical_url else "",
                "descripcion_corta": item.get("shortDescription", "") or "",
            })

    return products, total_count


def fetch_page_products(session, url, page=1):
    if page > 1:
        separator = "&" if "?" in url else "?"
        fetch_url = f"{url}{separator}page={page}"
    else:
        fetch_url = url
    try:
        resp = session.get(fetch_url, timeout=30)
        if resp.status_code == 200:
            return extract_products_from_html(resp.text)
        else:
            print(f"  HTTP {resp.status_code}")
            return [], 0
    except Exception as e:
        print(f"  Error: {e}")
        return [], 0


def fetch_all_products(session, url):
    all_products = []
    seen = set()

    products, total = fetch_page_products(session, url, page=1)
    for p in products:
        pid = p["id"] or p["nombre"]
        if pid not in seen:
            seen.add(pid)
            all_products.append(p)

    if total > 40:
        pages = min((total + 39) // 40, 25)
        for page in range(2, pages + 1):
            time.sleep(REQUEST_DELAY)
            products, _ = fetch_page_products(session, url, page=page)
            new = 0
            for p in products:
                pid = p["id"] or p["nombre"]
                if pid not in seen:
                    seen.add(pid)
                    all_products.append(p)
                    new += 1
            if new == 0:
                break

    return all_products


def parse_price(raw):
    if not raw:
        return 0
    cleaned = raw.replace("$", "").replace(".", "").replace(",", ".")
    cleaned = re.sub(r'\s*x.*$', '', cleaned).strip()
    try:
        n = float(cleaned)
        return round(n) if n > 0 else 0
    except ValueError:
        return 0


def stable_hash(v):
    s = json.dumps(v, sort_keys=True)
    h = 0
    for ch in s:
        h = (31 * h + ord(ch)) & 0xFFFFFFFF
    return abs(h)


def get_retail_id():
    """Busca el ID de Lider en la tabla retail"""
    resp = requests.get(
        f"{SUPABASE_REST}/retail?select=id,name&name=ilike.*Lider*",
        headers={**HEADERS, "Accept": "application/vnd.pgrst.object+json"},
    )
    if resp.status_code == 200:
        data = resp.json()
        if isinstance(data, list) and len(data) > 0:
            return data[0]["id"]
    return None


def create_scrapping_run(retail_id):
    """Crea una corrida en scrapping_runs"""
    payload = {
        "retailer": "lider",
        "source_chain": "lider",
        "retail_id": retail_id,
        "status": "completed",
        "total_pages": 0,
        "pages_done": 1,
        "pages_ok": 1,
        "pages_failed": 0,
        "rows_inserted": 0,
        "started_at": datetime.utcnow().isoformat(),
        "finished_at": datetime.utcnow().isoformat(),
    }
    resp = requests.post(
        f"{SUPABASE_REST}/scrapping_runs",
        headers={**HEADERS, "Prefer": "return=representation"},
        json=payload,
    )
    if resp.status_code in (200, 201):
        return resp.json()[0]["id"]
    print(f"Error creando run: {resp.status_code} {resp.text}")
    return None


def upload_products(products, run_id, sections_map):
    """Inserta productos en scrapping y catalog_retail_snapshots"""
    now = datetime.utcnow().isoformat()

    scrapping_rows = []
    snapshot_rows = []

    for p in products:
        name = p["nombre"].strip()
        if not name:
            continue

        price = parse_price(p.get("precio"))
        product_id = p.get("id", "").strip()
        product_url = p.get("url_producto", "").strip()
        brand = p.get("marca", "").strip() or p.get("fabricante", "").strip() or None
        image_url = p.get("imagen_url", "").strip() or None
        external_ref = product_id or product_url or f"local:{stable_hash(name + str(price))}"
        section = sections_map.get(product_url, {}).get("section")
        category = sections_map.get(product_url, {}).get("category")

        scrapping_rows.append({
            "run_id": run_id,
            "retailer": "lider",
            "external_ref": external_ref,
            "product_url": product_url,
            "product_name": name,
            "brand": brand,
            "price": price,
            "currency": "CLP",
            "source_chain": "lider",
            "listing_url": product_url,
            "sections": section,
            "categories": category,
            "image_url": image_url,
            "extracted_at": now,
        })

        snapshot_rows.append({
            "retailer": "lider",
            "external_ref": external_ref,
            "source_url": product_url or None,
            "title": name,
            "price": price,
            "category_hint": category or section or None,
            "brand_hint": brand,
            "captured_at": now,
            "match_method": "python_local_direct",
        })

    inserted = 0
    chunk = 100
    for i in range(0, len(scrapping_rows), chunk):
        slice_rows = scrapping_rows[i:i + chunk]
        resp = requests.post(
            f"{SUPABASE_REST}/scrapping",
            headers=HEADERS,
            json=slice_rows,
        )
        if resp.status_code in (200, 201):
            inserted += len(slice_rows)
        else:
            print(f"  Error insertando scrapping: {resp.status_code} {resp.text[:200]}")

    snap_chunk = 200
    for i in range(0, len(snapshot_rows), snap_chunk):
        slice_rows = snapshot_rows[i:i + snap_chunk]
        requests.post(
            f"{SUPABASE_REST}/catalog_retail_snapshots",
            headers=HEADERS,
            json=slice_rows,
        )

    return inserted


def update_run_rows(run_id, count):
    requests.patch(
        f"{SUPABASE_REST}/scrapping_runs?id=eq.{run_id}",
        headers=HEADERS,
        json={"rows_inserted": count},
    )


def load_categories():
    """Carga el JSON de categorías de Lider"""
    cat_file = Path(__file__).parent / "raw_categories.json"
    if not cat_file.exists():
        print(f"Error: no se encontró {cat_file}")
        print("Corré prepare_categories.py primero")
        sys.exit(1)
    with open(cat_file, "r", encoding="utf-8") as f:
        return json.load(f)


def main():
    print("🛒 Lider → Supabase (Directo)")
    print("=" * 60)

    categories = load_categories()
    session = create_session()

    retail_id = get_retail_id()
    if not retail_id:
        print("⚠️  No se encontró Lider en tabla 'retail'. Creando run sin retail_id...")

    run_id = create_scrapping_run(retail_id)
    if not run_id:
        print("Error: no se pudo crear la corrida")
        sys.exit(1)
    print(f"📋 Run creado: {run_id}")

    all_products = []
    sections_map = {}
    total_inserted = 0

    skip = {"Marcas Propias", "Marcas Americanas", "La Boti", "Soy Pyme", "Campañas"}

    for cat_name, cat_data in categories.items():
        if cat_name in skip:
            print(f"\n⏭️  Saltando: {cat_name}")
            continue

        print(f"\n{'='*60}")
        print(f"📁 {cat_name}")
        print(f"{'='*60}")

        subcategories = cat_data.get("subcategories", {})
        for subcat_slug, subcat_items in subcategories.items():
            for item_info in subcat_items:
                item_name = item_info["name"]
                item_url = item_info["url"]
                if "revisar" in item_name.lower():
                    continue

                print(f"    🔍 {item_name}: ", end="", flush=True)
                time.sleep(REQUEST_DELAY)
                products = fetch_all_products(session, item_url)
                print(f"{len(products)} productos")

                for p in products:
                    p_url = p.get("url_producto", "")
                    sections_map[p_url] = {"section": cat_name, "category": subcat_slug}

                all_products.extend(products)

                # Insertar en batch cada 500 productos
                if len(all_products) >= 500:
                    inserted = upload_products(all_products, run_id, sections_map)
                    total_inserted += inserted
                    print(f"       📤 Insertados: {total_inserted}")
                    all_products = []

    # Insertar restantes
    if all_products:
        inserted = upload_products(all_products, run_id, sections_map)
        total_inserted += inserted

    update_run_rows(run_id, total_inserted)

    print(f"\n{'='*60}")
    print(f"✅ COMPLETADO")
    print(f"{'='*60}")
    print(f"📊 Total insertados: {total_inserted}")
    print(f"📋 Run ID: {run_id}")


if __name__ == "__main__":
    main()
