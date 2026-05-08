"""
Mapea categorías/subcategorías SQLite → sections/categories en Supabase (misma lógica que import_lider_sqlite).
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import sqlite3


def map_sqlite_taxonomy_to_pg(
    cur: "sqlite3.Cursor",
    supabase: Any,
    *,
    dry_run: bool,
    norm_taxonomy_label: Any,
) -> tuple[dict[int, str], dict[int, str]]:
    """
    Devuelve:
      section_sqlite_to_pg: id categoría raíz SQLite → uuid section_id PG
      sub_sqlite_to_pg: id subcategoría SQLite → uuid category_id PG
    """
    cur.execute("SELECT id, nombre FROM categorias ORDER BY id")
    sec_rows = cur.fetchall()
    section_sqlite_to_pg: dict[int, str] = {}

    sec_by_norm: dict[str, str] = {}
    if not dry_run:
        existing_secs = supabase.table("sections").select("id,name").execute()
        for srow in existing_secs.data or []:
            sec_by_norm[norm_taxonomy_label(srow["name"])] = srow["id"]

    for i, row in enumerate(sec_rows):
        nombre = norm_taxonomy_label(row["nombre"] or "")
        if not nombre:
            continue
        sort_order = (i + 1) * 10
        if dry_run:
            section_sqlite_to_pg[row["id"]] = str(uuid.uuid4())
            continue

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
    if not dry_run:
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
        if dry_run:
            sub_sqlite_to_pg[row["id"]] = str(uuid.uuid4())
            continue

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

    return section_sqlite_to_pg, sub_sqlite_to_pg


def sqlite_category_hint(
    cur: "sqlite3.Cursor",
    subcat_id: int | None,
    norm_taxonomy_label: Any,
) -> str | None:
    """Texto Sección › Subcategoría para heurísticas de marca (misma consulta que import retail)."""
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
