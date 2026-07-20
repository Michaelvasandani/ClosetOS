# Analyzer design: signal → observations → proposal output contract

Type: prototype
Status: open
Blocked by: 02, 03

## Question

Design the **fallible analyzer** — the LLM/statistical pass that reads the signal and produces
candidate improvements (which then must survive the deterministic gate). Decide:

- **Input** — reads Wears + persisted Recommendations (ticket 02) over some window; what window/scope?
- **What it produces** — the **observation → proposal** contract: an observation ("grey polo rated
  poorly on 4/5 days above 78°F") and a concrete proposed change, expressed as a diff to structured
  `learned.yaml` (ticket 03) or, at the higher bar, a prompt edit. What evidence must accompany a
  proposal so a human PR reviewer can judge it?
- **Boundaries** — the analyzer only *proposes*; it never merges, and its output is untrusted until the
  gate passes. How is that boundary encoded in the contract?

`prototype` type: build a rough example analyzer-output artifact (an observation + proposed
`learned.yaml` diff + evidence block) against the seeded wardrobe/wears to react to. Blocked by 02, 03.
