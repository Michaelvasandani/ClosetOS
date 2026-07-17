# 07 — CLI: `add` and `list`

Status: ready-for-agent
Type: task
Blocked by: 04

Thin CLI shells over core. No domain logic here.

## Do

- `closet add` — interactive prompts (name, category, brand?, colors, formality tags, seasons?, notes?). New Items default to `cleanliness: clean`, `location: with-me`, `condition: ok`, `wear_count: 0`, `last_worn: null`. Generate slug id via `store.slugId`, write the file, print the created path + id.
- `closet list` — load items, group by category, show name, id, and `describeState` (ticket 03) with a clear availability marker (✓ available / reason if not).

## Done when

`closet add` then `closet list` shows the new item; the file exists at `wardrobe/<category>/<id>.yaml`.
