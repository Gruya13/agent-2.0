---
id: TASK-101
title: Nula se gubi u parseRange
status: consolidated
created: 2026-10-15T08:19:32.234Z
updated: 2026-10-15T08:23:11.779Z
kind: code
source: null
audit_scope: []
code_target: /home/gru/k9-target-3
code_base: 5157b69796aa2f2630c20f943e4eb44fbeff8138
code_scope:
  - src/**
  - tests/**
code_test: npm test
code_repro: bash /home/gru/k9-repro.sh
code_evidence:
  reproduce:
    command: bash /home/gru/k9-repro.sh
    exitCode: 1
    base: 5157b69796aa2f2630c20f943e4eb44fbeff8138
    at: 2026-10-15T08:19:32.372Z
  implement:
    harness: dsh
    exitCode: 0
    at: 2026-10-15T08:20:35.309Z
    files:
      - src/range.js
      - tests/range-zero.test.js
    outside: []
    commit: fe027df7d11b50c5d1e310eb8dd9d3fa5d6d7293
    author: dsh
  check:
    command: npm test
    exitCode: 0
    reproCommand: bash /home/gru/k9-repro.sh
    reproExitCode: 0
    at: 2026-10-15T08:20:35.606Z
  baseline:
    exitCode: 1
    files:
      - tests/range-zero.test.js
    command: npm test
    at: 2026-10-15T08:20:35.857Z
    stdout: |-
      > test
      > node --test tests/
      ✖ nula je validna donja granica opsega (2.32075ms)
      ✖ nula je validna gornja granica opsega (0.40431ms)
      ✖ nula kao pojedinačan broj (4.432255ms)
      ✖ opseg 0-0 (0.281459ms)
      ✖ neispravan ili prazan ulaz se odbija (0.326786ms)
      ✔ opseg (1.32314ms)
      ✔ pojedinačan broj (0.260717ms)
      ℹ tests 7
      ℹ suites 0
      ℹ pass 2
      ℹ fail 5
      ℹ cancelled 0
      ℹ skipped 0
      ℹ todo 0
      ℹ duration_ms 82.993983
      ✖ failing tests:
      test at tests/range-zero.test.js:5:1
      ✖ nula je validna donja granica opsega (2.32075ms)
      AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
      + actual - expected
      {
      +   from: null,
      -   from: 0,
      to: 3
      }
      at TestContext.<anonymous> (file:///tmp/agent2-code-TASK-101-baza-1792052435610-1ry53/tests/range-zero.test.js:6:10)
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
      test at tests/range-zero.test.js:9:1
      ✖ nula je validna gornja granica opsega (0.40431ms)
      AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
      + actual - expected
      {
      from: 3,
      +   to: null
      -   to: 0
      }
      at TestContext.
    stderr: ""
  review:
    harness: agy
    verdict: pass
    exitCode: 0
    file: tasks/reviews/TASK-101-review.md
    at: 2026-10-15T08:23:11.694Z
  accept:
    merge: b096aa73070e90267de43e2328eacbc7cc4390a4
    branch: agent/code/TASK-101
    at: 2026-10-15T08:23:11.775Z
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
  - at: 2026-10-15T08:19:32.234Z
    status: proposed
    actor: operator
  - at: 2026-10-15T08:19:32.239Z
    status: ready
    actor: agentctl
    note: coding zadatak (osnova 5157b697)
  - at: 2026-10-15T08:19:32.307Z
    status: in_progress
    actor: agentctl
  - at: 2026-10-15T08:19:32.373Z
    status: in_progress
    actor: agentctl
    note: reprodukcija problema
  - at: 2026-10-15T08:20:35.863Z
    status: in_progress
    actor: agentctl
    note: popravka + testovi + dokaz pada na osnovi
  - at: 2026-10-15T08:20:35.866Z
    status: in_progress
    actor: agentctl
    note: "izmene: src/range.js, tests/range-zero.test.js"
  - at: 2026-10-15T08:20:35.869Z
    status: verified
    actor: agentctl
    note: popravka fe027df7
  - at: 2026-10-15T08:20:35.924Z
    status: in_progress
    actor: agentctl
  - at: 2026-10-15T08:23:11.695Z
    status: in_progress
    actor: agentctl
    note: nezavisan pregled (agy)
  - at: 2026-10-15T08:23:11.696Z
    status: verified
    actor: agentctl
    note: "nezavisan pregled: pass"
  - at: 2026-10-15T08:23:11.748Z
    status: in_progress
    actor: agentctl
  - at: 2026-10-15T08:23:11.776Z
    status: in_progress
    actor: agentctl
    note: "prihvaćeno: b096aa73"
  - at: 2026-10-15T08:23:11.779Z
    status: consolidated
    actor: agentctl
    note: merge b096aa73
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
