<!-- Loaded when working in this directory. Moved from the root CLAUDE.md. -->

# Data Inspector

The Data page reads the database through `DataInspector` (`database/DataInspector.ts`) over
the tRPC queries `data.listTables` / `data.queryRows` (`server/trpc/dataRouter.ts`), which report
what it refuses (an unknown table or column) as a `BAD_REQUEST` with its reason. It opens its own
`readOnly` connection, reads only the tables in its `TABLES` allow-list, checks every table and
column name against the schema SQLite reports, and binds every value; there is no free-form SQL.
`integration_state.config` is never selected (only its length, shown as `encrypted · N B`) and the
encryption salt row is hidden. A new table is invisible to it until it gets a `TABLES` entry, and
`DataInspector.test.ts` fails until it does; anything secret in it must be listed in `masked` (a column) or `maskedRows` (rows by key). A
secret row also drops out of any query that searches, filters or sorts on its hidden values, so
its value can't be guessed one query at a time.
