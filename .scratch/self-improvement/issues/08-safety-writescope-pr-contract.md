# Safety: write-scope, PR contract, anti-silent-rewrite guard

Type: grilling
Status: open
Blocked by: 06, 07

## Question

The vision's first rule: ClosetOS must **not silently rewrite its own instructions**. Decide the
safety envelope around the loop:

- **Write-scope** — the loop may write only a restricted set of paths (`preferences/learned.yaml`,
  `prompts/*.md`, `evaluations/*.yaml`) and nothing else (never `src/`, never wardrobe data). How is
  this enforced — workflow permissions, path checks in the PR gate, or both?
- **PR contract** — what every self-improvement PR must contain: the observation, the evidence, the
  proposed diff, and the regression-gate results. What does the human reviewer see to make a
  merge/reject call?
- **Anti-silent-rewrite guard** — every change lands as a reviewable PR requiring human merge; no
  auto-merge. Confirm and specify the enforcement.

Blocked by 06 (topology/permissions determine how write-scope is enforced) and 07 (the analyzer's
output shape determines the PR body). Consumes fog items once resolved.
