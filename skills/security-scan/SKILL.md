---
name: security-scan
description: Scan diff for secrets, injection and unsafe shell; write SECURITY report
---

# security-scan

Custom graph node: security scan between review and test.

## Inputs

- `diff`: unified diff of the change under review.
- Related file paths from the review output.

## Steps

1. Read the `diff` input.
2. Scan for secrets (tokens, keys, passwords), injection risks (SQL, shell, XSS), and unsafe shell usage (`eval`, `curl | sh`, unquoted variables).
3. Classify findings by severity (high, medium, low).
4. Write a `SECURITY.md` (or `SECURITY-<slug>.md`) report with findings and remediation.
5. Decide the outcome: `fail` on high severity, otherwise `pass`. Use `needs_info` or `blocked` when evidence is missing.

## Output

- `SECURITY.md` report file.
- Finish with the required JSON block:

```json
{"atomic_result": 1, "node": "security-scan", "outcome": "pass|fail|needs_info|blocked", "next": "<node>", "reason": "..."}
```
