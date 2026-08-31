# Migrations

## How they get applied

Schema changes go through the Supabase **`apply_migration` MCP tool** when
working with an agent that has it, otherwise `supabase migration new`
(`AGENTS.md` § Modifying the database). Applying it is only half the job: the
SQL must also land here, or the next environment cannot be rebuilt and the next
agent cannot see what the schema is supposed to be.

Recover the exact SQL of anything already applied:

```sql
select version, name, statements[1]
from supabase_migrations.schema_migrations
where version like '202608%'
order by version;
```

## Read this before adding a file

**The filenames here do not all match the versions recorded in the database.**
Historically a migration was applied through the MCP tool — which stamps its own
timestamp, e.g. `20260625091924` — and a file was then written by hand with a
rounded one, `20260625090000_add_boxes_operator_reserve.sql`. Same DDL, two
version numbers. Roughly twenty files carry this divergence.

The consequence matters: to `supabase db push`, a rounded filename is an
**unapplied** migration and will be re-run. Most of our DDL is `if not exists`
and would survive that, but not all of it — `20260831100101_avatar_usage_sessions.sql`
opens with a bare `create table` and would fail.

So, for anything new: **name the file with the exact version the database
recorded**, not a rounded one. The three August 2026 files follow that rule.
Fixing the historical twenty is a separate, deliberate reconciliation — do not
half-do it.

## Current state (2026-08-31)

The database ledger holds 47 migrations, this folder holds 24. The gap is
almost entirely the pre-2026-07 history, which was applied before the practice
of committing the file existed. It is documentation debt rather than a
correctness problem — the deployed schema is the one the app runs against — but
it does mean **this folder cannot rebuild the database from scratch today**.
