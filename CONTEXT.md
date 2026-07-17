# ClosetOS

The domain language of ClosetOS: a wardrobe assistant that recommends outfits, tracks what the user owns and its state, and learns from real wear feedback.

## Language

### The wardrobe

**Item**:
A single piece of clothing the user owns (a specific shirt, not a category of shirts). The atomic unit of the wardrobe. Identified by a human-readable id.
_Avoid_: garment, piece, clothing, product

### Item state

An Item's state is modelled as three **orthogonal axes**, never a single status. An Item can hold one value on each axis simultaneously (e.g. dirty *and* packed).

**Cleanliness**:
Whether an Item is ready to wear on the laundry dimension: `clean`, `dirty`, or `in-laundry`.

**Location**:
Where the Item physically is / whether it's at hand: `with-me`, `packed`, `loaned-out`, or `stored`.
_Avoid_: whereabouts, place, possession

**Condition**:
The Item's physical soundness: `ok` or `needs-repair`.

**Availability**:
A *derived* fact, never a stored field: an Item is available (recommendable to wear right now) only when `cleanliness = clean` AND `location = with-me` AND `condition = ok`.
_Avoid_: status (a single flat status field is explicitly rejected — see the three axes above)

### Outfits and wear

**Outfit**:
A combination of Items filling Slots — a set of item ids and nothing else. It carries no date, rating, or opinion. Both proposals and worn events refer to an Outfit. A *valid* Outfit fills every required Slot.
_Avoid_: look, combo, ensemble

**Slot**:
A position in an Outfit filled by an Item of a given category. Required slots: `top`, `bottom`, `shoes`. Optional: `outerwear` (0–1), `accessories` (0–n). Layering (stacking multiple tops, e.g. shirt under sweater) is deliberately out of scope for now — a later, additive extension.
_Avoid_: layer, position

**Recommendation**:
The reply to one outfit request: the candidate Outfits (typically 1–3) generated for a given occasion/weather/constraints, together with the reasoning and scores behind them. What the user chooses *from*.
_Avoid_: suggestion, proposal

**Wear**:
A dated event — on a given day, in given conditions (occasion, weather), the user wore a specific Outfit — carrying the ratings and feedback for that occasion. The same Outfit worn twice is two Wears. **The Wear is the unit the learning loop consumes.**
_Avoid_: outcome, outfit history entry, wear-event

_Persistence note (not glossary): the first version stores only Wears. Persisting rejected Recommendations is deferred until the learning loop is built._

### Learning

**Learned preference**:
A durable rule about the user's taste or comfort — derived from Wears — that the recommender reads as a *soft* signal, never a hard constraint (e.g. "avoid the grey knit polo above 78°F"). In v1 these are hand-maintained by the user; automated derivation via GitHub workflows is a deferred, additive step.
_Avoid_: rule, setting, style rule
