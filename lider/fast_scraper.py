#!/usr/bin/env python3
"""
Optimized scraper for super.lider.cl
Uses concurrent image downloads for speed.
"""

import json
import os
import re
import sqlite3
import sys
import time
import hashlib
from pathlib import Path
from urllib.parse import urlparse, unquote
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ============ CONFIGURATION ============
BASE_DIR = Path("/home/ubuntu/lider_scraper")
IMAGES_DIR = BASE_DIR / "imagenes"
OUTPUT_JSON = BASE_DIR / "productos_lider.json"
OUTPUT_SQLITE = BASE_DIR / "productos_lider.db"

REQUEST_DELAY = 0.5
IMAGE_WORKERS = 8
HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-CL,es;q=0.9",
}

# Categories to skip (meta-categories, not actual product categories)
SKIP_CATEGORIES = {"Marcas Propias", "Marcas Americanas", "La Boti", "Soy Pyme", "Campañas"}

def log(msg):
    print(msg, flush=True)

def create_session():
    session = requests.Session()
    retry = Retry(total=3, backoff_factor=0.5, status_forcelist=[429, 500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retry, pool_connections=20, pool_maxsize=20)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update(HEADERS)
    return session

def extract_products_from_html(html_text):
    scripts = re.findall(r'<script[^>]*>(.*?)</script>', html_text, re.DOTALL)
    for s in scripts:
        if s.startswith('{"props"'):
            try:
                data = json.loads(s)
                sr = data["props"]["pageProps"]["initialData"]["searchResult"]
                stacks = sr.get("itemStacks", [])
                products = []
                total = 0
                for stack in stacks:
                    total = max(total, stack.get("count", 0))
                    for item in stack.get("items", []):
                        tn = item.get("__typename", "")
                        if tn in ["TileTakeOverProductPlaceholder", "AdPlaceholder", ""]:
                            continue
                        name = item.get("name", "")
                        if not name:
                            continue
                        
                        img_url = ""
                        ii = item.get("imageInfo") or {}
                        if ii.get("thumbnailUrl"):
                            img_url = ii["thumbnailUrl"]
                        else:
                            io = item.get("image") or {}
                            if isinstance(io, dict):
                                img_url = io.get("thumbnailUrl", "") or io.get("url", "")
                        
                        pi = item.get("priceInfo") or {}
                        cu = item.get("canonicalUrl", "") or ""
                        
                        products.append({
                            "id": item.get("id", "") or item.get("usItemId", "") or "",
                            "nombre": name,
                            "marca": item.get("brand", "") or "",
                            "fabricante": item.get("manufacturerName", "") or "",
                            "modelo": "",
                            "precio": pi.get("linePrice", "") or "",
                            "precio_anterior": pi.get("wasPrice", "") or "",
                            "precio_unitario": pi.get("unitPrice", "") or "",
                            "imagen_url": img_url,
                            "url_producto": f"https://super.lider.cl{cu}" if cu else "",
                            "descripcion_corta": item.get("shortDescription", "") or "",
                        })
                return products, total
            except (json.JSONDecodeError, KeyError, TypeError):
                continue
    return [], 0

def fetch_all_products(session, url):
    all_products = []
    seen = set()
    
    try:
        resp = session.get(url, timeout=30)
        if resp.status_code != 200:
            return []
        products, total = extract_products_from_html(resp.text)
    except Exception as e:
        log(f"    Error: {e}")
        return []
    
    for p in products:
        pid = p["id"] or p["nombre"]
        if pid not in seen:
            seen.add(pid)
            all_products.append(p)
    
    if total > 40:
        pages = min((total + 39) // 40, 25)
        for page in range(2, pages + 1):
            time.sleep(REQUEST_DELAY)
            try:
                sep = "&" if "?" in url else "?"
                resp = session.get(f"{url}{sep}page={page}", timeout=30)
                if resp.status_code != 200:
                    break
                products, _ = extract_products_from_html(resp.text)
                new = 0
                for p in products:
                    pid = p["id"] or p["nombre"]
                    if pid not in seen:
                        seen.add(pid)
                        all_products.append(p)
                        new += 1
                if new == 0:
                    break
            except:
                break
    
    return all_products

def sanitize_filename(name, max_len=80):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', name)
    name = re.sub(r'\s+', '_', name)
    name = name.strip('._')
    return name[:max_len] if len(name) > max_len else name

def download_image(args):
    session, url, path = args
    if not url or os.path.exists(path):
        return path if os.path.exists(path) else None
    try:
        resp = session.get(url, timeout=15)
        if resp.status_code == 200 and len(resp.content) > 100:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'wb') as f:
                f.write(resp.content)
            return path
    except:
        pass
    return None

def group_subcategories(subcats):
    grouped = {}
    for sc in subcats:
        parts = urlparse(sc["url"]).path.split("/")
        group = unquote(parts[3]) if len(parts) >= 4 else "general"
        grouped.setdefault(group, []).append(sc)
    return grouped

def create_database(db_path):
    if os.path.exists(db_path):
        os.remove(db_path)
    conn = sqlite3.connect(str(db_path))
    c = conn.cursor()
    c.execute('CREATE TABLE categorias (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL UNIQUE, url TEXT)')
    c.execute('CREATE TABLE subcategorias (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, slug TEXT, categoria_id INTEGER NOT NULL, FOREIGN KEY (categoria_id) REFERENCES categorias(id))')
    c.execute('CREATE TABLE productos (id INTEGER PRIMARY KEY AUTOINCREMENT, producto_id TEXT, nombre TEXT NOT NULL, marca TEXT, fabricante TEXT, modelo TEXT, precio TEXT, precio_anterior TEXT, precio_unitario TEXT, imagen_url TEXT, imagen_local TEXT, url_producto TEXT, descripcion_corta TEXT, subcategoria_id INTEGER, FOREIGN KEY (subcategoria_id) REFERENCES subcategorias(id))')
    c.execute('CREATE INDEX idx_prod_subcat ON productos(subcategoria_id)')
    c.execute('CREATE INDEX idx_prod_marca ON productos(marca)')
    c.execute('CREATE INDEX idx_subcat_cat ON subcategorias(categoria_id)')
    conn.commit()
    return conn

def main():
    log("🛒 Scraper de super.lider.cl - Versión Optimizada")
    log("=" * 60)
    
    with open(BASE_DIR / "raw_categories.json", 'r', encoding='utf-8') as f:
        raw_data = json.load(f)
    
    session = create_session()
    img_session = create_session()  # Separate session for images
    conn = create_database(OUTPUT_SQLITE)
    cursor = conn.cursor()
    
    json_result = {}
    stats = {"products": 0, "images": 0, "errors": 0}
    
    for cat_name, cat_data in raw_data.items():
        if cat_name in SKIP_CATEGORIES:
            log(f"\n⏭️  Saltando: {cat_name}")
            continue
        
        log(f"\n{'='*60}")
        log(f"📁 {cat_name}")
        log(f"{'='*60}")
        
        cursor.execute("INSERT OR IGNORE INTO categorias (nombre, url) VALUES (?, ?)",
                       (cat_name, cat_data.get("categoryUrl", "")))
        conn.commit()
        cursor.execute("SELECT id FROM categorias WHERE nombre = ?", (cat_name,))
        cat_id = cursor.fetchone()[0]
        
        json_result[cat_name] = {"url": cat_data.get("categoryUrl", ""), "subcategorias": {}}
        
        grouped = group_subcategories(cat_data.get("subcategories", []))
        
        for subcat_slug, items in grouped.items():
            subcat_name = subcat_slug.replace("-", " ").title()
            
            cursor.execute("INSERT INTO subcategorias (nombre, slug, categoria_id) VALUES (?, ?, ?)",
                           (subcat_name, subcat_slug, cat_id))
            conn.commit()
            subcat_id = cursor.lastrowid
            
            json_result[cat_name]["subcategorias"][subcat_name] = {"slug": subcat_slug, "productos": []}
            
            cat_dir = sanitize_filename(cat_name)
            subcat_dir = sanitize_filename(subcat_name)
            img_dir = IMAGES_DIR / cat_dir / subcat_dir
            
            for item_info in items:
                item_name = item_info["name"]
                if item_name.lower().strip() in ["revisar todo"]:
                    continue
                
                time.sleep(REQUEST_DELAY)
                products = fetch_all_products(session, item_info["url"])
                log(f"  🔍 {item_name}: {len(products)} productos")
                
                if not products:
                    continue
                
                os.makedirs(img_dir, exist_ok=True)
                
                # Prepare image download tasks
                img_tasks = []
                for product in products:
                    img_local = ""
                    if product["imagen_url"]:
                        ext = ".png" if ".png" in product["imagen_url"].lower() else ".jpg"
                        fn = sanitize_filename(product["nombre"]) + ext
                        fp = str(img_dir / fn)
                        if os.path.exists(fp):
                            h = hashlib.md5(product["imagen_url"].encode()).hexdigest()[:8]
                            fn = sanitize_filename(product["nombre"]) + f"_{h}" + ext
                            fp = str(img_dir / fn)
                        product["_img_path"] = fp
                        img_tasks.append((img_session, product["imagen_url"], fp))
                    else:
                        product["_img_path"] = ""
                
                # Download images concurrently
                results = {}
                with ThreadPoolExecutor(max_workers=IMAGE_WORKERS) as executor:
                    futures = {executor.submit(download_image, task): task[2] for task in img_tasks}
                    for future in as_completed(futures):
                        path = futures[future]
                        result = future.result()
                        results[path] = result
                
                # Insert products into DB
                for product in products:
                    img_path = product.pop("_img_path", "")
                    img_local = results.get(img_path, "") or ""
                    if img_local:
                        stats["images"] += 1
                    product["imagen_local"] = img_local
                    
                    cursor.execute("""INSERT INTO productos 
                        (producto_id, nombre, marca, fabricante, modelo, precio, precio_anterior,
                         precio_unitario, imagen_url, imagen_local, url_producto, descripcion_corta, subcategoria_id)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (product["id"], product["nombre"], product["marca"], product["fabricante"],
                         product["modelo"], product["precio"], product["precio_anterior"],
                         product["precio_unitario"], product["imagen_url"], product["imagen_local"],
                         product["url_producto"], product["descripcion_corta"], subcat_id))
                    stats["products"] += 1
                
                conn.commit()
                json_result[cat_name]["subcategorias"][subcat_name]["productos"].extend(products)
        
        # Progress update after each category
        log(f"  📊 Progreso: {stats['products']} productos, {stats['images']} imágenes")
    
    # Save JSON
    log(f"\n💾 Guardando JSON...")
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(json_result, f, ensure_ascii=False, indent=2)
    
    conn.close()
    
    log(f"\n{'='*60}")
    log(f"✅ COMPLETADO")
    log(f"{'='*60}")
    log(f"📊 Total productos: {stats['products']}")
    log(f"🖼️  Total imágenes: {stats['images']}")
    log(f"📁 JSON: {OUTPUT_JSON}")
    log(f"🗄️  SQLite: {OUTPUT_SQLITE}")
    log(f"🖼️  Imágenes: {IMAGES_DIR}")

if __name__ == "__main__":
    main()
