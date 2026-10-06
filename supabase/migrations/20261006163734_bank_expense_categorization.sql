-- Deterministic merchant categorization and expense-backed internal transfers.
-- The Supabase CLI is unavailable in this workspace, so this migration was
-- created with the current UTC timestamp and is also applied to production.

create or replace function private.resolve_bank_expense_category(p_household_id uuid,p_merchant text)
returns table(category_id uuid,subcategory_id uuid,expense_type text)
language plpgsql security invoker set search_path='' as $$
declare normalized text; category_name text; subcategory_name text;
begin
 normalized:=upper(regexp_replace(coalesce(p_merchant,''),'[^A-Z0-9]+',' ','g'));
 case
  when normalized ~ 'MONTHLY TRANSFER' then category_name:='مصروف شهري';subcategory_name:='مصروف شهري';expense_type:='need';
  when normalized ~ '(^| )(ATM|ABJO|CASH WITHDRAW)' then category_name:='سحب نقدي';subcategory_name:='سحب نقدي';expense_type:='need';
  when normalized ~ '(^| )(CAREEM|UBER|TAXI)( |$)' then category_name:='المواصلات';subcategory_name:='Uber / Taxi';expense_type:='need';
  when normalized ~ 'TALABAT' then category_name:='الأكل';subcategory_name:='طلبات';expense_type:='want';
  when normalized ~ '(ROASTER|ROASTERY|PECAN|COFFEE|CAFE|TRASIMENO)' then category_name:='الأكل';subcategory_name:='قهوة';expense_type:='want';
  when normalized ~ '(MARKET|SUPERMARKET|HYPERMAX|SAFEWAY|C TOWN|BAKERY|KHAYRAT|JANET MAK|JANET MAKK|SAMA AL DAHYYA|THE SITE|AL IMAN BAKERY)' then category_name:='الأكل';subcategory_name:='سوبرماركت';expense_type:='need';
  when normalized ~ '(FOOD|RESTAURANT|KITCHEN|BURGER|PIZZA|MAROUF|SUBWAY|LEBNANI SNACK|ANANAS DOWNTOWN|CRISPY CHICKEN|WOX CITY MALL)' then category_name:='الأكل';subcategory_name:='مطاعم';expense_type:='want';
  when normalized ~ '(APPLE COM BILL|NETFLIX|SPOTIFY|STEAM|PLAYSTATION|CINEMA|ZEINA CORNER)' then category_name:='الترفيه';subcategory_name:='ألعاب';expense_type:='want';
  when normalized ~ '(STATIONERY)' then category_name:='التعليم';subcategory_name:='قرطاسية';expense_type:='need';
  when normalized ~ '(BOOK|SCHOOL|UNIVERSITY|ACADEMY|COURSE|SOKON BOOKSHOP)' then category_name:='التعليم';subcategory_name:='كتب';expense_type:='need';
  when normalized ~ '(PHARM|HOSPITAL|CLINIC|DOCTOR|MEDICAL|LABORATORY|AL AMRYAH AL MARKAZEYAH)' then category_name:='النادي والصحة';subcategory_name:='أدوية';expense_type:='need';
  when normalized ~ '(GYM|FITNESS|PROTEIN|VITAMIN)' then category_name:='النادي والصحة';subcategory_name:='نادي';expense_type:='need';
  when normalized ~ '(ELECTRIC|WATER|ZAIN|ORANGE|UMNIAH|TELECOM|INTERNET|FIBER)' then category_name:='الفواتير';subcategory_name:=case when normalized ~ 'ELECTRIC' then 'كهرباء' when normalized ~ 'WATER' then 'مياه' when normalized ~ '(INTERNET|FIBER)' then 'إنترنت' else 'هاتف' end;expense_type:='need';
  when normalized ~ '(GOV|MINISTRY|MUNICIPAL|CUSTOMS|TAX|LICENSE|JOPASS)' then category_name:='المصاريف الحكومية';subcategory_name:='رسوم';expense_type:='need';
  when normalized ~ '(GIFT|FLOWER|ROSE)' then category_name:='الهدايا';subcategory_name:='مناسبات';expense_type:='want';
  when normalized ~ '(ELECTRONIC|FARHOOD MOBILE|AL AQRABAWI MOBILES)' then category_name:='التسوق';subcategory_name:='إلكترونيات';expense_type:='want';
  when normalized ~ '(GEOX|SHOE|FOOTWEAR)' then category_name:='التسوق';subcategory_name:='أحذية';expense_type:='want';
  when normalized ~ '(PERFUME|COSMETIC|MIKIAJI|LINGERIE|BAGS|ACCESSOR|OUTLET|DARAGHMEH|DAHAB|GIANT|B Z MECCA|DR BRAND|ESHARB|LAFI BROTHERS|ALBASHAER|KAWASMI|THINGS RINGS|IKRAYM|KARAKEEB|ALMASSAD|GARANTI)' then category_name:='التسوق';subcategory_name:='مستلزمات شخصية';expense_type:='want';
  else category_name:='أخرى';subcategory_name:='أخرى';expense_type:='need';
 end case;
 select c.id,s.id into category_id,subcategory_id
 from public.categories c join public.subcategories s on s.category_id=c.id and s.household_id=c.household_id
 where c.household_id=p_household_id and c.name=category_name and not s.archived
 order by (s.name=subcategory_name) desc,s.created_at limit 1;
 if category_id is null then
  select c.id,s.id into category_id,subcategory_id
  from public.categories c join public.subcategories s on s.category_id=c.id and s.household_id=c.household_id
  where c.household_id=p_household_id and c.name='أخرى' and not s.archived
  order by (s.name='أخرى') desc,s.created_at limit 1;
 end if;
 if category_id is null or subcategory_id is null then raise exception 'No active category'; end if;
 return next;
