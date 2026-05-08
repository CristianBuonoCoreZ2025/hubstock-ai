-- Denormalizado desde purchase_receipts (mismo perfil que la cabecera). Evita inserts sin perfil y alinea RLS.

alter table public.purchase_receipt_items
  add column if not exists profile_id uuid references public.profiles (id) on delete cascade;

update public.purchase_receipt_items pri
set profile_id = pr.profile_id
from public.purchase_receipts pr
where pr.id = pri.receipt_id
  and (pri.profile_id is null or pri.profile_id is distinct from pr.profile_id);

alter table public.purchase_receipt_items
  alter column profile_id set not null;

create index if not exists idx_purchase_receipt_items_profile
  on public.purchase_receipt_items (profile_id);
