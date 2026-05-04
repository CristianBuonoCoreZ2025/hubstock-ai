-- Metadatos del análisis de imagen (proveedor, modelo, confianza agregada).
alter table public.stock_checks
  add column if not exists ai_meta jsonb;

comment on column public.stock_checks.ai_meta is
  'IA: vision {provider, model, providerLabel}, confidenceAvg, confidenceMin, detectedCount, confidenceCoverage';
