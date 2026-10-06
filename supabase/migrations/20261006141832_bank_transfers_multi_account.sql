-- Track internal Arab Bank transfers without changing household spending totals.
-- One admin-created Shortcut key may ingest any enabled account mapped to the
-- same household, so a single Arab Bank message thread is sufficient.

create table public.bank_transfers (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 from_account_id uuid not null,
 to_account_id uuid not null,
 fingerprint text not null,
 amount numeric(13,3) not null check(amount>0),
 transfer_date date not null,
 reported_balance numeric(14,3) not null,
 received_at timestamptz not null default now(),
 check(from_account_id<>to_account_id),
 unique(from_account_id,fingerprint),
 foreign key(from_account_id,household_id) references public.bank_accounts(id,household_id) on delete cascade,
 foreign key(to_account_id,household_id) references public.bank_accounts(id,household_id) on delete cascade
);
create index bank_transfers_household_received on public.bank_transfers(household_id,received_at desc);
create index bank_transfers_from_received on public.bank_transfers(from_account_id,received_at desc);
create index bank_transfers_to_received on public.bank_transfers(to_account_id,received_at desc);
alter table public.bank_transfers enable row level security;
create policy bank_transfers_read on public.bank_transfers for select to authenticated
 using (exists(
  select 1 from public.bank_accounts a
  where a.id in (from_account_id,to_account_id)
   and private.can_write_expense(a.household_id,a.user_id)
 ));
revoke all on public.bank_transfers from public,anon,authenticated;
grant select on public.bank_transfers to authenticated;

