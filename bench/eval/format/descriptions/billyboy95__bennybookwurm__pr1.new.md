Add a design doc for automated booking and WhatsApp messaging

The repo has only a README, so this adds a planning document for the booking workflow and its WhatsApp integration, `docs/automated-booking-whatsapp-deep-dive.md` (483 lines), and links it from the README. It proposes a target design; there are no code changes.

- Bookings move through explicit states (`draft`, `held`, `confirmed` through `no_show`) with an event log; slots are held for 5 to 15 minutes and a background job expires them
- WhatsApp is one delivery channel: the doc compares Meta's Cloud API, Twilio and regional providers, recommends Twilio for the fastest MVP with SMS fallback and Meta for cost and template control, and designs around the 24-hour service window, approved templates and `X-Hub-Signature-256` webhook checks
- It also covers the data model, availability and double-booking prevention, automation jobs, inbound replies, security, observability, five milestones and an API sketch
- It ends with the product assumptions and open decisions to settle first, such as the business type and Meta vs Twilio

Tested: a local Python check that the Markdown files exist and end with a newline; the repo has no test suite.
