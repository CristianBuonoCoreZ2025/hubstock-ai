"""
Marca propia de cadena (Lider, Jumbo, Central Mayorista en frescos/pan/…)
→ marca canónica única para comparativos sin multiplicar ítems equivalentes.

Nombre canónico en BD: «Marca genérica» (tabla catalog_brands).
"""

from __future__ import annotations

import re

GENERIC_BRAND_CANONICAL = "Marca genérica"

# Marcas de tienda sobre productos frescos / pan / bollería comparables entre cadenas.
_PRIVATE_BRAND = re.compile(
    r"(^|\s)(marca\s*)?(l[ií]der|jumbo)(\.cl)?($|\s)",
    re.I,
)
_CENTRAL_BRAND = re.compile(r"central\s*mayorista", re.I)


def _haystack(name: str | None, category_hint: str | None) -> str:
    parts = f"{name or ''} {category_hint or ''}".lower()
    return parts


def _matches_fresh_bakery_context(name: str | None, category_hint: str | None) -> bool:
    """Verduras, frutas, pan / panadería u hortalizas (comparativo entre retailers)."""
    h = _haystack(name, category_hint)
    needles = (
        "verdur",
        "frut",
        "hortaliz",
        "fresco",
        "tomate",
        "lechuga",
        "zanahoria",
        "cebolla",
        "papa",
        "palta",
        "plátano",
        "banana",
        "manzana",
        "naranja",
        "uva",
        "berenjena",
        "apio",
        "champiñ",
        "espárrag",
        "esparrag",
        "marraqueta",
        "hallulla",
        "pan ",
        "panader",
        "bolla",
        "baguette",
        "reposter",
        "masa ",
        "harina ",
        " boller",
        "bollería",
        "ensalada",
    )
    return any(n in h for n in needles)


def is_private_label_brand_text(raw: str | None) -> bool:
    if not raw or not str(raw).strip():
        return False
    t = " ".join(str(raw).strip().split()).lower()
    if t in ("líder", "lider", "jumbo", "marca líder", "marca jumbo"):
        return True
    if _CENTRAL_BRAND.search(t):
        return True
    if _PRIVATE_BRAND.search(t):
        return True
    if "marca" in t and ("líder" in t or "lider" in t or "jumbo" in t):
        return True
    return False


def fold_private_label_brand(
    raw_brand: str | None,
    *,
    product_name: str | None,
    category_hint: str | None,
) -> tuple[str | None, bool]:
    """
    Devuelve (marca_para_resolve_brand, se_usó_genérica).
    Si no aplica, devuelve la marca original sin cambiar.
    """
    if not is_private_label_brand_text(raw_brand):
        return (raw_brand, False)
    if not _matches_fresh_bakery_context(product_name, category_hint):
        return (raw_brand, False)
    return (GENERIC_BRAND_CANONICAL, True)


def normalize_brand_hint_for_match(
    raw_brand: str | None,
    *,
    product_name: str | None,
    category_hint: str | None,
) -> str | None:
    """Para homologación / decisión: misma regla que fold."""
    folded, _ = fold_private_label_brand(
        raw_brand,
        product_name=product_name,
        category_hint=category_hint,
    )
    return folded
