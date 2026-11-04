<!-- Loaded when working in this directory. -->

# Activity Log

The record of what happened, shown in the console's live feed and on History. `ActivityForwarder`
subscribes to every event named in `ACTIVITY_EVENT_CATEGORIES` (`shared/src/types/activity.ts`) and
turns each into a checked `ActivityLogEntry`. Every entry reaches the live feed; most are also stored
by `ActivityLogRepository`.

**A new event in the log** is an entry in `ActivityLogEntrySchema`, its category, a line in
`TO_ACTIVITY_DATA` saying what it records, and in the console's `activityFormat.ts` a line in
`EVENT_CATEGORIES` and a case in `describe()`; the compiler asks for all of those once the first
exists. An `EventMap` payload that drifts from its
entry doesn't compile either. A field only `EventMap` has isn't recorded, since parsing the entry
drops it.

**What isn't stored:**
- Chat. It's shown as it happens, and would push everything else out of the capped log.
- `LIVE_ONLY_EVENTS`: bursts only worth seeing live, such as a break showing and hiding a source in
  every scene.
- Simulated commands, so History is what really happened.
- An event whose `TO_ACTIVITY_DATA` line returns null, which isn't an entry at all: a platform
  turning `unavailable` in `platform.liveState`, since `platform.availability` already records that.

**Changing a payload needs no migration.** This table is the one exception to stored data failing
loudly. The log is capped at 5,000 rows, so rows written under an old shape age out on their own, and
one of them shouldn't take the Dashboard or History down. A row that doesn't fit its schema is left
out and logged. It still counts toward a page's total, so a page can hold fewer entries than its size.

**What the streamer must see goes here.** A failure an integration carries on from is
`reportFailure()` (`integration.error`), and one a feature service carries on from is `service.error`.
A log line alone reaches only the terminal.
