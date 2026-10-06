-- Additive bank SMS integration. Secrets live only as SHA-256 hashes in private.
-- Preserve the existing view's invoker security while increasing JOD precision.
drop view public.monthly_spending;
alter table public.expenses alter column amount type numeric(13,3);
alter table public.incomes alter column amount type numeric(13,3);
alter table public.budgets alter column amount type numeric(13,3);
create view public.monthly_spending with (security_invoker=true) as
select household_id,user_id,category_id,expense_type,
 date_trunc('month',expense_date::timestamptz)::date as month_start,
 count(*) as transaction_count,sum(amount) as total_amount
from public.expenses group by household_id,user_id,category_id,expense_type,date_trunc('month',expense_date::timestamptz)::date;
revoke all on public.monthly_spending from public,anon;
grant select on public.monthly_spending to authenticated;

create table public.bank_accounts (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 user_id uuid not null,
 bank text not null default 'Arab Bank' check (bank='Arab Bank'),
 masked_account text not null check (masked_account ~ '^[0-9]{2,12}[*]{1,12}[0-9]{3,4}$'),
 label text not null check (length(btrim(label)) between 1 and 60),
 default_category_id uuid not null,
 enabled boolean not null default true,
 automation_configured boolean not null default false,
 created_at timestamptz not null default now(),
 unique(household_id,bank,masked_account),
 unique(id,household_id),
 foreign key(household_id,user_id) references public.household_members(household_id,user_id) on delete cascade,
 foreign key(default_category_id,household_id) references public.categories(id,household_id) on delete restrict
);
alter table public.bank_accounts enable row level security;
create policy bank_accounts_read on public.bank_accounts for select to authenticated
 using (private.can_write_expense(household_id,user_id));
revoke all on public.bank_accounts from public,anon,authenticated;
grant select on public.bank_accounts to authenticated;

create table private.bank_automation_keys (
 account_id uuid primary key references public.bank_accounts(id) on delete cascade,
 token_hash text not null unique check (length(token_hash)=64),
 issued_by uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '1 year')
);
alter table private.bank_automation_keys enable row level security;
revoke all on private.bank_automation_keys from public,anon,authenticated;

create table public.bank_sms_events (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null,
 household_id uuid not null,
 expense_id uuid references public.expenses(id) on delete set null,
 fingerprint text not null,
 amount numeric(13,3) not null check(amount>0),
 merchant text not null check(length(merchant) between 1 and 100),
 transaction_date date not null,
 transaction_time time not null,
 reported_balance numeric(14,3) not null,
 received_at timestamptz not null default now(),
 unique(account_id,fingerprint),
 foreign key(account_id,household_id) references public.bank_accounts(id,household_id) on delete cascade
);
create index bank_sms_events_household_received on public.bank_sms_events(household_id,received_at desc);
create index bank_sms_events_account_received on public.bank_sms_events(account_id,received_at desc);
create index bank_sms_events_expense on public.bank_sms_events(expense_id);
alter table public.bank_sms_events enable row level security;
create policy bank_sms_events_read on public.bank_sms_events for select to authenticated
 using (exists(select 1 from public.bank_accounts a where a.id=account_id and private.can_write_expense(a.household_id,a.user_id)));
revoke all on public.bank_sms_events from public,anon,authenticated;
grant select on public.bank_sms_events to authenticated;

