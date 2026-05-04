-- Catálogo maestro global (ejecutar después de schema-01-core.sql y antes de schema-02-products.sql)

CREATE TABLE catalog_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL,
  category_id UUID NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  format TEXT,
  unit TEXT,
  default_reference_price NUMERIC,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE RESTRICT,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
);

CREATE TABLE catalog_product_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_product_id UUID NOT NULL,
  alias_normalized TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (catalog_product_id) REFERENCES catalog_products(id) ON DELETE CASCADE,
  UNIQUE (catalog_product_id, alias_normalized)
);

CREATE INDEX idx_catalog_products_section_id ON catalog_products(section_id);
CREATE INDEX idx_catalog_products_category_id ON catalog_products(category_id);
CREATE INDEX idx_catalog_product_aliases_catalog_product_id ON catalog_product_aliases(catalog_product_id);
CREATE INDEX idx_catalog_product_aliases_alias_normalized ON catalog_product_aliases(alias_normalized);

CREATE TRIGGER update_catalog_products_updated_at
BEFORE UPDATE ON catalog_products
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
