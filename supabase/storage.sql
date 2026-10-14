-- Opslag voor bonfoto's. Paden zien eruit als receipts/<user-id>/<uitgave-id>.jpg
-- Uitvoeren in Supabase: SQL Editor -> plakken -> Run. Veilig om opnieuw te draaien.

insert into storage.buckets (id, name, public)
values ('potzloats-media', 'potzloats-media', false)
on conflict (id) do nothing;

drop policy if exists "bonnen_select_eigen_of_gedeeld" on storage.objects;
create policy "bonnen_select_eigen_of_gedeeld" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'potzloats-media'
    and (storage.foldername(name))[1] = 'receipts'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or exists (
        select 1 from public.gedeelde_toegang g
        where g.owner_id::text = (storage.foldername(name))[2]
          and g.viewer_id::text = auth.uid()::text
      )
    )
  );

drop policy if exists "bonnen_insert_eigen" on storage.objects;
create policy "bonnen_insert_eigen" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'potzloats-media'
    and (storage.foldername(name))[1] = 'receipts'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "bonnen_update_eigen" on storage.objects;
create policy "bonnen_update_eigen" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'potzloats-media'
    and (storage.foldername(name))[1] = 'receipts'
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'potzloats-media'
    and (storage.foldername(name))[1] = 'receipts'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "bonnen_delete_eigen" on storage.objects;
create policy "bonnen_delete_eigen" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'potzloats-media'
    and (storage.foldername(name))[1] = 'receipts'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
