#!/bin/sh
# Downloads the real diff of each picked PR with git (a blobless fetch of the PR head and the
# base commit it was opened against, then the diff from their merge base), and checks its line
# counts against GitHub's. The diffs are other projects' code, so they stay out of the repo.
#   sh bench/eval/format/fetch-diffs.sh [work-dir]   → bench/eval/format/diffs/<owner>__<repo>__pr<n>.diff
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${1:-${TMPDIR:-/tmp}/buzzcut-format-repos}
OUT="$HERE/diffs"
mkdir -p "$WORK" "$OUT"
node -e '
  const p = require(process.argv[1]);
  for (const x of p) {
    const [, o, r, n] = x.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    const c = require(`${process.argv[2]}/${o}__${r}__pr${n}.json`);
    console.log([o, r, n, c.baseSha, c.additions, c.deletions].join(" "));
  }' "$HERE/picked.json" "$HERE/../../cache" |
while read -r owner repo n base adds dels; do
  key="${owner}__${repo}__pr${n}"
  dir="$WORK/$key"
  if [ ! -d "$dir/.git" ]; then
    git init -q "$dir"
    git -C "$dir" remote add origin "https://github.com/$owner/$repo"
    git -C "$dir" config remote.origin.promisor true
    git -C "$dir" config remote.origin.partialclonefilter blob:none
  fi
  git -C "$dir" fetch -q --filter=blob:none --depth=200 origin "+refs/pull/$n/head:refs/pr/head" "$base" 2>/dev/null ||
    git -C "$dir" fetch -q --filter=blob:none --depth=200 origin "+refs/pull/$n/head:refs/pr/head"
  mb=$(git -C "$dir" merge-base refs/pr/head "$base" 2>/dev/null)
  if [ -z "$mb" ]; then
    git -C "$dir" fetch -q --filter=blob:none --deepen=2000 origin "+refs/pull/$n/head:refs/pr/head" "$base" 2>/dev/null
    mb=$(git -C "$dir" merge-base refs/pr/head "$base" 2>/dev/null)
  fi
  if [ -z "$mb" ]; then echo "$key: no merge base"; continue; fi
  git -C "$dir" diff "$mb" refs/pr/head > "$OUT/$key.diff"
  got=$(git -C "$dir" diff --numstat "$mb" refs/pr/head | awk '$1 != "-" { a += $1; d += $2 } END { print a + 0, d + 0 }')
  if [ "$got" = "$adds $dels" ]; then echo "$key: ok (+$adds -$dels)"; else echo "$key: MISMATCH got $got, GitHub says +$adds -$dels"; fi
done
