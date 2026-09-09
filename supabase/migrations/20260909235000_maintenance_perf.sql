-- Supabase performance advisors on the day's tables (9 September 2026):
--   - `auth.uid()` inside a policy is re-evaluated per row; `(select auth.uid())`
--     is evaluated once per query (lint 0003 auth_rls_initplan);
--   - foreign keys the cores join or filter on get a covering index (lint 0001).
-- Same semantics, cheaper plans. Additive except for the policy rewrites.

drop policy account_users_read_attention_items on public.attention_items;
create policy account_users_read_attention_items on public.attention_items
  for select using (
    account_id in (select account_id from public.profiles where id = (select auth.uid()))
  );

drop policy account_users_read_avatar_actions on public.avatar_actions;
create policy account_users_read_avatar_actions on public.avatar_actions
  for select using (
    account_id in (select account_id from public.profiles where id = (select auth.uid()))
  );

drop policy account_users_read_audit_log on public.audit_log;
create policy account_users_read_audit_log on public.audit_log
  for select using (
    account_id in (select account_id from public.profiles where id = (select auth.uid()))
  );

drop policy account_users_read_maintenance_tasks on public.maintenance_tasks;
create policy account_users_read_maintenance_tasks on public.maintenance_tasks
  for select using (
    account_id in (select account_id from public.profiles where id = (select auth.uid()))
  );

drop policy account_users_read_cluster_candidates on public.cluster_candidates;
create policy account_users_read_cluster_candidates on public.cluster_candidates
  for select using (
    account_id in (select account_id from public.profiles where id = (select auth.uid()))
  );

drop policy account_users_read_avatar_platform_state on public.avatar_platform_state;
create policy account_users_read_avatar_platform_state on public.avatar_platform_state
  for select using (
    avatar_id in (
      select a.id from public.avatars a
      where a.account_id in (select account_id from public.profiles where id = (select auth.uid()))
    )
  );

drop policy account_users_read_avatar_briefs on public.avatar_briefs;
create policy account_users_read_avatar_briefs on public.avatar_briefs
  for select using (
    avatar_id in (
      select a.id from public.avatars a
      where a.account_id in (select account_id from public.profiles where id = (select auth.uid()))
    )
  );

drop policy account_users_read_army_briefs on public.army_briefs;
create policy account_users_read_army_briefs on public.army_briefs
  for select using (
    army_id in (
      select ar.id from public.armies ar
      where ar.account_id in (select account_id from public.profiles where id = (select auth.uid()))
    )
  );

create index if not exists attention_items_block on public.attention_items (block_id) where block_id is not null;
create index if not exists attention_items_box on public.attention_items (box_id) where box_id is not null;
create index if not exists maintenance_tasks_attention_item on public.maintenance_tasks (attention_item_id) where attention_item_id is not null;
create index if not exists cluster_candidates_account on public.cluster_candidates (account_id);
create index if not exists cluster_candidates_task on public.cluster_candidates (task_id) where task_id is not null;
create index if not exists verification_codes_task on public.verification_codes (consumed_by_task) where consumed_by_task is not null;
