-- Sugerencia IA (solo hint, sin vínculo automático) tras pasada masiva paso 2.
-- Nullable: filas históricas sin dato siguen válidas.

alter table public.scrapping
  add column if not exists similarity_ia_hint jsonb;

comment on column public.scrapping.similarity_ia_hint is
  'Opcional: { ai_hint, candidate_suggested, ai_score, reason, stored_at }. No autoriza vínculo; sólo UX/revisión.';
