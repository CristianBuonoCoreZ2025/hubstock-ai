-- Corregir list_scrapping_runs: scrapping_runs no tiene created_at, solo started_at
DROP FUNCTION IF EXISTS list_scrapping_runs(INTEGER);

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
