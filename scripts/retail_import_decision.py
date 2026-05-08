"""
Decisión homologación vs maestro nuevo: puntaje RPC + marca + descripción (heurística).
La RPC catalog_retail_match_candidates ya combina nombre, categoría y precio.
"""

from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any, Literal


def _norm(s: str | None) -> str:
    return " ".join((s or "").strip().split()).lower()


def _text_similarity(a: str | None, b: str | None) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, _norm(a), _norm(b)).ratio()


def _brand_hint_in_name(brand_hint: str | None, product_name: str) -> bool:
    if not brand_hint:
        return True
    nb, nn = _norm(brand_hint), _norm(product_name)
    if len(nb) < 2:
        return True
    return nb in nn or nn in nb or _text_similarity(brand_hint, product_name) > 0.42


@dataclass
class RetailResolveDecision:
    action: Literal["link", "ambiguous", "create_novel"]
    catalog_product_id: str | None
    best_score: float
    reason: str


def decide_retail_master(
    *,
    candidates: list[dict[str, Any]],
    brand_hint: str | None,
    description_hint: str | None,
    link_min: float = 0.58,
    ambiguous_min: float = 0.38,
    novel_max: float = 0.34,
    min_gap_first_second: float = 0.09,
) -> RetailResolveDecision:
    """
    candidates: filas de catalog_retail_match_candidates (orden descendente por score).
    """
    if not candidates:
        return RetailResolveDecision(
            action="create_novel",
            catalog_product_id=None,
            best_score=0.0,
            reason="sin_candidatos_en_catalogo",
        )

    top = candidates[0]
    second = candidates[1] if len(candidates) > 1 else None
    best_id = str(top.get("catalog_product_id") or "")
    best_score = float(top.get("match_score") or 0)
    second_score = float(second.get("match_score") or 0) if second else 0.0
    gap = best_score - second_score if second else 1.0

    pname = str(top.get("product_name") or "")

    if brand_hint and not _brand_hint_in_name(brand_hint, pname):
        if best_score >= ambiguous_min:
            return RetailResolveDecision(
                action="ambiguous",
                catalog_product_id=best_id or None,
                best_score=best_score,
                reason="marca_no_aparece_en_nombre_del_mejor_candidato",
            )

    if description_hint and pname:
        if _text_similarity(description_hint, pname) > 0.55 and best_score < link_min:
            return RetailResolveDecision(
                action="ambiguous",
                catalog_product_id=best_id or None,
                best_score=best_score,
                reason="descripcion_muy_similar_al_maestro_puntaje_insuficiente",
            )

    if best_score >= link_min:
        if brand_hint and not _brand_hint_in_name(brand_hint, pname):
            return RetailResolveDecision(
                action="ambiguous",
                catalog_product_id=best_id or None,
                best_score=best_score,
                reason="vinculo_alto_pero_marca_incompatible",
            )
        return RetailResolveDecision(
            action="link",
            catalog_product_id=best_id or None,
            best_score=best_score,
            reason="mejor_candidato_supera_umbral_vinculo",
        )

    if best_score >= ambiguous_min:
        return RetailResolveDecision(
            action="ambiguous",
            catalog_product_id=best_id or None,
            best_score=best_score,
            reason="zona_ambigua_revisar_manual",
        )

    if best_score <= novel_max and gap >= min_gap_first_second:
        return RetailResolveDecision(
            action="create_novel",
            catalog_product_id=None,
            best_score=best_score,
            reason="baja_similitud_y_separacion_entre_candidatos",
        )

    return RetailResolveDecision(
        action="ambiguous",
        catalog_product_id=best_id or None,
        best_score=best_score,
        reason="candidatos_muy_pegados_o_similitud_intermedia",
    )
