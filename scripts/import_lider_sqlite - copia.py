#!/usr/bin/env python3
"""
Importación puntual: SQLite del scraper -> Postgres (Supabase). La app en Vercel solo usa Supabase.
Las miniaturas se registran en catalog_product_media + Storage bucket catalog-thumbnails (sin rutas locales).

Requisitos:
  pip install -r scripts/requirements-import.txt

Variables de entorno:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (obligatorias)
  LIDER_SQLITE   ruta al .db (default: lider/productos_lider.db)
  LIDER_IMAGENES ruta a la carpeta imagenes (default: lider/imagenes)
  IMPORT_SSL_VERIFY  por defecto 1. Pon 0 si aparece SSL: CERTIFICATE_VERIFY_FAILED
    (proxy corporativo / cadena con certificado autofirmado). Menos seguro; mejor
    solución: instalar el CA de la empresa o usar SSL_CERT_FILE.

  Si aparece 401 Invalid API key: en Supabase → Project Settings → API copia la clave
  secreta **service_role** (JWT largo que suele empezar por eyJ). No uses la clave
  publishable/anon (sb_publishable_...). El script carga .env.local si existe.

Uso:
  python scripts/import_lider_sqlite.py
  python scripts/import_lider_sqlite.py --dry-run --limit 200
  python scripts/import_lider_sqlite.py --skip-thumbnails
  python scripts/import_lider_sqlite.py --thumbnails-only   # solo miniaturas (SQLite + productos ya en Supabase)
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re
import sqlite3
import ssl
import sys
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

# Raíz del repo (padre de scripts/)
ROOT = Path(__file__).resolve().parent.parent


def env_ssl_verify() -> bool:
    """True = verificar certificados TLS (recomendado)."""
    return os.environ.get("IMPORT_SSL_VERIFY", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def load_local_env() -> None:
    """Carga .env y .env.local; override=True para que el archivo gane sobre variables viejas en la sesión."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    for fname in (".env", ".env.local"):
        p = ROOT / fname
        if p.is_file():
            load_dotenv(p, override=True)


def normalize_env_str(value: str | None) -> str:
    if not value:
        return ""
    s = value.strip().strip('"').strip("'")
    if s.startswith("\ufeff"):
        s = s.lstrip("\ufeff")
    return s


def supabase_project_ref_from_url(url: str) -> str | None:
    try:
        host = urlparse(url.strip()).hostname or ""
        if ".supabase.co" not in host:
            return None
        return host.split(".")[0]
    except Exception:
        return None


def jwt_payload_unverified(token: str) -> dict[str, Any] | None:
    if token.count(".") != 2:
        return None
    try:
        payload_b64 = token.split(".")[1]
        pad = "=" * (-len(payload_b64) % 4)
        raw = base64.urlsafe_b64decode(payload_b64 + pad)
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None


def assert_url_and_service_role_match(url: str, key: str) -> None:
    """Evita 401 confuso: URL de un proyecto y JWT de otro (o rol incorrecto)."""
    if key.startswith("sb_publishable_") or key.startswith("sb_secret_"):
        return
    ref_url = supabase_project_ref_from_url(url)
    payload = jwt_payload_unverified(key)
    if not payload or not ref_url:
        return
    role = payload.get("role")
    if role and role != "service_role":
        print(
            f"Error: el JWT no es service_role (role={role!r}). "
            "Copia la clave «service_role» secreta, no anon.",
            file=sys.stderr,
        )
        sys.exit(1)
    ref_jwt = payload.get("ref")
    if ref_jwt and ref_jwt != ref_url:
        print(
            "Error: la URL del proyecto no coincide con la clave service_role.\n"
            f"  Host del proyecto en URL: {ref_url}\n"
            f"  Campo «ref» dentro del JWT: {ref_jwt}\n"
            "  Copia URL y service_role del mismo proyecto en Supabase → Settings → API.",
            file=sys.stderr,
        )
        sys.exit(1)


