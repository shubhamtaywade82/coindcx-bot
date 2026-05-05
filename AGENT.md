# AGENT.md

This file defines how coding agents should execute work in this repository.

## 1) Source of Truth

- `TODO.md` is the master execution checklist.
- Work must be tracked against `TODO.md` sections:
  - `A)` Existing Plan Execution (F1-F4 + roadmap slices)
  - `B)` PDF Complete Coverage Checklist
  - `C)` Definition of Done
  - `D)` PDF -> TODO Traceability Matrix

If work is not mapped in `TODO.md`, it is not ready to implement.

## 2) Required Execution Flow

For every implementation unit:

1. Select one unchecked checklist item (prefer a single PR slice).
2. Implement only that slice with tests.
3. Verify behavior with explicit commands and outputs.
4. Update checklist status only after verification evidence exists.
5. Keep PR scope small and reviewable.

Do not batch unrelated slices in one PR.

## 3) Non-Negotiable Trading/Exchange Constraints

These constraints must remain true unless explicitly changed in writing:

- Websocket client compatibility must stay pinned to `socket.io-client@2.4.0`.
- Private CoinDCX auth must use canonical JSON + HMAC-SHA256 signature contract.
- Futures endpoint implementation must come from documented/verbatim paths
  captured in `config/coindcx_futures_endpoints.yml` (not third-party gists).
- Live execution must remain disabled by default until rollout gates are met.
- Hard leverage cap: `10x`.
- Liquidation safety rule: `liq distance >= 2x stop distance`.
- "No negative close" policy applies, with `time_stop_kill` as the only
  explicit exception path (must be logged as a risk event).

## 4) Architecture Responsibilities

- Sidecar handles transport/protocol only (WS join/read/normalize/publish).
- Core runtime owns strategy, confluence, risk, routing, and state machine.
- Persistence is mandatory for signals, trades, positions, and risk events.
- Reconnect must trigger resubscribe + state reconciliation.

Keep responsibilities explicit; do not hide cross-cutting behavior in generic
helpers.

## 5) Checklist and Traceability Rules

- Every new requirement from the framework PDF must map to at least one
  `TODO.md` checklist entry.
- If a new task is added during implementation, add traceability mapping in
  `TODO.md` section `D`.
- If a requirement is intentionally deferred or out of scope, document the
  reason in the PR description.

## 6) Definition of Done (Mandatory)

A checklist item is complete only when all are true:

- Code/tests/docs updated.
- Behavior verified with explicit test or smoke command.
- Checklist entry checked after evidence exists.
- PR description links completed checklist scope.

## 7) Guardrails for Quality

- Prefer simple, intention-revealing code over clever abstractions.
- Use small methods with clear names and guard clauses.
- Keep state transitions explicit and testable.
- Add tests that verify behavior, not implementation detail.
- Avoid hidden responsibilities and unnecessary complexity.

If code is hard to explain, refactor before merging.
