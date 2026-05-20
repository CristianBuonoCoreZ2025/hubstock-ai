-- Función RPC para obtener todo el contexto del barrido en una sola consulta
-- Reemplaza múltiples llamadas RPC individuales por una sola

CREATE OR REPLACE FUNCTION get_barrido_context(p_retail_id UUID)
RETURNS TABLE (
  running_count BIGINT,
  product_count BIGINT,
  page_count BIGINT,
  running_run_id UUID,
  running_run_started_at TIMESTAMP WITH TIME ZONE,
  running_pending BIGINT,
  running_processing BIGINT,
  running_failed BIGINT,
  running_done BIGINT,
  running_total BIGINT,
  running_total_pages INTEGER,
  latest_run_id UUID,
  latest_run_status TEXT,
  latest_run_started_at TIMESTAMP WITH TIME ZONE,
  latest_failed BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH 
  -- Conteos globales
  global_counts AS (
    SELECT 
      (SELECT COUNT(*) FROM scrapping_runs WHERE status = 'running') AS running_count,
      (SELECT COUNT(*) FROM scrapping) AS product_count,
      (SELECT COUNT(*) FROM scrapping_pages) AS page_count
  ),
  -- Corrida running para este retail
  running_run AS (
    SELECT 
      sr.id,
      sr.started_at,
      sr.total_pages
    FROM scrapping_runs sr
    WHERE sr.retail_id = p_retail_id
      AND sr.status = 'running'
    ORDER BY sr.started_at DESC
    LIMIT 1
  ),
  -- Conteos de páginas para la corrida running
  running_pages AS (
    SELECT 
      COUNT(*) FILTER (WHERE status = 'pending') AS pending,
      COUNT(*) FILTER (WHERE status = 'processing') AS processing,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      COUNT(*) FILTER (WHERE status = 'done') AS done,
      COUNT(*) AS total
    FROM scrapping_pages
    WHERE run_id = (SELECT id FROM running_run)
  ),
  -- Última corrida para este retail (no running)
  latest_run AS (
    SELECT 
      sr.id,
      sr.status,
      sr.started_at
    FROM scrapping_runs sr
    WHERE sr.retail_id = p_retail_id
      AND sr.status != 'running'
    ORDER BY sr.started_at DESC
    LIMIT 1
  ),
  -- Conteos de páginas fallidas para la última corrida
  latest_pages AS (
    SELECT COUNT(*) FILTER (WHERE status = 'failed') AS failed
    FROM scrapping_pages
    WHERE run_id = (SELECT id FROM latest_run)
  )
  SELECT 
    gc.running_count,
    gc.product_count,
    gc.page_count,
    rr.id AS running_run_id,
    rr.started_at AS running_run_started_at,
    rp.pending AS running_pending,
    rp.processing AS running_processing,
    rp.failed AS running_failed,
    rp.done AS running_done,
    rp.total AS running_total,
    rr.total_pages AS running_total_pages,
    lr.id AS latest_run_id,
    lr.status AS latest_run_status,
    lr.started_at AS latest_run_started_at,
    lp.failed AS latest_failed
  FROM global_counts gc
  LEFT JOIN running_run rr ON true
  LEFT JOIN running_pages rp ON true
  LEFT JOIN latest_run lr ON true
  LEFT JOIN latest_pages lp ON true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_barrido_context(UUID) TO authenticated;

-- Función RPC para listar corridas de scrapping recientes
CREATE OR REPLACE FUNCTION list_scrapping_runs(p_limit INTEGER DEFAULT 32)
RETURNS TABLE (
  id UUID,
  retailer TEXT,
  source_chain TEXT,
  status TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  finished_at TIMESTAMP WITH TIME ZONE,
  total_pages INTEGER,
  error_message TEXT,
  retail_id UUID,
  retail_name TEXT,
  retail_base_url TEXT,
  retail_max_pages INTEGER,
  retail_max_products INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sr.id,
    sr.retailer,
    sr.source_chain,
    sr.status,
    sr.started_at,
    sr.finished_at,
    sr.total_pages,
    sr.error_message,
    sr.retail_id,
    r.name AS retail_name,
    r.base_url AS retail_base_url,
    r.max_pages AS retail_max_pages,
    r.max_products AS retail_max_products
  FROM scrapping_runs sr
  LEFT JOIN retail r ON r.id = sr.retail_id
  ORDER BY sr.started_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION list_scrapping_runs(INTEGER) TO authenticated;

-- Función RPC para listar retail activos
CREATE OR REPLACE FUNCTION list_retail_for_scrapping()
RETURNS TABLE (
  id UUID,
  name TEXT,
  base_url TEXT,
  max_pages INTEGER,
  max_products INTEGER,
  listing_url_path_config JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.id,
    r.name,
    r.base_url,
    r.max_pages,
    r.max_products,
    r.listing_url_path_config
  FROM retail r
  WHERE r.is_active = true
  ORDER BY r.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

