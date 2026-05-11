#!/usr/bin/env python3
"""
Scraper para super.lider.cl
Extrae productos de todas las categorías y subcategorías.
Guarda en JSON y SQLite, descarga imágenes.
"""

import json
import os
import re
import sqlite3
import time
import hashlib
import urllib.parse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ============ CONFIGURATION ============
BASE_DIR = Path("/home/ubuntu/lider_scraper")
IMAGES_DIR = BASE_DIR / "imagenes"
OUTPUT_JSON = BASE_DIR / "productos_lider.json"
OUTPUT_SQLITE = BASE_DIR / "productos_lider.db"
CATEGORIES_FILE = BASE_DIR / "categories_data.json"

MAX_WORKERS_DOWNLOAD = 10
REQUEST_DELAY = 1.0  # seconds between page requests
IMAGE_DOWNLOAD_TIMEOUT = 15

# ============ SESSION SETUP ============
def create_session():
    session = requests.Session()
    retry = Retry(total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
    })
    return session

# ============ EXTRACT PRODUCTS FROM PAGE ============
def extract_products_from_html(html_text):
    """Extract product data from __NEXT_DATA__ JSON embedded in the page."""
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
        count = stack.get("count", 0)
        if count > total_count:
            total_count = count
        
        items = stack.get("items", [])
        for item in items:
            # Skip non-product items (ads, banners, etc.)
            item_type = item.get("__typename", "")
            if item_type in ["TileTakeOverProductPlaceholder", "AdPlaceholder", ""]:
                continue
            
            name = item.get("name", "")
            if not name:
                continue
            
            brand = item.get("brand", "") or ""
            manufacturer = item.get("manufacturerName", "") or ""
            
            # Price info
            price_info = item.get("priceInfo", {}) or {}
            line_price = price_info.get("linePrice", "") or ""
            was_price = price_info.get("wasPrice", "") or ""
            unit_price = price_info.get("unitPrice", "") or ""
            
            # Image
            image_info = item.get("imageInfo", {}) or {}
            image_obj = item.get("image", {}) or {}
            
            image_url = ""
            if image_info and image_info.get("thumbnailUrl"):
                image_url = image_info["thumbnailUrl"]
            elif isinstance(image_obj, dict) and image_obj.get("thumbnailUrl"):
                image_url = image_obj["thumbnailUrl"]
            elif isinstance(image_obj, str):
                image_url = image_obj
            
            product_id = item.get("id", "") or item.get("usItemId", "") or ""
            canonical_url = item.get("canonicalUrl", "") or ""
            
            # Model - check various fields
            model = ""
            short_desc = item.get("shortDescription", "") or ""
            
            products.append({
                "id": product_id,
                "nombre": name,
                "marca": brand,
                "fabricante": manufacturer,
                "modelo": model,
                "precio": line_price,
                "precio_anterior": was_price,
                "precio_unitario": unit_price,
                "imagen_url": image_url,
                "url_producto": f"https://super.lider.cl{canonical_url}" if canonical_url else "",
                "descripcion_corta": short_desc,
            })
    
    return products, total_count

def fetch_page_products(session, url, page=1):
    """Fetch products from a specific page of a subcategory."""
    # Add page parameter if needed
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
            print(f"  HTTP {resp.status_code} for {fetch_url}")
            return [], 0
    except Exception as e:
        print(f"  Error fetching {fetch_url}: {e}")
        return [], 0

def fetch_all_products_for_subcategory(session, url):
    """Fetch all products for a subcategory, handling pagination."""
    all_products = []
    seen_ids = set()
    
    products, total_count = fetch_page_products(session, url, page=1)
    
    for p in products:
        pid = p["id"] or p["nombre"]
        if pid not in seen_ids:
            seen_ids.add(pid)
            all_products.append(p)
    
    # Check if there are more pages (40 items per page typically)
    items_per_page = 40
    if total_count > items_per_page:
        total_pages = (total_count + items_per_page - 1) // items_per_page
        total_pages = min(total_pages, 25)  # Cap at 25 pages
        
        for page in range(2, total_pages + 1):
            time.sleep(REQUEST_DELAY)
            products, _ = fetch_page_products(session, url, page=page)
            
            new_count = 0
            for p in products:
                pid = p["id"] or p["nombre"]
                if pid not in seen_ids:
                    seen_ids.add(pid)
                    all_products.append(p)
                    new_count += 1
            
            if new_count == 0:
                break  # No new products, stop pagination
    
    return all_products

# ============ IMAGE DOWNLOAD ============
def sanitize_filename(name, max_len=80):
    """Create a safe filename from a product name."""
    name = re.sub(r'[<>:"/\\|?*]', '', name)
    name = re.sub(r'\s+', '_', name)
    name = name.strip('._')
    if len(name) > max_len:
        name = name[:max_len]
    return name

def download_image(session, image_url, save_path):
    """Download an image to the specified path."""
    if not image_url or os.path.exists(save_path):
        return save_path if os.path.exists(save_path) else None
    
    try:
        resp = session.get(image_url, timeout=IMAGE_DOWNLOAD_TIMEOUT)
        if resp.status_code == 200 and len(resp.content) > 100:
            os.makedirs(os.path.dirname(save_path), exist_ok=True)
            with open(save_path, 'wb') as f:
                f.write(resp.content)
            return save_path
    except Exception as e:
        pass
    return None

