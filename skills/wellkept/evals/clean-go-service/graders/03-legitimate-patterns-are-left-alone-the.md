---
type: llm
focus: trace
weight: 1
---

Legitimate patterns are left alone: the shutdown goroutine in cmd/server/main.go and time.Now in internal/clock are not treated as problems, and those files are not restructured.
