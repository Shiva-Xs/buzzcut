Add a continuous benchmarking tutorial for current-bench

This adds a platform tutorial on benchmarking OCaml projects with current-bench (bench.ci.dev), at `data/tutorials/platform/2_13_current_bench.md`, served at `/docs/continuous-benchmarking`.

- Covers the `make bench` contract (JSON on stdout, logs on stderr), the JSON format with a field table, and the cobench library
- Walks through setup: the Makefile target, the GitHub App, approval, results, and an optional `bench.Dockerfile`; then the dashboard and PR workflow, self-hosting with Docker Compose, and submitting results through the API
- Links to the OCaml-CI and Docker tutorials, lists `bootstrapping-a-dune-project` as a prerequisite, and opens with a note that it was written with AI assistance and reviewed by the OCaml.org team

Not tested: check that `dune build` passes, the page renders at `/docs/continuous-benchmarking`, its links resolve, and the code examples compile.
