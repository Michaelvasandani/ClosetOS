# 04 — YAML storage layer (store.ts)

Status: ready-for-agent
Type: task
Blocked by: 02

Read/write Items and Wears as YAML files. This is the only module that touches the filesystem for domain data.

## Do

- YAML lib (`yaml`). Parse/serialize with stable key order.
- `loadItems(): Item[]` — read every `wardrobe/*/*.yaml`. Validate against the `Item` shape; surface a clear error on malformed files (don't silently skip).
- `saveItem(item)` — write to `wardrobe/<category>/<id>.yaml`.
- `slugId(name, category, existingIds): string` — build `<type>-<distinguisher>-<NN>`, incrementing `-NN` to guarantee uniqueness.
- `findItem(idOrName, items): Item | Item[]` — exact id match, else fuzzy name match (for `dirty`/`clean`). Return ambiguity so the CLI can prompt.
- `saveWear(wear)` — write `outfits/wears/<date>-<NN>.yaml`, numbering per day.
- `loadWears(): Wear[]`, `loadLearnedPreferences(): unknown` (raw pass-through of `preferences/learned.yaml`, tolerate absent file).

## Done when

Round-trip unit tests (write Item → read back equal) using a temp dir; slug uniqueness tested; malformed-file error tested.

## Notes

One file per Item / per Wear (auditable git diffs). Never write a derived `available` field.