def check_service_role_key(key: str) -> None:
    """Evita confusiones típicas entre anon/publishable y service_role."""
    if key.startswith("sb_publishable_"):
        print(
            "Error: SUPABASE_SERVICE_ROLE_KEY es la clave publishable (pública). "
            "Necesitas la clave secreta service_role en Supabase → Settings → API.",
            file=sys.stderr,
        )
        sys.exit(1)
    if len(key) < 20:
        print(
            "Error: SUPABASE_SERVICE_ROLE_KEY parece incompleta o vacía.",
            file=sys.stderr,
        )
        sys.exit(1)
    if not key.startswith("eyJ") and not key.startswith("sb_secret_"):
        print(
            "Advertencia: la service_role suele ser un JWT (empieza con eyJ) o sb_secret_*. "
            "Si falla con 401, revisa el dashboard.",
            file=sys.stderr,
        )


def create_supabase_client(url: str, key: str):
    """Cliente Supabase; opción IMPORT_SSL_VERIFY=0 para HTTPS detrás de proxy SSL."""
    if env_ssl_verify():
        from supabase import create_client

        return create_client(url, key)
    import httpx
    from supabase import ClientOptions, create_client

    return create_client(
        url,
        key,
        options=ClientOptions(httpx_client=httpx.Client(verify=False)),
    )


def parse_clp(s: str | None) -> float | None:
    if not s or not str(s).strip():
        return None
    digits = re.sub(r"[^\d]", "", str(s))
    if not digits:
        return None
    try:
        return float(int(digits))
    except ValueError:
        return None


def resolve_local_image(sqlite_path: str | None, image_root: Path) -> Path | None:
    if not sqlite_path:
        return None
    p = sqlite_path.replace("\\", "/")
    key = "imagenes/"
    if key in p:
        rel = p.split(key, 1)[1]
        candidate = image_root / rel
        if candidate.is_file():
            return candidate
    # sólo nombre de archivo al final
    name = Path(p).name
    if name:
        for found in image_root.rglob(name):
            if found.is_file():
                return found
    return None


def webp_thumbnail(data: bytes, max_side: int = 384, quality: int = 82) -> bytes:
    from PIL import Image

    im = Image.open(io.BytesIO(data)).convert("RGB")
    im.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    im.save(buf, format="WEBP", quality=quality)
    return buf.getvalue()


def norm_taxonomy_label(s: str) -> str:
    """Espacios colapsados y trim (evita categorías/secciones duplicadas por formato)."""
    return " ".join((s or "").strip().split())


def norm_brand_key(s: str) -> str:
    return norm_taxonomy_label(s).lower()


def resolve_brand(
    supabase: Any,
    marca_raw: str | None,
    brand_by_key: dict[str, dict[str, str]],
) -> tuple[str | None, str | None]:
    """Devuelve (brand_id, texto de marca canónico) o (None, None)."""
    display = norm_taxonomy_label(marca_raw or "")
    if not display:
        return None, None
    key = norm_brand_key(display)
    if key in brand_by_key:
        b = brand_by_key[key]
        return b["id"], b["name"]
    try:
        ins = supabase.table("catalog_brands").insert({"name": display}).execute()
        bid = ins.data[0]["id"]
        brand_by_key[key] = {"id": bid, "name": display}
        return bid, display
    except Exception:
        res = supabase.table("catalog_brands").select("id,name").execute()
        brand_by_key.clear()
        for row in res.data or []:
            nk = norm_brand_key(row["name"])
            if nk:
                brand_by_key[nk] = {"id": row["id"], "name": row["name"]}
        if key in brand_by_key:
            b = brand_by_key[key]
            return b["id"], b["name"]
        raise


