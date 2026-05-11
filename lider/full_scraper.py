#!/usr/bin/env python3
"""
Complete scraper for super.lider.cl
Extracts all products from all categories/subcategories.
Saves to JSON and SQLite, downloads images.
"""

import json
import os
import re
import sqlite3
import time
import hashlib
from pathlib import Path
from urllib.parse import urlparse, unquote

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ============ CONFIGURATION ============
BASE_DIR = Path("/home/ubuntu/lider_scraper")
IMAGES_DIR = BASE_DIR / "imagenes"
OUTPUT_JSON = BASE_DIR / "productos_lider.json"
OUTPUT_SQLITE = BASE_DIR / "productos_lider.db"

REQUEST_DELAY = 0.8
IMAGE_DOWNLOAD_TIMEOUT = 15
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-CL,es;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
}

# ============ CATEGORY DATA ============
# Pre-extracted from browser navigation - all categories and their subcategory URLs
# This was extracted by clicking through the menu on super.lider.cl

def load_categories():
    """Load category data from file if exists, otherwise use embedded data."""
    cat_file = BASE_DIR / "raw_categories.json"
    if cat_file.exists():
        with open(cat_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    return None

# ============ SESSION SETUP ============
def create_session():
    session = requests.Session()
    retry = Retry(total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update(HEADERS)
    return session

# ============ EXTRACT PRODUCTS ============
def extract_next_data(html_text):
    """Extract __NEXT_DATA__ JSON from the page HTML."""
    scripts = re.findall(r'<script[^>]*>(.*?)</script>', html_text, re.DOTALL)
    for s in scripts:
        if s.startswith('{"props"'):
            try:
                return json.loads(s)
            except json.JSONDecodeError:
                continue
    return None

def extract_products_from_page(html_text):
    """Extract product data from page HTML."""
    data = extract_next_data(html_text)
    if not data:
        return [], 0
    
    try:
        search_result = data["props"]["pageProps"]["initialData"]["searchResult"]
        item_stacks = search_result.get("itemStacks", [])
    except (KeyError, TypeError):
        return [], 0
    
    products = []
    total_count = 0
    
    for stack in item_stacks:
        count = stack.get("count", 0)
        if count > total_count:
            total_count = count
        
        items = stack.get("items", [])
        for item in items:
            typename = item.get("__typename", "")
            if typename in ["TileTakeOverProductPlaceholder", "AdPlaceholder", ""]:
                continue
            
            name = item.get("name", "")
            if not name:
                continue
            
            brand = item.get("brand", "") or ""
            manufacturer = item.get("manufacturerName", "") or ""
            
            price_info = item.get("priceInfo", {}) or {}
            line_price = price_info.get("linePrice", "") or ""
            was_price = price_info.get("wasPrice", "") or ""
            unit_price = price_info.get("unitPrice", "") or ""
            
            # Image URL
            image_url = ""
            img_info = item.get("imageInfo", {}) or {}
            if img_info.get("thumbnailUrl"):
                image_url = img_info["thumbnailUrl"]
            else:
                img_obj = item.get("image", {}) or {}
                if isinstance(img_obj, dict):
                    image_url = img_obj.get("thumbnailUrl", "") or img_obj.get("url", "")
                elif isinstance(img_obj, str):
                    image_url = img_obj
            
            product_id = item.get("id", "") or item.get("usItemId", "") or ""
            canonical_url = item.get("canonicalUrl", "") or ""
            short_desc = item.get("shortDescription", "") or ""
            
            products.append({
                "id": product_id,
                "nombre": name,
                "marca": brand,
                "fabricante": manufacturer,
                "modelo": "",
                "precio": line_price,
                "precio_anterior": was_price,
                "precio_unitario": unit_price,
                "imagen_url": image_url,
                "url_producto": f"https://super.lider.cl{canonical_url}" if canonical_url else "",
                "descripcion_corta": short_desc,
            })
    
    return products, total_count

def fetch_products(session, url, page=1):
    """Fetch products from a URL with optional pagination."""
    fetch_url = url
    if page > 1:
        sep = "&" if "?" in url else "?"
        fetch_url = f"{url}{sep}page={page}"
    
    try:
        resp = session.get(fetch_url, timeout=30)
        if resp.status_code == 200:
            return extract_products_from_page(resp.text)
        elif resp.status_code == 403:
            print(f"    ⚠️  403 Forbidden - may need to wait")
            time.sleep(5)
            resp = session.get(fetch_url, timeout=30)
            if resp.status_code == 200:
                return extract_products_from_page(resp.text)
        print(f"    HTTP {resp.status_code}")
        return [], 0
    except Exception as e:
        print(f"    Error: {e}")
        return [], 0

def fetch_all_products(session, url):
    """Fetch all products from a subcategory URL, handling pagination."""
    all_products = []
    seen_ids = set()
    
    products, total_count = fetch_products(session, url, page=1)
    
    for p in products:
        pid = p["id"] or p["nombre"]
        if pid not in seen_ids:
            seen_ids.add(pid)
            all_products.append(p)
    
    # Paginate if needed (typically 40 items per page)
    if total_count > 40:
        total_pages = min((total_count + 39) // 40, 25)
        for page in range(2, total_pages + 1):
            time.sleep(REQUEST_DELAY)
            products, _ = fetch_products(session, url, page=page)
            new_count = 0
            for p in products:
                pid = p["id"] or p["nombre"]
                if pid not in seen_ids:
                    seen_ids.add(pid)
                    all_products.append(p)
                    new_count += 1
            if new_count == 0:
                break
    
    return all_products

# ============ IMAGE DOWNLOAD ============
def sanitize_filename(name, max_len=80):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', name)
    name = re.sub(r'\s+', '_', name)
    name = name.strip('._')
    return name[:max_len] if len(name) > max_len else name

def download_image(session, image_url, save_path):
    if not image_url or os.path.exists(save_path):
        return save_path if os.path.exists(save_path) else None
    try:
        resp = session.get(image_url, timeout=IMAGE_DOWNLOAD_TIMEOUT)
        if resp.status_code == 200 and len(resp.content) > 100:
            os.makedirs(os.path.dirname(save_path), exist_ok=True)
            with open(save_path, 'wb') as f:
                f.write(resp.content)
            return save_path
    except:
        pass
    return None

# ============ DATABASE ============
def create_database(db_path):
    if os.path.exists(db_path):
        os.remove(db_path)
    
    conn = sqlite3.connect(str(db_path))
    c = conn.cursor()
    
    c.execute('''CREATE TABLE categorias (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE,
        url TEXT
    )''')
    
    c.execute('''CREATE TABLE subcategorias (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        slug TEXT,
        categoria_id INTEGER NOT NULL,
        url TEXT,
        FOREIGN KEY (categoria_id) REFERENCES categorias(id)
    )''')
    
    c.execute('''CREATE TABLE productos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        producto_id TEXT,
        nombre TEXT NOT NULL,
        marca TEXT,
        fabricante TEXT,
        modelo TEXT,
        precio TEXT,
        precio_anterior TEXT,
        precio_unitario TEXT,
        imagen_url TEXT,
        imagen_local TEXT,
        url_producto TEXT,
        descripcion_corta TEXT,
        subcategoria_id INTEGER,
        FOREIGN KEY (subcategoria_id) REFERENCES subcategorias(id)
    )''')
    
    c.execute('CREATE INDEX idx_prod_subcat ON productos(subcategoria_id)')
    c.execute('CREATE INDEX idx_prod_marca ON productos(marca)')
    c.execute('CREATE INDEX idx_subcat_cat ON subcategorias(categoria_id)')
    
    conn.commit()
    return conn

# ============ PROCESS CATEGORIES ============
def group_subcategories(raw_subcats):
    """Group flat subcategory list by URL slug."""
    grouped = {}
    for subcat in raw_subcats:
        url = subcat["url"]
        path_parts = urlparse(url).path.split("/")
        # /browse/cat/subcat-group/item/ids
        if len(path_parts) >= 4:
            group = unquote(path_parts[3])
        else:
            group = "general"
        
        if group not in grouped:
            grouped[group] = []
        grouped[group].append(subcat)
    
    return grouped

# ============ MAIN ============
def main():
    print("🛒 Scraper de super.lider.cl")
    print("=" * 60)
    
    # Load category data
    raw_data = load_categories()
    if not raw_data:
        print("❌ No se encontró raw_categories.json")
        print("   Ejecute primero la extracción de categorías desde el navegador")
        return
    
    # Filter categories for household shopping
    skip_categories = {"Marcas Propias", "Marcas Americanas", "La Boti", "Soy Pyme", "Campañas"}
    
    session = create_session()
    conn = create_database(OUTPUT_SQLITE)
    cursor = conn.cursor()
    
    json_result = {}
    total_products = 0
    total_images = 0
    total_errors = 0
    
    for cat_name, cat_data in raw_data.items():
        if cat_name in skip_categories:
            print(f"\n⏭️  Saltando: {cat_name}")
            continue
        
        print(f"\n{'='*60}")
        print(f"📁 {cat_name}")
        print(f"{'='*60}")
        
        # Insert category
        cursor.execute("INSERT OR IGNORE INTO categorias (nombre, url) VALUES (?, ?)",
                       (cat_name, cat_data.get("categoryUrl", "")))
        conn.commit()
        cursor.execute("SELECT id FROM categorias WHERE nombre = ?", (cat_name,))
        cat_id = cursor.fetchone()[0]
        
        json_result[cat_name] = {"url": cat_data.get("categoryUrl", ""), "subcategorias": {}}
        
        # Group subcategories
        subcats = cat_data.get("subcategories", [])
        grouped = group_subcategories(subcats)
        
        for subcat_slug, items in grouped.items():
            subcat_name = subcat_slug.replace("-", " ").title()
            
            # Insert subcategory
            cursor.execute("INSERT INTO subcategorias (nombre, slug, categoria_id) VALUES (?, ?, ?)",
                           (subcat_name, subcat_slug, cat_id))
            conn.commit()
            subcat_id = cursor.lastrowid
            
            json_result[cat_name]["subcategorias"][subcat_name] = {"slug": subcat_slug, "productos": []}
            
            # Image directory
            cat_dir = sanitize_filename(cat_name)
            subcat_dir = sanitize_filename(subcat_name)
            img_dir = IMAGES_DIR / cat_dir / subcat_dir
            
            for item_info in items:
                item_name = item_info["name"]
                item_url = item_info["url"]
                
                if item_name.lower().strip() in ["revisar todo", "revisar todo "]:
                    continue
                
                print(f"  🔍 {item_name}: ", end="", flush=True)
                time.sleep(REQUEST_DELAY)
                
                try:
                    products = fetch_all_products(session, item_url)
                    print(f"{len(products)} productos")
                except Exception as e:
                    print(f"Error: {e}")
                    total_errors += 1
                    continue
                
                os.makedirs(img_dir, exist_ok=True)
                
                for product in products:
                    # Download image
                    img_local = ""
                    if product["imagen_url"]:
                        ext = ".png" if ".png" in product["imagen_url"].lower() else ".jpg"
                        img_filename = sanitize_filename(product["nombre"]) + ext
                        img_path = img_dir / img_filename
                        
                        if os.path.exists(img_path):
                            h = hashlib.md5(product["imagen_url"].encode()).hexdigest()[:8]
                            img_filename = sanitize_filename(product["nombre"]) + f"_{h}" + ext
                            img_path = img_dir / img_filename
                        
                        result = download_image(session, product["imagen_url"], str(img_path))
                        if result:
                            img_local = str(img_path)
                            total_images += 1
                    
                    product["imagen_local"] = img_local
                    
                    # Insert into DB
                    cursor.execute("""INSERT INTO productos 
                        (producto_id, nombre, marca, fabricante, modelo, precio, precio_anterior,
                         precio_unitario, imagen_url, imagen_local, url_producto, descripcion_corta, subcategoria_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (product["id"], product["nombre"], product["marca"], product["fabricante"],
                         product["modelo"], product["precio"], product["precio_anterior"],
                         product["precio_unitario"], product["imagen_url"], product["imagen_local"],
                         product["url_producto"], product["descripcion_corta"], subcat_id))
                    
                    total_products += 1
                
                conn.commit()
                json_result[cat_name]["subcategorias"][subcat_name]["productos"].extend(products)
    
    # Save JSON
    print(f"\n💾 Guardando JSON...")
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(json_result, f, ensure_ascii=False, indent=2)
    
    conn.close()
    
    print(f"\n{'='*60}")
    print(f"✅ COMPLETADO")
    print(f"{'='*60}")
    print(f"📊 Total productos: {total_products}")
    print(f"🖼️  Total imágenes: {total_images}")
    print(f"❌ Errores: {total_errors}")
    print(f"📁 JSON: {OUTPUT_JSON}")
    print(f"🗄️  SQLite: {OUTPUT_SQLITE}")
    print(f"🖼️  Imágenes: {IMAGES_DIR}")

if __name__ == "__main__":
    main()
