# specs/

Constraint documents the Build Loop (RSI) agent must load before any UI
work. Incoming: design-system.md (tokens, component contracts, signature
elements, the mandatory load → build → critique → PR workflow, and the
rejection checklist).

Hard boundary (from the production architecture): the agent may change
UI, copy, and generation configs. It may not touch `src/engine/` — the
regression suite is the tripwire and CI runs it on every PR.
