Document that CDP browser sessions can use the proxy

The docs and the OpenAPI spec said a CDP session can't be combined with `proxy`, but it can: the page Capture owns and the targets a CDP client creates both go through the configured proxy. Only `bypassBotDetection` is still refused with CDP.

- The Browser Sessions docs show a `{"cdp":true,"proxy":true,"maxTtlSeconds":300}` request, and the MCP integration docs say the same
- In `sessions.yaml`, `cdpWithProxy` becomes a 201 example, the 400 example becomes `cdpWithBypass` ("cdp cannot be combined with bypassBotDetection"), and the `cdp` field description matches

Test plan: `bun run openapi:validate`.
