-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "Users read own profile" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "Users insert own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "Users update own profile" on public.profiles for update to authenticated using (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Companies
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  details text,
  fy_start_month int not null default 4,
  timezone text not null default 'Asia/Kolkata',
  created_by uuid not null,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.companies to authenticated;
grant all on public.companies to service_role;

-- Memberships
create table public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);
grant select, insert on public.company_memberships to authenticated;
grant all on public.company_memberships to service_role;
alter table public.company_memberships enable row level security;
create policy "Users read own memberships" on public.company_memberships for select to authenticated using (auth.uid() = user_id);
create policy "Users insert own membership" on public.company_memberships for insert to authenticated with check (auth.uid() = user_id);

-- Helper: membership check (security definer to avoid RLS recursion)
create or replace function public.is_company_member(_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.company_memberships
    where company_id = _company_id and user_id = auth.uid()
  )
$$;

alter table public.companies enable row level security;
create policy "Members read company" on public.companies for select to authenticated using (public.is_company_member(id));
create policy "Creator inserts company" on public.companies for insert to authenticated with check (auth.uid() = created_by);
create policy "Members update company" on public.companies for update to authenticated using (public.is_company_member(id));

-- Accounts (cash / bank)
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  type text not null default 'cash' check (type in ('cash','bank')),
  opening_balance numeric(14,2) not null default 0,
  opening_balance_date date not null default current_date,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.accounts to authenticated;
grant all on public.accounts to service_role;
alter table public.accounts enable row level security;
create policy "Members manage accounts" on public.accounts for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- Categories
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);
grant select, insert, update, delete on public.categories to authenticated;
grant all on public.categories to service_role;
alter table public.categories enable row level security;
create policy "Members manage categories" on public.categories for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- Employees
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  phone text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.employees to authenticated;
grant all on public.employees to service_role;
alter table public.employees enable row level security;
create policy "Members manage employees" on public.employees for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- Vendors
create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  contact text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.vendors to authenticated;
grant all on public.vendors to service_role;
alter table public.vendors enable row level security;
create policy "Members manage vendors" on public.vendors for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- Transactions (single source of truth for money movement)
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  txn_date date not null default current_date,
  type text not null check (type in (
    'funds_received','expense','advance_issued','advance_settlement',
    'vendor_invoice','vendor_payment','refund_received','advance_cash_returned',
    'funds_returned','cash_deposit','cash_withdrawal','transfer','opening_balance'
  )),
  amount numeric(14,2) not null check (amount >= 0),
  category_id uuid references public.categories(id) on delete set null,
  description text,
  counterparty text,
  employee_id uuid references public.employees(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  account_id uuid references public.accounts(id) on delete set null,
  transfer_account_id uuid references public.accounts(id) on delete set null,
  payment_method text,
  reference_no text,
  notes text,
  status text not null default 'posted' check (status in ('posted','void')),
  void_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transactions_company_date_idx on public.transactions (company_id, txn_date, created_at);
create index transactions_type_idx on public.transactions (company_id, type);
grant select, insert, update on public.transactions to authenticated;
grant all on public.transactions to service_role;
alter table public.transactions enable row level security;
create policy "Members manage transactions" on public.transactions for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- Staff advances
create table public.staff_advances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  advance_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  purpose text,
  expected_settlement_date date,
  status text not null default 'outstanding' check (status in ('outstanding','partially_settled','settled')),
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.staff_advances to authenticated;
grant all on public.staff_advances to service_role;
alter table public.staff_advances enable row level security;
create policy "Members manage advances" on public.staff_advances for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- Advance settlements
create table public.advance_settlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  advance_id uuid not null references public.staff_advances(id) on delete cascade,
  settlement_date date not null default current_date,
  bills_amount numeric(14,2) not null default 0 check (bills_amount >= 0),
  cash_returned numeric(14,2) not null default 0 check (cash_returned >= 0),
  notes text,
  created_at timestamptz not null default now()
);
grant select, insert on public.advance_settlements to authenticated;
grant all on public.advance_settlements to service_role;
alter table public.advance_settlements enable row level security;
create policy "Members manage settlements" on public.advance_settlements for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- Vendor invoices
create table public.vendor_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  invoice_no text,
  invoice_date date not null default current_date,
  due_date date,
  amount numeric(14,2) not null check (amount > 0),
  status text not null default 'unpaid' check (status in ('unpaid','partially_paid','paid')),
  created_at timestamptz not null default now()
);
grant select, insert, update on public.vendor_invoices to authenticated;
grant all on public.vendor_invoices to service_role;
alter table public.vendor_invoices enable row level security;
create policy "Members manage invoices" on public.vendor_invoices for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- Vendor payments
create table public.vendor_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id uuid not null references public.vendor_invoices(id) on delete cascade,
  payment_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  account_id uuid references public.accounts(id) on delete set null,
  payment_method text,
  reference_no text,
  transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select, insert on public.vendor_payments to authenticated;
grant all on public.vendor_payments to service_role;
alter table public.vendor_payments enable row level security;
create policy "Members manage payments" on public.vendor_payments for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- Attachments metadata
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  record_type text not null,
  record_id uuid not null,
  file_path text not null,
  file_name text not null,
  content_type text,
  size_bytes bigint,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);
grant select, insert, delete on public.attachments to authenticated;
grant all on public.attachments to service_role;
alter table public.attachments enable row level security;
create policy "Members manage attachments" on public.attachments for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- Audit logs
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  table_name text not null,
  record_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  actor uuid,
  created_at timestamptz not null default now()
);
create index audit_logs_company_idx on public.audit_logs (company_id, created_at);
grant select, insert on public.audit_logs to authenticated;
grant all on public.audit_logs to service_role;
alter table public.audit_logs enable row level security;
create policy "Members read audit logs" on public.audit_logs for select to authenticated using (public.is_company_member(company_id));
create policy "Members insert audit logs" on public.audit_logs for insert to authenticated with check (public.is_company_member(company_id));

-- Audit trigger for transactions
create or replace function public.log_transaction_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (company_id, table_name, record_id, action, new_data, actor)
    values (new.company_id, 'transactions', new.id, 'insert', to_jsonb(new), auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_logs (company_id, table_name, record_id, action, old_data, new_data, actor)
    values (new.company_id, 'transactions', new.id, 'update', to_jsonb(old), to_jsonb(new), auth.uid());
    return new;
  end if;
  return null;
end;
$$;
create trigger transactions_audit
  after insert or update on public.transactions
  for each row execute function public.log_transaction_change();