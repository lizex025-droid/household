update storage.buckets
set file_size_limit=10485760
where id='receipts';

alter table public.expense_receipts
 drop constraint expense_receipts_size_bytes_check,
 add constraint expense_receipts_size_bytes_check check(size_bytes>0 and size_bytes<=10485760);
