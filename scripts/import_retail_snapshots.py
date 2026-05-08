#!/usr/bin/env python3
"""
Inserta capturas de precio en catalog_retail_snapshots (historial por cada corrida).
Compatible con el mismo esquema SQLite que usa import_lider_sqlite.py (categorias, subcategorias, productos).

No crea filas en catalog_products: sirve para Jumbo u otras cadenas que querés homologar en la UI
(pestaña Catálogo → Precios cadenas).

Variables de entorno: igual que import_lider_sqlite.py (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).

  RETAIL_SQLITE  ruta al .db (default por --retailer: jumbo/, central_mayorista/, o lider/)

Ejemplos:
  python scripts/import_retail_snapshots.py --retailer jumbo
  python scripts/import_retail_snapshots.py --retailer central_mayorista
  python scripts/import_retail_snapshots.py --retailer lider --sqlite lider/productos_lider.db --dry-run --limit 50
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Reutiliza utilidades del importador Lider
sys.path.insert(0, str(ROOT / "scripts"))
from import_lider_sqlite import (  # type: ignore  # noqa: E402
    assert_url_and_service_role_match,
    check_service_role_key,
    create_supabase_client,
    load_local_env,
    norm_taxonomy_label,
    normalize_env_str,
    parse_clp,
)


def default_sqlite_path(retailer: str) -> Path:
    env_key = "RETAIL_SQLITE"
    raw = os.environ.get(env_key)
    if raw and raw.strip():
        return Path(raw)
    if retailer == "jumbo":
        return ROOT / "jumbo" / "productos_jumbo.db"
    if retailer == "central_mayorista":
        return ROOT / "central_mayorista" / "productos_central_mayorista.db"
    return ROOT / "lider" / "productos_lider.db"


def category_hint(cur: sqlite3.Cursor, subcat_id: int | None) -> str | None:
    if subcat_id is None:
        return None
    cur.execute(
        """
        SELECT c.nombre AS sec, sc.nombre AS sub
        FROM subcategorias sc
        JOIN categorias c ON c.id = sc.categoria_id
        WHERE sc.id = ?
        """,
        (subcat_id,),
    )
    row = cur.fetchone()
    if not row:
        return None
    sec = norm_taxonomy_label(row[0] or "")
    sub = norm_taxonomy_label(row[1] or "")
    if sec and sub:
        return f"{sec} › {sub}"
    return sec or sub or None


def external_ref_from_row(row: sqlite3.Row) -> str:
    url_p = (row["url_producto"] or "").strip()
    if url_p:
        return url_p
    pid = row["producto_id"]
    if pid is not None:
        return f"producto_id:{pid}"
    return f"sqlite_id:{row['id']}"


def main() -> int:
    load_local_env()

    parser = argparse.ArgumentParser(
        description="Import retail snapshots → Supabase catalog_retail_snapshots"
    )
    parser.add_argument(
        "--retailer",
        required=True,
        help="Identificador de cadena (ej. jumbo, lider, central_mayorista)",
    )
    parser.add_argument("--sqlite", type=Path, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    retailer = norm_taxonomy_label(args.retailer).lower().replace(" ", "_")
    if not retailer:
        print("retailer inválido", file=sys.stderr)
        return 1

    sqlite_path = args.sqlite or default_sqlite_path(retailer)
    if not sqlite_path.is_file():
        print(f"No existe la base SQLite: {sqlite_path}", file=sys.stderr)
        return 1

    url = normalize_env_str(
        os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    )
    key = normalize_env_str(os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))

    if not args.dry_run and (not url or not key):
        print("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.", file=sys.stderr)
        return 1
    if not args.dry_run:
        check_service_role_key(key)
        assert_url_and_service_role_match(url, key)

    supabase = None if args.dry_run else create_supabase_client(url, key)

    conn = sqlite3.connect(str(sqlite_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        """
        SELECT p.id, p.producto_id, p.nombre, p.marca, p.precio,
               p.url_producto, p.subcategoria_id
        FROM productos p
        WHERE p.subcategoria_id IS NOT NULL
        ORDER BY p.id
        """
    )
    rows = cur.fetchall()

    total = len(rows)
    if args.limit > 0:
        rows = rows[: args.limit]

    print(f"Capturas a insertar: {len(rows)} de {total} (retailer={retailer})")

    ok = 0
    errors = 0
    for i, row in enumerate(rows, start=1):
        title = norm_taxonomy_label(row["nombre"] or "") or "Sin nombre"
        price = parse_clp(row["precio"])
        if price is None:
            errors += 1
            continue
        ref = external_ref_from_row(row)
        hint = category_hint(cur, row["subcategoria_id"])
        brand = norm_taxonomy_label(row["marca"] or "") or None

        payload = {
            "retailer": retailer,
            "external_ref": ref,
            "source_url": (row["url_producto"] or "").strip() or None,
            "title": title,
            "price": float(price),
            "category_hint": hint,
            "brand_hint": brand,
            "match_method": "sqlite_import",
        }

        if args.dry_run:
            ok += 1
            continue

        assert supabase is not None
        try:
            supabase.table("catalog_retail_snapshots").insert(payload).execute()
            ok += 1
        except Exception as e:
            errors += 1
            print(f"Error fila {i}: {e}", file=sys.stderr)

        if i % 200 == 0:
            print(f"  … {i}/{len(rows)}", flush=True)

    conn.close()
    print(f"Listo. Insertadas: {ok}, errores u omitidas: {errors}")
    return 0 if errors == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