# ============ DATABASE ============
def create_database(db_path):
    """Create SQLite database with proper schema."""
    conn = sqlite3.connect(str(db_path))
    c = conn.cursor()
    
    c.execute('''CREATE TABLE IF NOT EXISTS categorias (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE,
        url TEXT
    )''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS subcategorias (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        slug TEXT,
        categoria_id INTEGER NOT NULL,
        url TEXT,
        FOREIGN KEY (categoria_id) REFERENCES categorias(id),
        UNIQUE(nombre, categoria_id)
    )''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS productos (
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
    
    c.execute('CREATE INDEX IF NOT EXISTS idx_productos_subcategoria ON productos(subcategoria_id)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_productos_marca ON productos(marca)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_subcategorias_categoria ON subcategorias(categoria_id)')
    
    conn.commit()
    return conn

# ============ MAIN ============
def main():
    # Load category data
    with open(CATEGORIES_FILE, 'r', encoding='utf-8') as f:
        all_cat_data = json.load(f)
    
    session = create_session()
    
    # Create database
    conn = create_database(OUTPUT_SQLITE)
    cursor = conn.cursor()
    
    # Result structure for JSON
    json_result = {}
    
    # Statistics
    total_products = 0
    total_images = 0
    
    # Filter out non-product categories
    skip_categories = {"Marcas Propias", "Marcas Americanas", "La Boti", "Soy Pyme", "Campañas"}
    
    for cat_name, cat_data in all_cat_data.items():
        if cat_name in skip_categories:
            print(f"\n⏭️  Saltando categoría especial: {cat_name}")
            continue
            
        print(f"\n{'='*60}")
        print(f"📁 Categoría: {cat_name}")
        print(f"{'='*60}")
        
        # Insert category into DB
        cursor.execute("INSERT OR IGNORE INTO categorias (nombre, url) VALUES (?, ?)",
                       (cat_name, cat_data.get("categoryUrl", "")))
        conn.commit()
        cursor.execute("SELECT id FROM categorias WHERE nombre = ?", (cat_name,))
        cat_id = cursor.fetchone()[0]
        
        json_result[cat_name] = {
            "url": cat_data.get("categoryUrl", ""),
            "subcategorias": {}
        }
        
        subcategories = cat_data.get("subcategories", {})
        
        for subcat_slug, subcat_items in subcategories.items():
            subcat_display_name = subcat_slug.replace("-", " ").title()
            
            print(f"\n  📂 Subcategoría: {subcat_display_name} ({len(subcat_items)} sub-items)")
            
            # Insert subcategory
            cursor.execute("INSERT OR IGNORE INTO subcategorias (nombre, slug, categoria_id, url) VALUES (?, ?, ?, ?)",
                           (subcat_display_name, subcat_slug, cat_id, ""))
            conn.commit()
            cursor.execute("SELECT id FROM subcategorias WHERE nombre = ? AND categoria_id = ?",
                           (subcat_display_name, cat_id))
            subcat_id = cursor.fetchone()[0]
            
            json_result[cat_name]["subcategorias"][subcat_display_name] = {
                "slug": subcat_slug,
                "items": {},
                "productos": []
            }
            
            # Process each sub-item URL
            for item_info in subcat_items:
                item_name = item_info["name"]
                item_url = item_info["url"]
                
                # Skip "Revisar todo" entries
                if item_name.lower() in ["revisar todo", "revisar todo "]:
                    continue
                
                print(f"    🔍 {item_name}: ", end="", flush=True)
                
                time.sleep(REQUEST_DELAY)
                products = fetch_all_products_for_subcategory(session, item_url)
                
                print(f"{len(products)} productos")
                
                # Create image directory
                cat_dir_name = sanitize_filename(cat_name)
                subcat_dir_name = sanitize_filename(subcat_display_name)
                img_dir = IMAGES_DIR / cat_dir_name / subcat_dir_name
                os.makedirs(img_dir, exist_ok=True)
                
                for product in products:
                    # Download image
                    img_local = ""
                    if product["imagen_url"]:
                        ext = ".jpg"
                        if ".png" in product["imagen_url"].lower():
                            ext = ".png"
                        img_filename = sanitize_filename(product["nombre"]) + ext
                        img_path = img_dir / img_filename
                        
                        # If file exists with same name, add hash
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
                
                # Add to JSON
                json_result[cat_name]["subcategorias"][subcat_display_name]["items"][item_name] = products
                json_result[cat_name]["subcategorias"][subcat_display_name]["productos"].extend(products)
    
    # Save JSON
    print(f"\n\n💾 Guardando JSON...")
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(json_result, f, ensure_ascii=False, indent=2)
    
    conn.close()
    
    print(f"\n{'='*60}")
    print(f"✅ COMPLETADO")
    print(f"{'='*60}")
    print(f"📊 Total productos: {total_products}")
    print(f"🖼️  Total imágenes descargadas: {total_images}")
    print(f"📁 JSON: {OUTPUT_JSON}")
    print(f"🗄️  SQLite: {OUTPUT_SQLITE}")
    print(f"🖼️  Imágenes: {IMAGES_DIR}")

if __name__ == "__main__":
    main()
