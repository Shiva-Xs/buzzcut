Harden the GoHighLevel OAuth flow and token selection

Subaccount sync failed with "no agency/company token" when a newly connected location wasn't mirrored into `locations` yet, and the OAuth callback accepted a missing state. This tightens the install flow, keeps it on the backend, and makes token selection fall back instead of failing.

### OAuth install
- `/oauth/gohighlevel/start` requires a `client_id` (from `GHL_INSTALL_URL` or `GHL_CLIENT_ID`), always sets `state`, sets `appId` only when configured, and sends the new `GHL_OAUTH_SCOPE` as `scope`; `.env.example` moves to the `/v2/oauth/chooselocation` install URL
- The callback redirects to `/settings/integrations?ghl=error&reason=invalid_oauth_state` on a missing or mismatched state, then clears the state cookie
- The frontend's "Connect GoHighLevel" links go to that backend endpoint; the hard-coded client id, version id and scopes in `ghl-install-url.ts` are gone

### Tokens
- The code exchange tries the configured user type, then the other one (Company or Location)
- Location token lookup skips tokens expiring within 60 s, refreshes them once and retries, then falls back to the 8 newest installations of any type and `GHL_API_TOKEN`
- Company token lookup for a subaccount tries the agency mapping in `locations`, then the company of any OAuth row for that location, then the newest Company token on file
- Message sends try API versions 2023-02-21, 2021-07-28 and 2021-04-15

The last Company-token fallback assumes a single-agency workspace; with several agencies it could pick the wrong one.

Tested: `npm run check` and `npm run build` for `@agentflow/api`.
