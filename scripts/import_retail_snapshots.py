#!/usr/bin/env python3
"""
Inserta capturas en catalog_retail_snapshots (historial por corrida).
Opcionalmente resuelve vínculos/alta de maestro con la misma lógica inteligente que la UI.

No duplica maestros sin criterio: primero catalog_retail_match_candidates (nombre+categoría+precio),
luego heurística de marca/descripción (retail_import_decision).

Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, opcional RETAIL_SQLITE.

Ejemplos:
  python scripts/import_retail_snapshots.py --retailer jumbo
  python scripts/import_retail_snapshots.py --retailer central_mayorista --smart-resolve
  python scripts/import_retail_snapshots.py --retailer jumbo --smart-resolve --create-if-novel

Flujo: scripts/RETAIL_CAPTURE.md
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

sys.path.insert(0, str(ROOT / "scripts"))
from import_lider_sqlite import (  # type: ignore  # noqa: E402
    assert_url_and_service_role_match,
    check_service_role_key,
    create_supabase_client,
    load_local_env,
    norm_brand_key,
    norm_taxonomy_label,
    normalize_env_str,
    parse_clp,
    resolve_brand,
)
from retail_import_decision import decide_retail_master  # noqa: E402
from retail_private_label import fold_private_label_brand  # noqa: E402
from sqlite_taxonomy_sync import map_sqlite_taxonomy_to_pg, sqlite_category_hint  # noqa: E402


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
    return sqlite_category_hint(cur, subcat_id, norm_taxonomy_label)


def external_ref_from_row(row: sqlite3.Row) -> str:
    url_p = (row["url_producto"] or "").strip()
    if url_p:
        return url_p
    pid = row["producto_id"]
    if pid is not None:
        return f"producto_id:{pid}"
    return f"sqlite_id:{row['id']}"


def retail_link_exists(supabase: object, retailer: str, external_ref: str) -> bool:
    res = (
        supabase.table("catalog_retail_links")
        .select("catalog_product_id")
        .eq("retailer", retailer)
        .eq("external_ref", external_ref)
        .limit(1)
        .execute()
    )
    return bool(res.data)


def fetch_match_candidates(
    supabase: object,
    *,
    title: str,
    price: float,
    category_id: str | None,
    limit_n: int = 5,
) -> list[dict]:
    try:
        res = supabase.rpc(
            "catalog_retail_match_candidates",
            {
                "p_search_title": title,
                "p_price": price,
                "p_category_id": category_id,
                "p_limit": limit_n,
            },
        ).execute()
    except Exception as e:
        print(f"Aviso RPC catalog_retail_match_candidates: {e}", file=sys.stderr)
        return []
    return list(res.data or [])


def upsert_link(supabase: object, retailer: str, external_ref: str, catalog_product_id: str) -> None:
    supabase.table("catalog_retail_links").upsert(
        {
            "retailer": retailer,
            "external_ref": external_ref,
            "catalog_product_id": catalog_product_id,
        },
        on_conflict="retailer,external_ref",
    ).execute()


def insert_novel_catalog_product(
    supabase: object,
    *,
    retailer: str,
    row: sqlite3.Row,
    title: str,
    price: float,
    category_uuid: str,
    category_hint_str: str | None,
    brand_by_key: dict[str, dict[str, str]],
    use_catalog_brands: bool,
) -> str | None:
    """Inserta maestro nuevo; devuelve id o None si falla (p. ej. URL duplicada)."""
    url_p = (row["url_producto"] or "").strip() or None
    pu_raw = row["precio_unitario"] if "precio_unitario" in row.keys() else ""
    pu = (pu_raw or "").strip() if pu_raw else ""
    format_str = pu if pu else None

    cat_row = (
        supabase.table("categories").select("section_id").eq("id", category_uuid).single().execute()
    )
    if not cat_row.data:
        return None
    section_uuid = cat_row.data["section_id"]

    brand_raw = norm_taxonomy_label(row["marca"] or "") or None
    folded_marca, _ = fold_private_label_brand(
        brand_raw,
        product_name=title,
        category_hint=category_hint_str,
    )
    marca_for_resolve = folded_marca if folded_marca else brand_raw

    brand_id: str | None = None
    marca_txt: str | None = None
        if use_catalog_brands:
            brand_id, marca_txt = resolve_brand(
                supabase,
                marca_for_resolve if marca_for_resolve is not None else "",
                brand_by_key,
            )
        else:
            m = norm_taxonomy_label(marca_for_resolve or "")
            marca_txt = m if m else None

    payload: dict = {
        "section_id": section_uuid,
        "category_id": category_uuid,
        "name": title,
        "brand": marca_txt,
        "format": format_str,
        "unit": "unidad",
        "default_reference_price": price if price else None,
        "sort_order": 0,
        "active": True,
        "source_system": f"{retailer}_retail_novel",
        "source_product_url": url_p,
    }
    if brand_id:
        payload["brand_id"] = brand_id

    try:
        ins = supabase.table("catalog_products").insert(payload).execute()
        return str(ins.data[0]["id"])
    except Exception as e:
        es = str(e).lower()
        if url_p and ("unique" in es or "23505" in es or "duplicate" in es):
            dup = (
                supabase.table("catalog_products")
                .select("id")
                .eq("source_product_url", url_p)
                .limit(1)
                .execute()
            )
            if dup.data:
                return str(dup.data[0]["id"])
        print(f"No se pudo crear maestro ({title[:40]}…): {e}", file=sys.stderr)
        return None


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
    parser.add_argument(
        "--smart-resolve",
        action="store_true",
        help="Tras cada captura: candidatos RPC + decisión (vincular / ambiguo / maestro nuevo).",
    )
    parser.add_argument(
        "--auto-match",
        action="store_true",
        help="Alias obsoleto de --smart-resolve.",
    )
    parser.add_argument(
        "--create-if-novel",
        action="store_true",
        help="Si la decisión es maestro nuevo y hay taxonomía SQLite→PG, crea catalog_products y vínculo.",
    )
    parser.add_argument("--link-min", type=float, default=0.58, dest="link_min")
    parser.add_argument("--ambiguous-min", type=float, default=0.38, dest="ambiguous_min")
    parser.add_argument("--novel-max", type=float, default=0.34, dest="novel_max")
    args = parser.parse_args()

    smart_resolve = args.smart_resolve or args.auto_match
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

    sub_sqlite_to_pg: dict[int, str] = {}
    if (smart_resolve or args.create_if_novel) and supabase is not None:
        _sec_map, sub_sqlite_to_pg = map_sqlite_taxonomy_to_pg(
            cur,
            supabase,
            dry_run=args.dry_run,
            norm_taxonomy_label=norm_taxonomy_label,
        )
        print(f"Taxonomía SQLite → PG: categorías (subcat) mapeadas={len(sub_sqlite_to_pg)}")

    sql_products_full = """
        SELECT p.id, p.producto_id, p.nombre, p.marca, p.precio, p.precio_unitario,
               p.url_producto, p.subcategoria_id, p.descripcion_corta
        FROM productos p
        WHERE p.subcategoria_id IS NOT NULL
        ORDER BY p.id
    """
    sql_products_min = """
        SELECT p.id, p.producto_id, p.nombre, p.marca, p.precio, p.precio_unitario,
               p.url_producto, p.subcategoria_id
        FROM productos p
        WHERE p.subcategoria_id IS NOT NULL
        ORDER BY p.id
    """
    try:
        cur.execute(sql_products_full)
    except sqlite3.OperationalError:
        cur.execute(sql_products_min)
    rows = cur.fetchall()

    total = len(rows)
    if args.limit > 0:
        rows = rows[: args.limit]

    if smart_resolve and args.dry_run:
        print(
            "Nota: --smart-resolve no escribe vínculos ni maestros con --dry-run.",
            file=sys.stderr,
        )

    use_catalog_brands = True
    brand_by_key: dict[str, dict[str, str]] = {}
    if args.create_if_novel and supabase is not None and not args.dry_run:
        try:
            br_all = supabase.table("catalog_brands").select("id,name").execute()
            for brow in br_all.data or []:
                nk = norm_brand_key(brow["name"])
                if nk:
                    brand_by_key[nk] = {"id": brow["id"], "name": brow["name"]}
        except Exception:
            use_catalog_brands = False

    print(f"Capturas a insertar: {len(rows)} de {total} (retailer={retailer})")

    snap_ok = 0
    snap_err = 0
    linked = 0
    created = 0
    ambiguous = 0
    skipped_linked = 0

    for i, row in enumerate(rows, start=1):
        title = norm_taxonomy_label(row["nombre"] or "") or "Sin nombre"
        price = parse_clp(row["precio"])
        if price is None:
            snap_err += 1
            continue
        ref = external_ref_from_row(row)
        hint = category_hint(cur, row["subcategoria_id"])
        brand_raw = norm_taxonomy_label(row["marca"] or "") or None
        folded_brand, _gen = fold_private_label_brand(
            brand_raw,
            product_name=title,
            category_hint=hint or None,
        )
        brand_for_snapshot = folded_brand if folded_brand else brand_raw
        desc_raw = row["descripcion_corta"] if "descripcion_corta" in row.keys() else ""
        desc_short = norm_taxonomy_label(desc_raw or "") or None

        payload = {
            "retailer": retailer,
            "external_ref": ref,
            "source_url": (row["url_producto"] or "").strip() or None,
            "title": title,
            "price": float(price),
            "category_hint": hint,
            "brand_hint": brand_for_snapshot,
            "description_hint": desc_short,
            "match_method": "sqlite_import",
        }

        if args.dry_run:
            snap_ok += 1
            continue

        assert supabase is not None
        try:
            supabase.table("catalog_retail_snapshots").insert(payload).execute()
            snap_ok += 1
        except Exception as e:
            snap_err += 1
            print(f"Error snapshot fila {i}: {e}", file=sys.stderr)
            if i % 200 == 0:
                print(f"  … {i}/{len(rows)}", flush=True)
            continue

        if smart_resolve:
            if retail_link_exists(supabase, retailer, ref):
                skipped_linked += 1
            else:
                sid = row["subcategoria_id"]
                cat_uuid = sub_sqlite_to_pg.get(int(sid)) if sid is not None else None
                cands = fetch_match_candidates(
                    supabase,
                    title=title,
                    price=float(price),
                    category_id=cat_uuid,
                    limit_n=5,
                )
                decision = decide_retail_master(
                    candidates=cands,
                    brand_hint=brand_for_snapshot,
                    description_hint=desc_short,
                    link_min=args.link_min,
                    ambiguous_min=args.ambiguous_min,
                    novel_max=args.novel_max,
                )

                if decision.action == "link" and decision.catalog_product_id:
                    upsert_link(supabase, retailer, ref, decision.catalog_product_id)
                    linked += 1
                elif decision.action == "create_novel" and args.create_if_novel:
                    if not cat_uuid:
                        ambiguous += 1
                        print(
                            f"  [sin categoría PG para subcat {sid}] {title[:50]} — omitido alta",
                            file=sys.stderr,
                        )
                    else:
                        cp_id = insert_novel_catalog_product(
                            supabase,
                            retailer=retailer,
                            row=row,
                            title=title,
                            price=float(price),
                            category_uuid=cat_uuid,
                            category_hint_str=hint,
                            brand_by_key=brand_by_key,
                            use_catalog_brands=use_catalog_brands,
                        )
                        if cp_id:
                            upsert_link(supabase, retailer, ref, cp_id)
                            created += 1
                        else:
                            ambiguous += 1
                else:
                    ambiguous += 1

        if i % 200 == 0:
            print(f"  … {i}/{len(rows)}", flush=True)

    conn.close()
    extra = ""
    if smart_resolve and not args.dry_run:
        extra = (
            f" | vínculos={linked}, maestros_nuevos={created}, "
            f"ambiguo_o_manual={ambiguous}, ya_vinculados={skipped_linked}"
        )
    print(f"Listo. Snapshots OK={snap_ok}, errores={snap_err}{extra}")
    return 0 if snap_err == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