def try_upload_thumbnail(
    supabase: Any,
    cp_id: str,
    row: sqlite3.Row,
    image_root: Path,
) -> bool:
    """Genera WebP, sube a Storage y crea catalog_product_media. True si hubo miniatura."""
    local_path = resolve_local_image(row["imagen_local"], image_root)
    raw: bytes | None = None
    if local_path and local_path.is_file():
        raw = local_path.read_bytes()
    elif row["imagen_url"]:
        try:
            import urllib.request

            req = urllib.request.Request(
                row["imagen_url"],
                headers={"User-Agent": "StockCasaImport/1.0"},
            )
            open_kw: dict = {"timeout": 25}
            if not env_ssl_verify():
                open_kw["context"] = ssl._create_unverified_context()
            with urllib.request.urlopen(req, **open_kw) as resp:
                raw = resp.read()
        except OSError:
            raw = None

    if not raw or len(raw) <= 80:
        return False

    webp = webp_thumbnail(raw)
    path = f"{cp_id}.webp"
    supabase.storage.from_("catalog-thumbnails").upload(
        path,
        webp,
        file_options={"content-type": "image/webp", "upsert": "true"},
    )
    pub = supabase.storage.from_("catalog-thumbnails").get_public_url(path)
    thumb_url = (
        pub["publicUrl"]
        if isinstance(pub, dict) and "publicUrl" in pub
        else getattr(pub, "publicUrl", None) or str(pub)
    )
    supabase.table("catalog_product_media").delete().eq(
        "catalog_product_id", cp_id
    ).eq("kind", "thumbnail").execute()
    supabase.table("catalog_product_media").insert(
        {
            "catalog_product_id": cp_id,
            "kind": "thumbnail",
            "bucket_id": "catalog-thumbnails",
            "object_path": path,
            "public_url": thumb_url,
        }
    ).execute()
    return True


