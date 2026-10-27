-- โหวตครูในดวงใจ (teacher-of-the-heart vote).
--
-- One row per vote. `voter_device` is a random id the voting page keeps in
-- the voter's browser localStorage — the unique constraint makes it "one
-- vote per device", backstopping the client-side check against double taps
-- and two tabs racing each other. Like the rest of the facein_* tables this
-- is NOT real identity: clearing site data or switching browsers yields a
-- fresh device id.
create table if not exists public.facein_teacher_votes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.facein_members(id) on delete cascade,
  voter_device text not null,
  created_at timestamptz not null default now(),
  constraint facein_teacher_votes_voter_device_unique unique (voter_device)
);

create index if not exists facein_teacher_votes_teacher_id_idx
  on public.facein_teacher_votes (teacher_id);

alter table public.facein_teacher_votes enable row level security;

-- Anyone who scans the QR code can cast a vote and the results page reads
-- the tally with the same anon key. No update/delete policy: a cast vote
-- can't be changed or removed through the public API.
drop policy if exists "facein_teacher_votes anon insert" on public.facein_teacher_votes;
create policy "facein_teacher_votes anon insert"
  on public.facein_teacher_votes for insert to anon with check (true);

drop policy if exists "facein_teacher_votes anon select" on public.facein_teacher_votes;
create policy "facein_teacher_votes anon select"
  on public.facein_teacher_votes for select to anon using (true);
