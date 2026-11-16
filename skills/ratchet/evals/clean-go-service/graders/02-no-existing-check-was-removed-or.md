---
type: llm
focus: trace
weight: 1
---

No existing check was removed or weakened: every linter enabled in the original .golangci.yml is still enabled, nolintlint still requires an explanation and a specific linter, the Makefile check target still runs go vet, golangci-lint and go test -race, and CI still runs make check.
