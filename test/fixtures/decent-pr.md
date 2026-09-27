## Summary

Page 2 of the orders list repeated the last row of page 1, because the cursor query used `<=`. Fixes #231.

## Changes

- **Cursor**: the query now uses `created_at < :cursor`
- **API**: `GET /orders` returns `next_cursor` from the last row
- **Types**: `OrderPage` matches the new response

## Testing

Ran `npm test` (84 passed) and paged through 3 pages of staging orders.
