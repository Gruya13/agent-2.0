---
id: TASK-101
title: Nula se gubi u parseRange
status: consolidated
created: 2026-10-15T19:28:24.146Z
updated: 2026-10-15T19:30:58.590Z
kind: code
source: null
audit_scope: []
code_target: /home/gru/k10-target
code_base: 2a53c54d54a6d77a4418775a30bb34e7bfefa09b
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
    base: 2a53c54d54a6d77a4418775a30bb34e7bfefa09b
    at: 2026-10-15T19:28:24.299Z
  memory:
    notes:
      - wiki/Konvencije/Kod.md
    file: .agent-context/MEMORY.md
    bytes: 502
  implement:
    harness: dsh
    exitCode: 0
    at: 2026-10-15T19:30:21.444Z
    files:
      - src/range.js
      - tests/granice.test.js
    outside: []
    commit: c9a3ed8c53fd46d84680a6bb53c07f48c4352a7c
    author: dsh
  check:
    command: npm test
    exitCode: 0
    reproCommand: bash /home/gru/k9-repro.sh
    reproExitCode: 0
    at: 2026-10-15T19:30:21.727Z
  baseline:
    exitCode: 1
    files:
      - tests/granice.test.js
    command: npm test
    at: 2026-10-15T19:30:21.962Z
    stdout: |-
      > test
      > node --test tests/
      ✖ granica: nula kao donja granica opsega (2.118207ms)
      ✖ granica: nula kao pojedinačan broj (0.296824ms)
      ✖ granica: nula sa obe strane opsega (0.401236ms)
      ✖ granica: nula kao gornja granica opsega (0.217485ms)
      ✖ granica: prazan ulaz se odbija (0.261485ms)
      ✖ granica: neispravan ulaz se odbija (0.192272ms)
      ✔ opseg (1.277392ms)
      ✔ pojedinačan broj (0.148482ms)
      ℹ tests 8
      ℹ suites 0
      ℹ pass 2
      ℹ fail 6
      ℹ cancelled 0
      ℹ skipped 0
      ℹ todo 0
      ℹ duration_ms 73.43333
      ✖ failing tests:
      test at tests/granice.test.js:8:1
      ✖ granica: nula kao donja granica opsega (2.118207ms)
      AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
      + actual - expected
      {
      +   from: null,
      -   from: 0,
      to: 3
      }
      at TestContext.<anonymous> (file:///tmp/agent2-code-TASK-101-baza-1792092621731-w3a9z/tests/granice.test.js:9:10)
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
      test at tests/granice.test.js:12:1
      ✖ granica: nula kao pojedinačan broj (0.296824ms)
      AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
      + actual - expected
    stderr: ""
    failure_kind: assertion
  review:
    harness: codex
    verdict: pass
    exitCode: 0
    file: tasks/reviews/TASK-101-review.md
    sha: c9a3ed8c53fd46d84680a6bb53c07f48c4352a7c
    base: 2a53c54d54a6d77a4418775a30bb34e7bfefa09b
    at: 2026-10-15T19:30:58.203Z
  integration:
    ok: true
    reason: null
    exitCode: 0
    command: npm test
    stdout: |-
      > test
      > node --test tests/
      ✔ granica: nula kao donja granica opsega (1.297157ms)
      ✔ granica: nula kao pojedinačan broj (0.151135ms)
      ✔ granica: nula sa obe strane opsega (0.124457ms)
      ✔ granica: nula kao gornja granica opsega (0.289212ms)
      ✔ granica: prazan ulaz se odbija (0.164196ms)
      ✔ granica: neispravan ulaz se odbija (0.114329ms)
      ✔ opseg (1.288916ms)
      ✔ pojedinačan broj (0.18005ms)
      ℹ tests 8
      ℹ suites 0
      ℹ pass 8
      ℹ fail 0
      ℹ cancelled 0
      ℹ skipped 0
      ℹ todo 0
      ℹ duration_ms 74.583538
    tree: 9b07ad56f2b1f4db7c1cecb7ff638ed2d3dc3e8f
    at: 2026-10-15T19:30:58.515Z
    base_stale: false
    base_was: 2a53c54d54a6d77a4418775a30bb34e7bfefa09b
    base_now: 2a53c54d54a6d77a4418775a30bb34e7bfefa09b
  accept:
    merge: b8495e2a4c1c40b54e6b5f96a6f93df60980ab51
    branch: agent/code/TASK-101
    reviewed: c9a3ed8c53fd46d84680a6bb53c07f48c4352a7c
    tag: dokaz/TASK-101-accept
    tree: 9b07ad56f2b1f4db7c1cecb7ff638ed2d3dc3e8f
    integration_tree: 9b07ad56f2b1f4db7c1cecb7ff638ed2d3dc3e8f
    at: 2026-10-15T19:30:58.559Z
  memory_write: wiki/Izmene/TASK-101.md
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
  - tests/granice.test.js
verification: null
challenge: null
blocked_reason: null
history:
  - at: 2026-10-15T19:28:24.146Z
    status: proposed
    actor: operator
  - at: 2026-10-15T19:28:24.152Z
    status: ready
    actor: agentctl
    note: coding zadatak (osnova 2a53c54d)
  - at: 2026-10-15T19:28:24.233Z
    status: in_progress
    actor: agentctl
  - at: 2026-10-15T19:28:24.300Z
    status: in_progress
    actor: agentctl
    note: reprodukcija problema
  - at: 2026-10-15T19:28:24.304Z
    status: in_progress
    actor: agentctl
    note: "memorija: wiki/Konvencije/Kod.md"
  - at: 2026-10-15T19:30:21.968Z
    status: in_progress
    actor: agentctl
    note: popravka + testovi + dokaz pada na osnovi
  - at: 2026-10-15T19:30:21.970Z
    status: in_progress
    actor: agentctl
    note: "izmene: src/range.js, tests/granice.test.js"
  - at: 2026-10-15T19:30:21.973Z
    status: verified
    actor: agentctl
    note: popravka c9a3ed8c
  - at: 2026-10-15T19:30:22.031Z
    status: in_progress
    actor: agentctl
  - at: 2026-10-15T19:30:58.204Z
    status: in_progress
    actor: agentctl
    note: nezavisan pregled (codex)
  - at: 2026-10-15T19:30:58.206Z
    status: verified
    actor: agentctl
    note: "nezavisan pregled: pass"
  - at: 2026-10-15T19:30:58.257Z
    status: in_progress
    actor: agentctl
  - at: 2026-10-15T19:30:58.587Z
    status: in_progress
    actor: agentctl
    note: "prihvaćeno: b8495e2a"
  - at: 2026-10-15T19:30:58.590Z
    status: consolidated
    actor: agentctl
    note: merge b8495e2a
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