create or replace function private.ingest_bank_purchase(p_token text,p_purchase jsonb,p_dry_run boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare anchor public.bank_accounts; a public.bank_accounts; k private.bank_automation_keys; e public.bank_sms_events;
 amount_value numeric; balance_value numeric; date_value date; time_value time; merchant_value text;
 fingerprint_value text; expense uuid; category uuid; subcategory uuid; issuer_role text;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid automation key' using errcode='28000'; end if;
 select * into k from private.bank_automation_keys where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and expires_at>now();
 if not found then raise exception 'Invalid automation key' using errcode='28000'; end if;
 select * into anchor from public.bank_accounts where id=k.account_id for update;
 if not found or not anchor.enabled or not exists(select 1 from private.bank_automation_keys where account_id=anchor.id and token_hash=k.token_hash and expires_at>now())
  or not exists(select 1 from public.household_members where household_id=anchor.household_id and user_id=anchor.user_id) then
  raise exception 'Invalid automation key' using errcode='28000';
 end if;
 select role into issuer_role from public.household_members where household_id=anchor.household_id and user_id=k.issued_by;
 if issuer_role is null or (k.issued_by<>anchor.user_id and issuer_role<>'admin') then raise exception 'Invalid automation key' using errcode='28000'; end if;
 select * into a from public.bank_accounts where household_id=anchor.household_id and bank=anchor.bank and masked_account=p_purchase->>'account';
 if not found or not a.enabled then raise exception 'Account mismatch'; end if;
 if a.id<>anchor.id and issuer_role<>'admin' then raise exception 'Invalid automation key' using errcode='28000'; end if;
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
 if p_dry_run then return jsonb_build_object('status','preview','type','purchase','amount',amount_value,'merchant',merchant_value,'date',date_value,'message','المعاينة صحيحة؛ لم يتم تسجيل مصروف.'); end if;
 if ((select count(*) from public.bank_sms_events where account_id=a.id and received_at>now()-interval '1 hour')+
     (select count(*) from public.bank_transfers where from_account_id=a.id and received_at>now()-interval '1 hour'))>=120 then raise exception 'Rate limit'; end if;
 category:=a.default_category_id;
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
 return jsonb_build_object('status','recorded','type','purchase','expense_id',expense,'amount',amount_value,'message','تم تسجيل المصروف وتحديث المتبقي من الميزانية.');
end $$;
revoke all on function private.ingest_bank_purchase(text,jsonb,boolean) from public,anon,authenticated;
grant execute on function private.ingest_bank_purchase(text,jsonb,boolean) to service_role;

create function private.ingest_bank_transfer(p_token text,p_transfer jsonb,p_dry_run boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare anchor public.bank_accounts; source_account public.bank_accounts; destination_account public.bank_accounts;
 k private.bank_automation_keys; existing public.bank_transfers; issuer_role text;
 amount_value numeric; balance_value numeric; date_value date; fingerprint_value text; transfer_id uuid;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid automation key' using errcode='28000'; end if;
 select * into k from private.bank_automation_keys where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and expires_at>now();
 if not found then raise exception 'Invalid automation key' using errcode='28000'; end if;
 select * into anchor from public.bank_accounts where id=k.account_id for update;
 if not found or not anchor.enabled or not exists(select 1 from private.bank_automation_keys where account_id=anchor.id and token_hash=k.token_hash and expires_at>now())
  or not exists(select 1 from public.household_members where household_id=anchor.household_id and user_id=anchor.user_id) then
  raise exception 'Invalid automation key' using errcode='28000';
 end if;
 select role into issuer_role from public.household_members where household_id=anchor.household_id and user_id=k.issued_by;
 if issuer_role is null or (k.issued_by<>anchor.user_id and issuer_role<>'admin') then raise exception 'Invalid automation key' using errcode='28000'; end if;
 if jsonb_typeof(p_transfer)<>'object' or coalesce(p_transfer->>'amount','') !~ '^[0-9]{1,7}[.][0-9]{3}$'
  or coalesce(p_transfer->>'balance','') !~ '^-?[0-9]{1,10}[.][0-9]{3}$'
  or coalesce(p_transfer->>'date','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
  or coalesce(p_transfer->>'fromAccount','') !~ '^[0-9]{2,12}[*]{1,12}[0-9]{3,4}$'
  or coalesce(p_transfer->>'toAccount','') !~ '^[0-9]{2,12}[*]{1,12}[0-9]{3,4}$' then raise exception 'Invalid transfer'; end if;
 select * into source_account from public.bank_accounts where household_id=anchor.household_id and bank=anchor.bank and masked_account=p_transfer->>'fromAccount';
 if not found or not source_account.enabled then raise exception 'Account mismatch'; end if;
 if source_account.id<>anchor.id and issuer_role<>'admin' then raise exception 'Invalid automation key' using errcode='28000'; end if;
 select * into destination_account from public.bank_accounts where household_id=anchor.household_id and bank=anchor.bank and masked_account=p_transfer->>'toAccount';
 if not found or not destination_account.enabled then raise exception 'Destination account not linked'; end if;
 if source_account.id=destination_account.id then raise exception 'Invalid transfer'; end if;
 amount_value:=(p_transfer->>'amount')::numeric; balance_value:=(p_transfer->>'balance')::numeric; date_value:=(p_transfer->>'date')::date;
 if amount_value<=0 or amount_value>9999999 then raise exception 'Invalid transfer'; end if;
 fingerprint_value:=encode(extensions.digest(jsonb_build_array(source_account.masked_account,destination_account.masked_account,date_value,amount_value,balance_value)::text,'sha256'),'hex');
 select * into existing from public.bank_transfers where from_account_id=source_account.id and fingerprint=fingerprint_value;
 if found then return jsonb_build_object('status','duplicate','type','transfer','transfer_id',existing.id,'message','الحوالة مسجلة سابقًا؛ لم تتكرر.'); end if;
 if p_dry_run then return jsonb_build_object('status','preview','type','transfer','amount',amount_value,'date',date_value,'message','المعاينة صحيحة؛ لم يتم تسجيل الحوالة.'); end if;
 if ((select count(*) from public.bank_sms_events where account_id=source_account.id and received_at>now()-interval '1 hour')+
     (select count(*) from public.bank_transfers where from_account_id=source_account.id and received_at>now()-interval '1 hour'))>=120 then raise exception 'Rate limit'; end if;
 insert into public.bank_transfers(household_id,from_account_id,to_account_id,fingerprint,amount,transfer_date,reported_balance)
  values(source_account.household_id,source_account.id,destination_account.id,fingerprint_value,amount_value,date_value,balance_value) returning id into transfer_id;
 return jsonb_build_object('status','recorded','type','transfer','transfer_id',transfer_id,'amount',amount_value,'message','تم تسجيل الحوالة بين الحسابين دون احتسابها كمصروف منزلي.');
end $$;
revoke all on function private.ingest_bank_transfer(text,jsonb,boolean) from public,anon,authenticated;
grant execute on function private.ingest_bank_transfer(text,jsonb,boolean) to service_role;

create function public.ingest_bank_transfer(p_token text,p_transfer jsonb,p_dry_run boolean default false)
returns jsonb language sql security invoker set search_path='' as $$ select private.ingest_bank_transfer(p_token,p_transfer,p_dry_run) $$;
revoke all on function public.ingest_bank_transfer(text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.ingest_bank_transfer(text,jsonb,boolean) to service_role;

do $$
declare home_id uuid; category_id uuid; owner_id uuid; mapping record;
begin
 select m.household_id into strict home_id from public.profiles p join public.household_members m on m.user_id=p.id
  where lower(btrim(p.display_name))='ahed bseiso';
 select c.id into category_id from public.categories c where c.household_id=home_id and c.name='أخرى' order by c.created_at limit 1;
 if category_id is null then raise exception 'Fallback category missing'; end if;
 for mapping in select * from (values
  ('tatiana bseiso','0119*603','حساب Tatiana · Arab Bank'),
  ('najwa bseiso','0119*604','حساب Najwa · Arab Bank')
 ) as v(display_name,masked_account,label)
 loop
  owner_id:=null;
  select p.id into strict owner_id from public.profiles p join public.household_members m on m.user_id=p.id
   where m.household_id=home_id and lower(btrim(p.display_name))=mapping.display_name;
  insert into public.bank_accounts(household_id,user_id,masked_account,label,default_category_id,enabled)
   values(home_id,owner_id,mapping.masked_account,mapping.label,category_id,true)
   on conflict(household_id,bank,masked_account) do update set user_id=excluded.user_id,label=excluded.label,default_category_id=excluded.default_category_id,enabled=true;
 end loop;
end $$;
