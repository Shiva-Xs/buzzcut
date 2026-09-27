Read reading time from the vp_reading_time post meta

The post view, post cards, the featured card and search results computed reading time with `str_word_count(strip_tags($content))` on the full post body on every render, including inside loops. They now read the precomputed `vp_reading_time` meta with `get_post_meta()` and count words only when a post has none.

- Same change in `Post::readingTime()` and the `featured-card`, `post-card` and `content-search` views; the fallback keeps 200 words per minute
- `readingTime()` also gains the minimum of 1 minute the views already had, and casts the value to `int` for `_n()`
- `.jules/bolt.md` records the pattern for later runs

Nothing in this diff writes `vp_reading_time`, so posts without it keep the old cost. There's no measurement of the saving.

Tested: `php -l` on the changed files. Not tested: a post with and without `vp_reading_time`.
