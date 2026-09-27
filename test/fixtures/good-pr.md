Webhook deliveries to customer endpoints fail about 2% of the time with 502s and 503s while their servers restart, and we drop the event. This retries them.

- 5xx and 429 responses retry up to 3 times with backoff (200ms, 400ms, 800ms, plus up to 100ms of jitter), then throw so the job queue picks the event up
- Other 4xx responses still fail right away, since retrying won't help

Tested: `npm test`, plus a local server that returns 503 twice, then 200.
