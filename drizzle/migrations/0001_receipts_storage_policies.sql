-- Receipts bucket: files live under <company_id>/<record_id>/<filename>
create policy "Members read receipts"
on storage.objects for select to authenticated
using (bucket_id = 'receipts' and public.is_company_member((storage.foldername(name))[1]::uuid));

create policy "Members upload receipts"
on storage.objects for insert to authenticated
with check (bucket_id = 'receipts' and public.is_company_member((storage.foldername(name))[1]::uuid));

create policy "Members delete receipts"
on storage.objects for delete to authenticated
using (bucket_id = 'receipts' and public.is_company_member((storage.foldername(name))[1]::uuid));