def run_thumbnails_only(
    args: argparse.Namespace,
    url: str,
    key: str,
    supabase: Any,
) -> int:
    """Solo sube miniaturas para filas del catálogo que ya existen y aún no tienen thumbnail."""
    if not args.sqlite.is_file():
        print(f"No existe la base SQLite: {args.sqlite}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(str(args.sqlite))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        """
        SELECT imagen_url, imagen_local, url_producto
        FROM productos
        WHERE url_producto IS NOT NULL AND trim(url_producto) != ''
        """
    )
    rows = cur.fetchall()
    conn.close()

    total = len(rows)
    if args.limit > 0:
        rows = rows[: args.limit]

    ok = 0
    skipped_no_cp = 0
    skipped_has_thumb = 0
    missing = 0

    for idx, row in enumerate(rows, start=1):
        url_p = (row["url_producto"] or "").strip()
        cp_res = (
            supabase.table("catalog_products")
            .select("id")
            .eq("source_product_url", url_p)
            .limit(1)
            .execute()
        )
        if not cp_res.data:
            skipped_no_cp += 1
            continue
        cp_id = cp_res.data[0]["id"]
        med = (
            supabase.table("catalog_product_media")
            .select("id")
            .eq("catalog_product_id", cp_id)
            .eq("kind", "thumbnail")
            .limit(1)
            .execute()
        )
        if med.data:
            skipped_has_thumb += 1
            continue
        try:
            if try_upload_thumbnail(supabase, cp_id, row, args.imagenes):
                ok += 1
            else:
                missing += 1
        except Exception as e:
            print(f"Thumb error {cp_id}: {e}", file=sys.stderr)
            missing += 1

        if idx % 500 == 0:
            print(f"  … thumbs fila {idx}/{len(rows)}")

    print(
        f"Miniaturas: OK={ok}, sin imagen fuente={missing}, ya tenían thumb={skipped_has_thumb}, "
        f"sin producto en catálogo={skipped_no_cp}"
    )
    return 0


def main() -> int:
    load_local_env()

    parser = argparse.ArgumentParser(description="Import Lider SQLite -> Supabase catalog")
    parser.add_argument("--dry-run", action="store_true", help="No escribe en Supabase")
    parser.add_argument("--limit", type=int, default=0, help="Máximo productos a procesar (0=todos)")
    parser.add_argument("--skip-thumbnails", action="store_true", help="No generar ni subir imágenes")
    parser.add_argument(
        "--thumbnails-only",
        action="store_true",
        help="Solo miniaturas: empareja SQLite con catalog_products por url_producto",
    )
    parser.add_argument(
        "--sqlite",
        type=Path,
        default=Path(os.environ.get("LIDER_SQLITE", ROOT / "lider" / "productos_lider.db")),
    )
    parser.add_argument(
        "--imagenes",
        type=Path,
        default=Path(os.environ.get("LIDER_IMAGENES", ROOT / "lider" / "imagenes")),
    )
    args = parser.parse_args()

    url = normalize_env_str(
        os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    )
    key = normalize_env_str(os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))
    if not args.dry_run and (not url or not key):
        print(
            "Faltan SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY.",
            file=sys.stderr,
        )
        print(
            "Tip: define las variables en .env.local en la raíz del repo o en la sesión de PowerShell.",
            file=sys.stderr,
        )
        return 1
    if not args.dry_run:
        check_service_role_key(key)
        assert_url_and_service_role_match(url, key)

    if args.thumbnails_only:
        if args.dry_run:
            print(
                "Modo --thumbnails-only requiere escritura; no combines con --dry-run.",
                file=sys.stderr,
            )
            return 1
        if not url or not key:
            print("Faltan credenciales Supabase.", file=sys.stderr)
            return 1
        supabase_only = create_supabase_client(url, key)
        if not env_ssl_verify():
            print(
                "Aviso: IMPORT_SSL_VERIFY=0 (TLS sin verificar). Solo para depuración local.",
                file=sys.stderr,
            )
        return run_thumbnails_only(args, url, key, supabase_only)

    if not args.sqlite.is_file():
        print(f"No existe la base SQLite: {args.sqlite}", file=sys.stderr)
        return 1

    supabase = None
    if not args.dry_run:
        supabase = create_supabase_client(url, key)
        if not env_ssl_verify():
            print(
                "Aviso: IMPORT_SSL_VERIFY=0 (TLS sin verificar). Solo para depuración local.",
                file=sys.stderr,
            )

    conn = sqlite3.connect(str(args.sqlite))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # --- Secciones (categorias SQLite) ---
    # Esquema variable (p. ej. fast_scraper sin url): solo columnas usadas.
    cur.execute("SELECT id, nombre FROM categorias ORDER BY id")
    sec_rows = cur.fetchall()
    section_sqlite_to_pg: dict[int, str] = {}

    print(f"Categorías raíz (secciones) en SQLite: {len(sec_rows)}")

    sec_by_norm: dict[str, str] = {}
    if not args.dry_run:
        assert supabase is not None
        existing_secs = supabase.table("sections").select("id,name").execute()
        for srow in existing_secs.data or []:
            sec_by_norm[norm_taxonomy_label(srow["name"])] = srow["id"]

    for i, row in enumerate(sec_rows):
        nombre = norm_taxonomy_label(row["nombre"] or "")
        if not nombre:
            continue
        sort_order = (i + 1) * 10
        if args.dry_run:
            section_sqlite_to_pg[row["id"]] = str(uuid.uuid4())
            continue

        assert supabase is not None
        if nombre in sec_by_norm:
            sid = sec_by_norm[nombre]
        else:
            ins = (
                supabase.table("sections")
                .insert({"name": nombre, "sort_order": sort_order})
                .execute()
            )
            sid = ins.data[0]["id"]
            sec_by_norm[nombre] = sid
        section_sqlite_to_pg[row["id"]] = sid

    # --- Subcategorías ---
    cur.execute(
        """
        SELECT id, nombre, categoria_id
        FROM subcategorias
        ORDER BY categoria_id, id
        """
    )
    sub_rows = cur.fetchall()
    sub_sqlite_to_pg: dict[int, str] = {}

    cat_by_key: dict[tuple[str, str], str] = {}
    if not args.dry_run:
        assert supabase is not None
        existing_cats = supabase.table("categories").select("id,name,section_id").execute()
        for crow in existing_cats.data or []:
            cat_by_key[
                (crow["section_id"], norm_taxonomy_label(crow["name"]))
            ] = crow["id"]

    for i, row in enumerate(sub_rows):
        cid_sql = row["categoria_id"]
        if cid_sql not in section_sqlite_to_pg:
            continue
        pg_section = section_sqlite_to_pg[cid_sql]
        nombre = norm_taxonomy_label(row["nombre"] or "") or "Sin nombre"
        sort_order = (i + 1) * 5
        if args.dry_run:
            sub_sqlite_to_pg[row["id"]] = str(uuid.uuid4())
            continue

        assert supabase is not None
        ck = (pg_section, nombre)
        if ck in cat_by_key:
            kid = cat_by_key[ck]
        else:
            ins = (
                supabase.table("categories")
                .insert(
                    {
                        "section_id": pg_section,
                        "name": nombre,
                        "sort_order": sort_order,
                    }
                )
                .execute()
            )
            kid = ins.data[0]["id"]
            cat_by_key[ck] = kid
        sub_sqlite_to_pg[row["id"]] = kid

    print(f"Subcategorías mapeadas: {len(sub_sqlite_to_pg)}")

    # --- Productos ---
    cur.execute(
        """
        SELECT p.id, p.producto_id, p.nombre, p.marca, p.precio, p.precio_unitario,
               p.imagen_url, p.imagen_local, p.url_producto, p.descripcion_corta,
               p.subcategoria_id
        FROM productos p
        WHERE p.subcategoria_id IS NOT NULL
        ORDER BY p.id
        """
    )
    products = cur.fetchall()
    conn.close()

    total = len(products)
    if args.limit > 0:
        products = products[: args.limit]

    print(f"Productos a importar: {len(products)} de {total}")

    use_catalog_brands = True
    brand_by_key: dict[str, dict[str, str]] = {}
    if not args.dry_run:
        assert supabase is not None
        try:
            br_all = supabase.table("catalog_brands").select("id,name").execute()
            for brow in br_all.data or []:
                nk = norm_brand_key(brow["name"])
                if nk:
                    brand_by_key[nk] = {"id": brow["id"], "name": brow["name"]}
        except Exception as e:
            es = str(e).lower()
            if "pgrst205" in es or "catalog_brands" in es:
                use_catalog_brands = False
                print(
                    "Aviso: la tabla catalog_brands no está desplegada en Supabase "
                    "(ejecuta: npx supabase db push). "
                    "Continuando solo con el campo texto catalog_products.brand.",
                    file=sys.stderr,
                )
            else:
                raise

    processed = 0
    skipped_dup = 0
    skipped_no_cat = 0
    thumb_ok = 0
    thumb_missing = 0

    for row in products:
        sid_sub = row["subcategoria_id"]
        if sid_sub not in sub_sqlite_to_pg:
            skipped_no_cat += 1
            continue

        url_p = (row["url_producto"] or "").strip()
        cat_uuid = sub_sqlite_to_pg[sid_sub]

        if args.dry_run:
            processed += 1
            continue

        assert supabase is not None

        if url_p:
            dup = (
                supabase.table("catalog_products")
                .select("id")
                .eq("source_product_url", url_p)
                .limit(1)
                .execute()
            )
            if dup.data and len(dup.data) > 0:
                skipped_dup += 1
                continue

        cat_row = (
            supabase.table("categories")
            .select("section_id")
            .eq("id", cat_uuid)
            .single()
            .execute()
        )
        section_uuid = cat_row.data["section_id"]

        nombre = norm_taxonomy_label(row["nombre"] or "") or "Sin nombre"
        precio = parse_clp(row["precio"])
        pu = (row["precio_unitario"] or "").strip()
        format_str = pu if pu else None
        unit_str = "unidad"

        brand_id: str | None = None
        marca_txt: str | None = None
        if args.dry_run:
            m = norm_taxonomy_label(row["marca"] or "")
            marca_txt = m if m else None
        else:
            assert supabase is not None
            if use_catalog_brands:
                brand_id, marca_txt = resolve_brand(supabase, row["marca"], brand_by_key)
            else:
                m = norm_taxonomy_label(row["marca"] or "")
                marca_txt = m if m else None

        payload: dict[str, Any] = {
            "section_id": section_uuid,
            "category_id": cat_uuid,
            "name": nombre,
            "brand": marca_txt,
            "format": format_str,
            "unit": unit_str,
            "default_reference_price": precio,
            "sort_order": processed,
            "active": True,
            "source_system": "lider_sqlite",
            "source_product_url": url_p or None,
        }
        if brand_id:
            payload["brand_id"] = brand_id

        ins = supabase.table("catalog_products").insert(payload).execute()
        cp_id = ins.data[0]["id"]
        processed += 1

        if not args.skip_thumbnails:
            try:
                if try_upload_thumbnail(supabase, cp_id, row, args.imagenes):
                    thumb_ok += 1
                else:
                    thumb_missing += 1
            except Exception as e:
                print(f"Thumb error {cp_id}: {e}", file=sys.stderr)
                thumb_missing += 1

        if processed % 100 == 0:
            print(f"  … {processed} productos")

    print(
        f"Listo. Insertados: {processed}, duplicados URL omitidos: {skipped_dup}, "
        f"sin subcategoría: {skipped_no_cat}, miniaturas OK: {thumb_ok}, sin miniatura: {thumb_missing}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
