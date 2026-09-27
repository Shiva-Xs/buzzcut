Return 426 for premium search filters and fix Svelte upgrade prompts

The Svelte UI checked stack searches against the event field rules and only read the raw URL filter, so free stack searches like `critical:true` got an upgrade prompt and premium filters from saved views got none. Direct API calls with a premium filter got silently filtered results.

### API
- Event search, event count and stack search return `426 Upgrade Required` ("Please upgrade your plan to use premium search features.") for a premium filter on a non-premium organization; the policy moves into a new `ApiFilterPolicy`, which keeps the global-admin exemption for scoped searches
- Stack-mode event queries go through a new `EventStackQueryValidator`: a field is free if it's free for events or for stacks
- Session endpoints still count as premium and now answer with their own session upgrade message; the OpenAPI document gains the 426 responses

### Svelte UI
- `premium-filter.ts` decides per resource, so `critical`, `first` and `last` are free on stacks, reads the effective filter including saved views, ignores field names inside values, and handles Lucene range and existence filters
- The event, stack, stream and session pages show the guidance, and the legacy Angular error text falls back to the response `title`

No configuration key or WebSocket message changes.

Tested: `npm run validate`, `npm run test:unit` (310 passed), `npm run build`, and three controller regression tests pass. Dogfooded against Aspire: stack `title:timeout` and event `tags:important` show the upgrade prompt; stack `critical:true` and event `reference:ABC123` don't.
