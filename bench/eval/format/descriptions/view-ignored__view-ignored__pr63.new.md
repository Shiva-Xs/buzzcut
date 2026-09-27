perf: reuse one no-match RuleMatch per Source in ruleTestSync

Most files in a scan match no pattern, and `ruleTestSync` allocated a new `RuleMatchKind.noMatch` result for each of them. It now builds that result once per `Source` and caches it on `src._noMatchCache`, so every no-match for that Source returns the same object.

The result is shared: a caller that mutates it, or a Source whose `inverted` changes after its first miss, would see the old value. There's no measurement of the saving yet.

Not tested: run the test suite and a scan of a large tree, and check the results match.
