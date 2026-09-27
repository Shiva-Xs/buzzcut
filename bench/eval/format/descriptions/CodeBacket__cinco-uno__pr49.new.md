Scaffold the uno-game layout and its state contract (#31)

Phase-01 scaffold for ticket #31, per `docs/01-product-rules-and-architecture.plan.md`: the browser UNO game gets its layout and a shared state contract. Everything except the contract is a stub.

- The contract: AI opponents from `MIN_AI_OPPONENTS` 1 to `MAX_AI_OPPONENTS` 5 (`isValidAiOpponentCount`), phase transitions menu → playing → roundOver or gameOver → menu (`canTransitionPhase`), and 9 canonical `EVENT_TYPES` from `PHASE_CHANGED` to `ERROR`
- The engine, AI, UI and controller modules only mark their boundaries; `createEngine().applyIntent()` throws "Engine not implemented yet"
- A static page shell with setup and game screens, plus a README and a RULES note with the v1 rules (108 cards, 7 dealt, no Draw Two stacking)
- The turn-loop plan now tells the engine to use `EVENT_TYPES` instead of ad-hoc strings

Tested: `node --check` on the five JS files, and a `node -e` script over the AI bounds, the allowed and refused phase transitions, and the 9 event types.