end $$;
revoke all on function private.resolve_bank_expense_category(uuid,text) from public,anon,authenticated;
grant execute on function private.resolve_bank_expense_category(uuid,text) to service_role;

alter table public.bank_transfers add column expense_id uuid references public.expenses(id) on delete set null;
create index bank_transfers_expense_id_idx on public.bank_transfers(expense_id) where expense_id is not null;

create or replace function private.ingest_bank_purchase(p_token text,p_purchase jsonb,p_dry_run boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare anchor public.bank_accounts; a public.bank_accounts; k private.bank_automation_keys; e public.bank_sms_events;
 amount_value numeric; balance_value numeric; date_value date; time_value time; merchant_value text;
 fingerprint_value text; expense uuid; category uuid; subcategory uuid; kind text; issuer_role text;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid automation key' using errcode='28000'; end if;
 select * into k from private.bank_automation_keys where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and expires_at>now();
 if not found then raise exception 'Invalid automation key' using errcode='28000'; end if;
 select * into anchor from public.bank_accounts where id=k.account_id for update;
 if not found or not anchor.enabled or not exists(select 1 from private.bank_automation_keys where account_id=anchor.id and token_hash=k.token_hash and expires_at>now())
  or not exists(select 1 from public.household_members where household_id=anchor.household_id and user_id=anchor.user_id) then raise exception 'Invalid automation key' using errcode='28000'; end if;
 select role into issuer_role from public.household_members where household_id=anchor.household_id and user_id=k.issued_by;
 if issuer_role is null or (k.issued_by<>anchor.user_id and issuer_role<>'admin') then raise exception 'Invalid automation key' using errcode='28000'; end if;
 select * into a from public.bank_accounts where household_id=anchor.household_id and bank=anchor.bank and masked_account=p_purchase->>'account';
 if not found or not a.enabled then raise exception 'Account mismatch'; end if;
 if a.id<>anchor.id and issuer_role<>'admin' then raise exception 'Invalid automation key' using errcode='28000'; end if;
 if jsonb_typeof(p_purchase)<>'object' or coalesce(p_purchase->>'amount','') !~ '^[0-9]{1,7}[.][0-9]{3}$'
  or coalesce(p_purchase->>'balance','') !~ '^-?[0-9]{1,10}[.][0-9]{3}$' or coalesce(p_purchase->>'date','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
  or coalesce(p_purchase->>'time','') !~ '^[0-9]{2}:[0-9]{2}$' or coalesce(length(btrim(p_purchase->>'merchant')),0) not between 1 and 100 then raise exception 'Invalid purchase'; end if;
 amount_value:=(p_purchase->>'amount')::numeric;balance_value:=(p_purchase->>'balance')::numeric;date_value:=(p_purchase->>'date')::date;time_value:=(p_purchase->>'time')::time;merchant_value:=btrim(p_purchase->>'merchant');
 if amount_value<=0 or amount_value>9999999 or time_value>='24:00'::time then raise exception 'Invalid purchase'; end if;
 fingerprint_value:=encode(extensions.digest(jsonb_build_array(a.masked_account,date_value,p_purchase->>'time',upper(regexp_replace(merchant_value,'\s+',' ','g')),amount_value,balance_value)::text,'sha256'),'hex');
 select * into e from public.bank_sms_events where account_id=a.id and fingerprint=fingerprint_value;
 if found then return jsonb_build_object('status','duplicate','expense_id',e.expense_id,'message','العملية مسجلة سابقًا؛ لم يتكرر الخصم.'); end if;
 select r.category_id,r.subcategory_id,r.expense_type into category,subcategory,kind from private.resolve_bank_expense_category(a.household_id,merchant_value) r;
 if p_dry_run then return jsonb_build_object('status','preview','type','purchase','amount',amount_value,'merchant',merchant_value,'date',date_value,'message','المعاينة صحيحة؛ لم يتم تسجيل مصروف.'); end if;
 if ((select count(*) from public.bank_sms_events where account_id=a.id and received_at>now()-interval '1 hour')+(select count(*) from public.bank_transfers where from_account_id=a.id and received_at>now()-interval '1 hour'))>=120 then raise exception 'Rate limit'; end if;
 insert into public.expenses(household_id,user_id,category_id,subcategory_id,amount,expense_date,merchant,payment_method,expense_type,note,created_by)
 values(a.household_id,a.user_id,category,subcategory,amount_value,date_value,merchant_value,'Visa',kind,'تلقائي من Arab Bank · '||a.masked_account||' · '||to_char(time_value,'HH24:MI')||' · راجع التصنيف عند الحاجة',k.issued_by) returning id into expense;
 insert into public.bank_sms_events(account_id,household_id,expense_id,fingerprint,amount,merchant,transaction_date,transaction_time,reported_balance)
 values(a.id,a.household_id,expense,fingerprint_value,amount_value,merchant_value,date_value,time_value,balance_value);
 return jsonb_build_object('status','recorded','type','purchase','expense_id',expense,'amount',amount_value,'message','تم تسجيل المصروف وتصنيفه تلقائيًا.');
end $$;

create or replace function private.ingest_bank_transfer(p_token text,p_transfer jsonb,p_dry_run boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare anchor public.bank_accounts; source_account public.bank_accounts; destination_account public.bank_accounts;
 k private.bank_automation_keys; existing public.bank_transfers; issuer_role text; destination_name text;
 amount_value numeric;balance_value numeric;date_value date;fingerprint_value text;transfer_id uuid;expense uuid;category uuid;subcategory uuid;kind text;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid automation key' using errcode='28000'; end if;
 select * into k from private.bank_automation_keys where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and expires_at>now();
 if not found then raise exception 'Invalid automation key' using errcode='28000'; end if;
 select * into anchor from public.bank_accounts where id=k.account_id for update;
 if not found or not anchor.enabled or not exists(select 1 from private.bank_automation_keys where account_id=anchor.id and token_hash=k.token_hash and expires_at>now()) or not exists(select 1 from public.household_members where household_id=anchor.household_id and user_id=anchor.user_id) then raise exception 'Invalid automation key' using errcode='28000'; end if;
 select role into issuer_role from public.household_members where household_id=anchor.household_id and user_id=k.issued_by;
 if issuer_role is null or (k.issued_by<>anchor.user_id and issuer_role<>'admin') then raise exception 'Invalid automation key' using errcode='28000'; end if;
 if jsonb_typeof(p_transfer)<>'object' or coalesce(p_transfer->>'amount','') !~ '^[0-9]{1,7}[.][0-9]{3}$' or coalesce(p_transfer->>'balance','') !~ '^-?[0-9]{1,10}[.][0-9]{3}$' or coalesce(p_transfer->>'date','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' or coalesce(p_transfer->>'fromAccount','') !~ '^[0-9]{2,12}[*]{1,12}[0-9]{3,4}$' or coalesce(p_transfer->>'toAccount','') !~ '^[0-9]{2,12}[*]{1,12}[0-9]{3,4}$' then raise exception 'Invalid transfer'; end if;
 select * into source_account from public.bank_accounts where household_id=anchor.household_id and bank=anchor.bank and masked_account=p_transfer->>'fromAccount';
 if not found or not source_account.enabled then raise exception 'Account mismatch'; end if;
 if source_account.id<>anchor.id and issuer_role<>'admin' then raise exception 'Invalid automation key' using errcode='28000'; end if;
 select * into destination_account from public.bank_accounts where household_id=anchor.household_id and bank=anchor.bank and masked_account=p_transfer->>'toAccount';
 if not found or not destination_account.enabled then raise exception 'Destination account not linked'; end if;
 if source_account.id=destination_account.id then raise exception 'Invalid transfer'; end if;
 amount_value:=(p_transfer->>'amount')::numeric;balance_value:=(p_transfer->>'balance')::numeric;date_value:=(p_transfer->>'date')::date;
 if amount_value<=0 or amount_value>9999999 then raise exception 'Invalid transfer'; end if;
 fingerprint_value:=encode(extensions.digest(jsonb_build_array(source_account.masked_account,destination_account.masked_account,date_value,amount_value,balance_value)::text,'sha256'),'hex');
 select * into existing from public.bank_transfers where from_account_id=source_account.id and fingerprint=fingerprint_value;
 if found then return jsonb_build_object('status','duplicate','type','transfer','transfer_id',existing.id,'expense_id',existing.expense_id,'message','الحوالة مسجلة سابقًا؛ لم يتكرر المصروف.'); end if;
 select p.display_name into destination_name from public.profiles p where p.id=destination_account.user_id;
 select r.category_id,r.subcategory_id,r.expense_type into category,subcategory,kind from private.resolve_bank_expense_category(source_account.household_id,'MONTHLY TRANSFER') r;
 if p_dry_run then return jsonb_build_object('status','preview','type','transfer','amount',amount_value,'date',date_value,'message','المعاينة صحيحة؛ لم يتم تسجيل الحوالة أو المصروف.'); end if;
 if ((select count(*) from public.bank_sms_events where account_id=source_account.id and received_at>now()-interval '1 hour')+(select count(*) from public.bank_transfers where from_account_id=source_account.id and received_at>now()-interval '1 hour'))>=120 then raise exception 'Rate limit'; end if;
 insert into public.expenses(household_id,user_id,category_id,subcategory_id,amount,expense_date,merchant,payment_method,expense_type,note,created_by)
 values(source_account.household_id,source_account.user_id,category,subcategory,amount_value,date_value,coalesce(destination_name,destination_account.label),'تحويل بنكي',kind,'حوالة تلقائية إلى '||destination_account.masked_account||' من Arab Bank',k.issued_by) returning id into expense;
 insert into public.bank_transfers(household_id,from_account_id,to_account_id,expense_id,fingerprint,amount,transfer_date,reported_balance)
 values(source_account.household_id,source_account.id,destination_account.id,expense,fingerprint_value,amount_value,date_value,balance_value) returning id into transfer_id;
 return jsonb_build_object('status','recorded','type','transfer','transfer_id',transfer_id,'expense_id',expense,'amount',amount_value,'message','تم تسجيل الحوالة كمصروف على الشخص المرسل.');
end $$;

do $$
declare t record;category uuid;subcategory uuid;kind text;expense uuid;
begin
 for t in select bt.id,bt.household_id,bt.amount,bt.transfer_date,fa.user_id,ta.masked_account,ta.label,p.display_name
          from public.bank_transfers bt join public.bank_accounts fa on fa.id=bt.from_account_id
          join public.bank_accounts ta on ta.id=bt.to_account_id join public.profiles p on p.id=ta.user_id
          where bt.expense_id is null
 loop
  select r.category_id,r.subcategory_id,r.expense_type into category,subcategory,kind
  from private.resolve_bank_expense_category(t.household_id,'MONTHLY TRANSFER') r;
  insert into public.expenses(household_id,user_id,category_id,subcategory_id,amount,expense_date,merchant,payment_method,expense_type,note,created_by)
  values(t.household_id,t.user_id,category,subcategory,t.amount,t.transfer_date,coalesce(t.display_name,t.label),'تحويل بنكي',kind,'حوالة تلقائية إلى '||t.masked_account||' من Arab Bank',t.user_id) returning id into expense;
  update public.bank_transfers set expense_id=expense where id=t.id;
 end loop;
end $$;
