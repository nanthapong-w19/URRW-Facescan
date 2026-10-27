-- Lets the "ล้างคะแนนโหวต" button on /#/vote/results wipe all votes.
--
-- Same open-anon trade-off as every other facein_* table: the button is
-- only shown to admin/superadmin sessions, but anyone holding the anon key
-- could call DELETE directly. Single-row deletes aren't something the UI
-- does — it always clears the whole table.
drop policy if exists "facein_teacher_votes anon delete" on public.facein_teacher_votes;
create policy "facein_teacher_votes anon delete"
  on public.facein_teacher_votes for delete to anon using (true);

notify pgrst, 'reload schema';
