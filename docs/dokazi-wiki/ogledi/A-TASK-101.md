---
id: TASK-101
title: Nula se gubi u parseRange
status: consolidated
created: 2026-10-16T06:39:02.788Z
updated: 2026-10-16T06:40:23.680Z
kind: code
source: null
audit_scope: []
code_target: /home/gru/k11-target
code_base: 58522ff146ec801d675e2c024859042c77ea10f5
code_scope:
  - src/**
  - tests/**
code_test: npm test
code_repro: bash /home/gru/k9-repro.sh
code_memory:
  - wiki/Konvencije/Kod.md
code_evidence:
  reproduce:
    command: bash /home/gru/k9-repro.sh
    exitCode: 1
    base: 58522ff146ec801d675e2c024859042c77ea10f5
    at: 2026-10-16T06:39:02.916Z
  memory:
    notes:
      - wiki/Konvencije/Kod.md
    file: .agent-context/MEMORY.md
    bytes: 495
  check:
    command: npm test
    exitCode: 0
    reproCommand: bash /home/gru/k9-repro.sh
    reproExitCode: 0
    at: 2026-10-16T06:39:39.731Z
  baseline:
    exitCode: 1
    files:
      - tests/range-zero.test.js
    command: npm test
    at: 2026-10-16T06:39:39.966Z
    stdout: |-
      > test
      > node --test tests/
      ✖ nula kao donja granica opsega (2.087614ms)
      ✖ nula kao gornja granica opsega (0.305973ms)
      ✖ nula kao pojedinačna vrednost (4.24081ms)
      ✖ nula u obe granice opsega (0.494055ms)
      ✖ neispravan ili prazan ulaz se odbija (null) (0.416322ms)
      ✔ opseg (1.217746ms)
      ✔ pojedinačan broj (0.148901ms)
      ℹ tests 7
      ℹ suites 0
      ℹ pass 2
      ℹ fail 5
      ℹ cancelled 0
      ℹ skipped 0
      ℹ todo 0
      ℹ duration_ms 76.201102
      ✖ failing tests:
      test at tests/range-zero.test.js:6:1
      ✖ nula kao donja granica opsega (2.087614ms)
      AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
      + actual - expected
      {
      +   from: null,
      -   from: 0,
      to: 3
      }
      at TestContext.<anonymous> (file:///tmp/agent2-code-TASK-101-baza-1792132779735-e71mb/tests/range-zero.test.js:7:10)
      at Test.runInAsyncScope (node:async_hooks:226:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at Test.start (node:internal/test_runner/test:1262:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17) {
      generatedMessage: true,
      code: 'ERR_ASSERTION',
      actual: { from: null, to: 3 },
      expected: { from: 0, to: 3 },
      operator: 'deepStrictEqual',
      diff: 'simple'
      }
      test at tests/range-zero.test.js:10:1
      ✖ nula kao gornja granica opsega (0.305973ms)
      AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
      + actual - expected
      {
      from: 1,
      +   to: null
      -   to: 0
      }
      at TestCont
    stderr: ""
    failure_kind: assertion
  implement:
    harness: dsh
    exitCode: 0
    at: 2026-10-16T06:39:39.446Z
    files:
      - src/range.js
      - tests/range-zero.test.js
    outside: []
    commit: 428a7ec600c8d82311d233f5e2f0827dd7651d84
    author: dsh
  review:
    harness: codex
    verdict: pass
    exitCode: 0
    file: tasks/reviews/TASK-101-review.md
    sha: 428a7ec600c8d82311d233f5e2f0827dd7651d84
    base: 58522ff146ec801d675e2c024859042c77ea10f5
    at: 2026-10-16T06:40:23.296Z
  integration:
    ok: true
    reason: null
    exitCode: 0
    command: npm test
    stdout: |-
      > test
      > node --test tests/
      ✔ nula kao donja granica opsega (1.293384ms)
      ✔ nula kao gornja granica opsega (0.157491ms)
      ✔ nula kao pojedinačna vrednost (0.121524ms)
      ✔ nula u obe granice opsega (3.917027ms)
      ✔ neispravan ili prazan ulaz se odbija (null) (0.234944ms)
      ✔ opseg (1.222984ms)
      ✔ pojedinačan broj (0.137516ms)
      ℹ tests 7
      ℹ suites 0
      ℹ pass 7
      ℹ fail 0
      ℹ cancelled 0
      ℹ skipped 0
      ℹ todo 0
      ℹ duration_ms 75.638883
    tree: 9d0b6ba6e73cd9727a7692d7c0f1b762badde9df
    at: 2026-10-16T06:40:23.610Z
    base_stale: false
    base_was: 58522ff146ec801d675e2c024859042c77ea10f5
    base_now: 58522ff146ec801d675e2c024859042c77ea10f5
  accept:
    merge: 3c7cf7cdd52da9367ef97cbee77013d5f5bfb546
    branch: agent/code/TASK-101
    reviewed: 428a7ec600c8d82311d233f5e2f0827dd7651d84
    tag: dokaz/TASK-101-accept
    tree: 9d0b6ba6e73cd9727a7692d7c0f1b762badde9df
    integration_tree: 9d0b6ba6e73cd9727a7692d7c0f1b762badde9df
    at: 2026-10-16T06:40:23.650Z
  memory_write: wiki/Izmene/TASK-101.md
  memory_write_error: null
extract_required: false
extracted: true
priority: normal
tags: []
depends_on: []
authors: []
assignee: agentctl
lock_owner: null
locked_at: null
lease_expires_at: null
artifacts:
  - src/range.js
  - tests/range-zero.test.js
verification: null
challenge: null
blocked_reason: null
history:
  - at: 2026-10-16T06:39:02.788Z
    status: proposed
    actor: operator
  - at: 2026-10-16T06:39:02.795Z
    status: ready
    actor: agentctl
    note: coding zadatak (osnova 58522ff1)
  - at: 2026-10-16T06:39:02.857Z
    status: in_progress
    actor: agentctl
  - at: 2026-10-16T06:39:02.917Z
    status: in_progress
    actor: agentctl
    note: reprodukcija problema
  - at: 2026-10-16T06:39:02.921Z
    status: in_progress
    actor: agentctl
    note: "memorija: wiki/Konvencije/Kod.md"
  - at: 2026-10-16T06:39:39.972Z
    status: in_progress
    actor: agentctl
    note: popravka + testovi + dokaz pada na osnovi
  - at: 2026-10-16T06:39:39.975Z
    status: in_progress
    actor: agentctl
    note: "izmene: src/range.js, tests/range-zero.test.js"
  - at: 2026-10-16T06:39:39.978Z
    status: verified
    actor: agentctl
    note: popravka 428a7ec6
  - at: 2026-10-16T06:39:40.050Z
    status: in_progress
    actor: agentctl
  - at: 2026-10-16T06:40:23.297Z
    status: in_progress
    actor: agentctl
    note: nezavisan pregled (codex)
  - at: 2026-10-16T06:40:23.299Z
    status: verified
    actor: agentctl
    note: "nezavisan pregled: pass"
  - at: 2026-10-16T06:40:23.352Z
    status: in_progress
    actor: agentctl
  - at: 2026-10-16T06:40:23.678Z
    status: in_progress
    actor: agentctl
    note: "prihvaćeno: 3c7cf7cd"
  - at: 2026-10-16T06:40:23.680Z
    status: consolidated
    actor: agentctl
    note: merge 3c7cf7cd
lock_token: null
---

# Nula se gubi u parseRange

## Zahtev

# Zamrznut zahtev (pre izvršavanja, bez gotovog rešenja)

Funkcija `parseRange` u `src/range.js` mora da prihvati **nulu** kao granicu:

- `parseRange('0-3')` → `{ from: 0, to: 3 }`
- `parseRange('0')` → `{ from: 0, to: 0 }`

Trenutno se nula gubi. Neispravan ili prazan ulaz se i dalje odbija (vraća
`null`), kao i do sada.

Zahtev opisuje **ponašanje**, ne rešenje. Regresioni test treba da dokaže da je
nula validna granica; postojeći testovi moraju ostati netaknuti i da prolaze.

Okruženje: Node, bez dodatnih zavisnosti. Provera: `npm test`.
Reprodukcija: kratka komanda koja pada dok je bug prisutan (vidi `REPRO` u
zadatku).

## Nalazi

_Prazno do prvog nalaza._
