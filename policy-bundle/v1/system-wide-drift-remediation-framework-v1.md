# System-Wide Drift Remediation Framework (v1)

Scope: automatic policy drift recovery and alignment loops across `ch1tty`, `chittyconnect`, and `chittymcp`.

## 1) Trigger Conditions

Trigger remediation loop when any condition is true:

- Policy hash mismatch: deployed policy hash differs from canonical hash in `canon`.
- Conformance regression: any required test in `system-wide-conformance-tests-v1.md` fails.
- Guardrail bypass signal: protected route executes without required broker/policy gate.
- Error taxonomy drift: non-canonical policy/security error code appears in responses.
- Auth/scope drift: scope validator allows previously denied scope, or denies baseline allowlisted scope.
- Leak risk signal: long-lived secret prompt appears where policy forbids it.
- Repeated blocked failures: same policy block repeats `>= 3` times in 10 minutes for same route+intent.

## 2) Decision Tree

```text
START
  |
  |-- Is sensitive intent involved?
  |      |-- NO -> run standard drift reconcile
  |      |         (sync canonical policy + re-run conformance suite)
  |      |
  |      |-- YES
  |            |
  |            |-- Is there evidence of active leak/exfil risk?
  |            |      |-- YES -> Severity S0, contain first, fail closed everywhere
  |            |      |-- NO
  |            |
  |            |-- Is broker/policy gate unavailable or bypassed?
  |            |      |-- YES -> Severity S1, force broker-only routing + block direct execution
  |            |      |-- NO
  |            |
  |            |-- Is issue isolated to config/version mismatch?
  |                   |-- YES -> Severity S2, auto-rollforward/rollback to last good policy set
  |                   |-- NO -> Severity S3, quarantine route + manual review queue
  |
END (must pass conformance tests before clearing incident)
```

## 3) Retry and Backoff Policy

- Remediation loop retries per incident key (`surface + route + policy_version`).
- Backoff: exponential with jitter.
- Schedule: `30s`, `60s`, `120s`, `240s`, `480s`, then every `15m` (max interval).
- Max automatic attempts before escalation:
  - `S0`: 2 attempts, then page immediately.
  - `S1`: 4 attempts, then page.
  - `S2`: 6 attempts, then create manual remediation task.
  - `S3`: 8 attempts, then defer to maintenance queue.
- Cooldown reset: after 60 minutes with no new trigger for same incident key.

## 4) Incident Severity Mapping

- `S0 Critical`: leak/exfiltration suspected, policy gate bypass on sensitive route, or fail-open behavior.
- `S1 High`: broker unavailable/bypassed causing sensitive path interruption, widespread auth scope drift.
- `S2 Medium`: policy/config mismatch with fail-closed intact; conformance failures without exposure.
- `S3 Low`: localized non-sensitive drift, observability/schema mismatch, or isolated transient regression.

## 5) Automated Correction Actions

Execute by severity; always preserve fail-closed semantics for sensitive intents.

- `S0` actions:
  - Force global deny on sensitive routes except approved containment flow.
  - Revoke/rotate affected credentials via broker workflow.
  - Quarantine suspect route/tool handlers in `chittymcp` dispatch.
  - Create incident record with immutable timeline and affected policy hashes.
- `S1` actions:
  - Enforce broker-only route switch in `chittyconnect`.
  - Rebind `ch1tty` route guards to canonical policy bundle.
  - Disable non-compliant tool scopes in `chittymcp` until revalidated.
  - Trigger immediate conformance rerun after each corrective change.
- `S2` actions:
  - Auto-rollback to last known-good policy bundle if current bundle fails conformance.
  - If rollback unavailable, auto-rollforward from canonical `canon` sources.
  - Regenerate/refresh policy cache and restart policy evaluators.
- `S3` actions:
  - Reconcile metadata and error taxonomy mapping.
  - Open queued remediation issue with logs, diffs, and failing test IDs.

## 6) Alignment Loop Exit Criteria

Incident closes only when all are true:

- Canonical policy hash matches deployed hash on all three systems.
- Required conformance tests pass.
- No repeated trigger for the same incident key during one full cooldown window.
- Any temporary deny/quarantine controls are either removed safely or promoted to policy with explicit approval.
