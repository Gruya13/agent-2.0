/**
 * Exit-code rules for commands whose default is historical `0`.
 *
 * The CLI contract says `run` returns `0` even when individual actions fail;
 * `--strict` opts into the honest code. Keeping the rule here makes it unit-
 * testable without booting the CLI.
 */

/** 1 when any action failed, else 0. Callers apply it only under `--strict`. */
export function strictExit(actions) {
  return actions.some((action) => action.ok === false) ? 1 : 0;
}