create function private.save_bank_account(p_household_id uuid,p_masked_account text,p_user_id uuid,p_label text,p_category_id uuid,p_account_id uuid,p_enabled boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare a public.bank_accounts; result uuid;
begin
 if auth.uid() is null or not private.can_write_expense(p_household_id,p_user_id) then raise exception 'Household access required' using errcode='42501'; end if;
 if p_account_id is not null then
  select * into a from public.bank_accounts where id=p_account_id for update;
  if not found or a.household_id<>p_household_id or not private.can_write_expense(a.household_id,a.user_id) then raise exception 'Household access required' using errcode='42501'; end if;
  -- Moving an account or changing its identifier invalidates its old capability.
  if a.user_id<>p_user_id or a.masked_account<>btrim(p_masked_account) or not p_enabled then
   delete from private.bank_automation_keys where account_id=a.id;
  end if;
  update public.bank_accounts set user_id=p_user_id,masked_account=btrim(p_masked_account),label=btrim(p_label),default_category_id=p_category_id,enabled=p_enabled,
   automation_configured=exists(select 1 from private.bank_automation_keys k where k.account_id=a.id) where id=a.id returning id into result;
 else
  insert into public.bank_accounts(household_id,user_id,masked_account,label,default_category_id,enabled)
   values(p_household_id,p_user_id,btrim(p_masked_account),btrim(p_label),p_category_id,p_enabled) returning id into result;
 end if;
 return result;
end $$;
revoke all on function private.save_bank_account(uuid,text,uuid,text,uuid,uuid,boolean) from public,anon;
grant execute on function private.save_bank_account(uuid,text,uuid,text,uuid,uuid,boolean) to authenticated;
create function public.save_bank_account(p_household_id uuid,p_masked_account text,p_user_id uuid,p_label text,p_category_id uuid,p_account_id uuid default null,p_enabled boolean default true)
returns uuid language sql security invoker set search_path='' as $$ select private.save_bank_account(p_household_id,p_masked_account,p_user_id,p_label,p_category_id,p_account_id,p_enabled) $$;
revoke all on function public.save_bank_account(uuid,text,uuid,text,uuid,uuid,boolean) from public,anon;
grant execute on function public.save_bank_account(uuid,text,uuid,text,uuid,uuid,boolean) to authenticated;

create function private.set_bank_automation_key(p_account_id uuid,p_token text)
returns void language plpgsql security definer set search_path='' as $$
declare a public.bank_accounts;
begin
 select * into a from public.bank_accounts where id=p_account_id for update;
 if not found or auth.uid() is null or not private.can_write_expense(a.household_id,a.user_id) then raise exception 'Household access required' using errcode='42501'; end if;
 if p_token is null then
  delete from private.bank_automation_keys where account_id=a.id;
  update public.bank_accounts set automation_configured=false where id=a.id;
 else
  if not a.enabled or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid automation key'; end if;
  insert into private.bank_automation_keys(account_id,token_hash,issued_by,expires_at)
   values(a.id,encode(extensions.digest(p_token,'sha256'),'hex'),auth.uid(),now()+interval '1 year')
   on conflict(account_id) do update set token_hash=excluded.token_hash,issued_by=excluded.issued_by,created_at=now(),expires_at=excluded.expires_at;
  update public.bank_accounts set automation_configured=true where id=a.id;
 end if;
end $$;
revoke all on function private.set_bank_automation_key(uuid,text) from public,anon;
grant execute on function private.set_bank_automation_key(uuid,text) to authenticated;
create function public.set_bank_automation_key(p_account_id uuid,p_token text default null)
returns void language sql security invoker set search_path='' as $$ select private.set_bank_automation_key(p_account_id,p_token) $$;
revoke all on function public.set_bank_automation_key(uuid,text) from public,anon;
grant execute on function public.set_bank_automation_key(uuid,text) to authenticated;

-- Only the Edge Function service role can call this operation. No client IDs,
-- household IDs, user IDs or category IDs are accepted from the incoming SMS.
create function private.ingest_bank_purchase(p_token text,p_purchase jsonb,p_dry_run boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.bank_accounts; k private.bank_automation_keys; e public.bank_sms_events;
 amount_value numeric; balance_value numeric; date_value date; time_value time; merchant_value text;
 fingerprint_value text; expense uuid; category uuid; subcategory uuid;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid automation key' using errcode='28000'; end if;
 select * into k from private.bank_automation_keys where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and expires_at>now();
 if not found then raise exception 'Invalid automation key' using errcode='28000'; end if;
 select * into a from public.bank_accounts where id=k.account_id for update;
 -- Locking the account serializes imports, rotations and revocations.
 if not found or not a.enabled or not exists(select 1 from private.bank_automation_keys where account_id=a.id and token_hash=k.token_hash and expires_at>now())
  or not exists(select 1 from public.household_members where household_id=a.household_id and user_id=a.user_id)
  or not exists(select 1 from public.household_members where household_id=a.household_id and user_id=k.issued_by and (user_id=a.user_id or role='admin')) then
  raise exception 'Invalid automation key' using errcode='28000';
 end if;
 if p_purchase->>'account' is distinct from a.masked_account then raise exception 'Account mismatch'; end if;
 if jsonb_typeof(p_purchase)<>'object' or coalesce(p_purchase->>'amount','') !~ '^[0-9]{1,7}[.][0-9]{3}$'
  or coalesce(p_purchase->>'balance','') !~ '^-?[0-9]{1,10}[.][0-9]{3}$'
  or coalesce(p_purchase->>'date','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
  or coalesce(p_purchase->>'time','') !~ '^[0-9]{2}:[0-9]{2}$'
  or coalesce(length(btrim(p_purchase->>'merchant')),0) not between 1 and 100 then raise exception 'Invalid purchase'; end if;
 amount_value:=(p_purchase->>'amount')::numeric; balance_value:=(p_purchase->>'balance')::numeric;
 date_value:=(p_purchase->>'date')::date; time_value:=(p_purchase->>'time')::time; merchant_value:=btrim(p_purchase->>'merchant');
 if amount_value<=0 or amount_value>9999999 or time_value>='24:00'::time then raise exception 'Invalid purchase'; end if;
 fingerprint_value:=encode(extensions.digest(jsonb_build_array(a.masked_account,date_value,p_purchase->>'time',upper(regexp_replace(merchant_value,'\s+',' ','g')),amount_value,balance_value)::text,'sha256'),'hex');
 select * into e from public.bank_sms_events where account_id=a.id and fingerprint=fingerprint_value;
 if found then return jsonb_build_object('status','duplicate','expense_id',e.expense_id,'message','العملية مسجلة سابقًا؛ لم يتكرر الخصم.'); end if;
 if p_dry_run then return jsonb_build_object('status','preview','amount',amount_value,'merchant',merchant_value,'date',date_value,'message','المعاينة صحيحة؛ لم يتم تسجيل مصروف.'); end if;
 if (select count(*) from public.bank_sms_events where account_id=a.id and received_at>now()-interval '1 hour')>=120 then raise exception 'Rate limit'; end if;
 category:=a.default_category_id;
 -- Only a known supermarket pattern is auto-classified; other merchants use
 -- the user's chosen fallback category and remain editable in the expenses UI.
 if merchant_value ~* '(SUPERMARKET|CARREFOUR|SAMA AL DAHYYA MARKET)' then
  select c.id into category from public.categories c where c.household_id=a.household_id and c.icon='food' order by c.created_at limit 1;
  category:=coalesce(category,a.default_category_id);
 end if;
 select s.id into subcategory from public.subcategories s where s.category_id=category and not s.archived
  order by (s.name=case when category<>a.default_category_id then 'سوبرماركت' else 'أخرى' end) desc,s.created_at limit 1;
 if subcategory is null then raise exception 'No active subcategory'; end if;
 insert into public.expenses(household_id,user_id,category_id,subcategory_id,amount,expense_date,merchant,payment_method,expense_type,note,created_by)
  values(a.household_id,a.user_id,category,subcategory,amount_value,date_value,merchant_value,'Visa','need',
   'تلقائي من Arab Bank · '||a.masked_account||' · '||to_char(time_value,'HH24:MI')||' · راجع التصنيف والنوع عند الحاجة',k.issued_by) returning id into expense;
 insert into public.bank_sms_events(account_id,household_id,expense_id,fingerprint,amount,merchant,transaction_date,transaction_time,reported_balance)
  values(a.id,a.household_id,expense,fingerprint_value,amount_value,merchant_value,date_value,time_value,balance_value);
 return jsonb_build_object('status','recorded','expense_id',expense,'amount',amount_value,'message','تم تسجيل المصروف وتحديث المتبقي من الميزانية.');
end $$;
revoke all on function private.ingest_bank_purchase(text,jsonb,boolean) from public,anon,authenticated;
grant execute on function private.ingest_bank_purchase(text,jsonb,boolean) to service_role;
grant usage on schema private to authenticated,service_role;
create function public.ingest_bank_purchase(p_token text,p_purchase jsonb,p_dry_run boolean default false)
returns jsonb language sql security invoker set search_path='' as $$ select private.ingest_bank_purchase(p_token,p_purchase,p_dry_run) $$;
revoke all on function public.ingest_bank_purchase(text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.ingest_bank_purchase(text,jsonb,boolean) to service_role;

-- Explicitly authorized mapping. Resolve IDs from existing membership, not literals.
do $$
declare owner_id uuid; home_id uuid; category_id uuid;
begin
 if (select count(*) from public.profiles p join public.household_members m on m.user_id=p.id where lower(btrim(p.display_name))='ahed bseiso')<>1 then
  raise exception 'Expected exactly one Ahed bseiso membership';
 end if;
 select p.id,m.household_id into owner_id,home_id from public.profiles p join public.household_members m on m.user_id=p.id where lower(btrim(p.display_name))='ahed bseiso';
 select c.id into category_id from public.categories c where c.household_id=home_id and c.name='أخرى' order by c.created_at limit 1;
 if category_id is null then raise exception 'Fallback category missing'; end if;
 insert into public.bank_accounts(household_id,user_id,masked_account,label,default_category_id)
  values(home_id,owner_id,'0119*600','حساب عاهد · Arab Bank',category_id) on conflict(household_id,bank,masked_account) do nothing;
end $$;
