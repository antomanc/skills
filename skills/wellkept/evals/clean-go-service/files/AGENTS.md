# notes

A small notes API.

- `make check` runs vet, golangci-lint and the tests (with -race). CI runs the same.
- Time comes from `internal/clock`; anything that needs now takes a `clock.Clock`.
- A `//nolint` names the linter and says why.
