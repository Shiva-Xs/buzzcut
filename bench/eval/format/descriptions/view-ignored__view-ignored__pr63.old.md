perf: reuse one no-match RuleMatch per Source in ruleTestSync

Most files in a scan match no pattern, and `ruleTestSync` allocated a new `RuleMatchKind.noMatch` result for each of them. It now builds that result once per `Source` and caches it on `src._noMatchCache`, so a no-match returns the same object every time; a caller that mutates a result, or a Source whose `inverted` changes after its first miss, would now see a shared or stale value. No measurement of the saving. Not tested.
