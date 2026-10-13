/**
 * Kontrolni sloj (Control Shell) — pet faza iz arhitekture:
 *
 *   1. ingest      raw izvor + zadatak u tasks/inbox/
 *   2. research    izolovano worktree + agy/Gemini -> wiki/drafts/, status review
 *   3. verify      dsh/DeepSeek -> tasks/reviews/ + verdikt, status verified
 *   4. consolidate codex -> wiki/ produkcija + Index.md, sekvencijalni merge u main
 *   5. reflect     indeks i revizorski trag; stanje vidljivo u Obsidian grafu
 *
 * Petlja je oportunistička: prvo dovršava započeto (konsolidacija, pa
 * verifikacija), a tek onda otvara novi posao. Time se izbegava da sistem
 * nagomila nacrte koje niko ne stigne da verifikuje.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { loadConfig } from './config.mjs';
import { createStore } from './store.mjs';
import { exists, sha256File } from './fsx.mjs';
import { commitPaths, log as gitLog } from './git.mjs';
import {
  changedFilesInWorktree, createWorktree, deleteBranch, ensureMainBranch, mergeIntoMain,
  removeWorktree, removeWorktreesForTask, worktreePath, MAIN_BRANCH,
} from './worktree.mjs';
import { buildPrompt, identityFor, parseVerdict, runAgent } from './agents/index.mjs';
import { lintRawImmutability, lintVault, updateRawManifest } from './lint.mjs';
import { matchesScope } from './scope.mjs';
import { listNotes, normalizeConsolidatedNote, readNote, renderIndex } from './vault.mjs';
import { defaultBody, newTaskData, nextTaskId, writeTaskFile } from './task.mjs';

export class PipelineError extends Error {
  constructor(message, code = 'PIPELINE_ERROR') {
    super(message);
    this.name = 'PipelineError';
    this.code = code;
  }
}

const ROLE_OF_PHASE = {
  extract: 'extractor',
  audit: 'librarian',
  research: 'researcher',
  verify: 'verifier',
  consolidate: 'consolidator',
};

export function createPipeline(config, options = {}) {
  const clock = options.clock ?? (() => new Date());
  const logger = options.logger ?? (() => {});
  const store = options.store ?? createStore(config, { clock });
  const maxRevisions = options.maxRevisions ?? config.pipeline.maxRevisions ?? 3;
  /**
   * Zakup je vezan za PROCES, ne samo za ime vendora: svaki `claim` dobija token
   * koji se pamti ovde i predaje dalje uz `release`. Bez toga bi dva procesa
   * istog harnesa držala „isti" zakup.
   */
  const leaseTokens = new Map();

  const now = () => clock().toISOString();

  /**
   * Knjigovodstvo kontrolnog sloja: komituju se isključivo zone crne table.
   * Izmene u kodu ili tuđim zonama se ne diraju.
   *
   * `raw/` je tu zbog novih izvora: ako izvor uđe u manifest a ne u Git, svako
   * sveže radno stablo (uključujući verifikatorovo) prijavljuje `raw.deleted`, a
   * citati iz nacrta postaju neproverljivi. Zato se novi izvori komituju zajedno
   * sa manifestom — ALI samo ako manifest ne prijavljuje prekršaj: izmenjen ili
   * obrisan izvor se nikad ne komituje, da se prekršaj ne bi sakrio u istoriji.
   */
  const BOOKKEEPING_PATHS = ['tasks', 'wiki', '.agents/raw-manifest.json', 'raw'];

  async function commitBookkeeping(message, actor = 'agentctl') {
    let paths = BOOKKEEPING_PATHS;
    const rawProblems = (await lintRawImmutability(config))
      .filter((f) => f.level === 'error' && ['raw.modified', 'raw.deleted', 'raw.legacy-unknown', 'raw.no-manifest', 'raw.symlink'].includes(f.code));
    if (rawProblems.length) {
      paths = BOOKKEEPING_PATHS.filter((p) => p !== 'raw');
      await store.emit('raw.violation', {
        task: null,
        actor,
        findings: rawProblems.map((f) => ({ code: f.code, target: f.target, message: f.message })),
        note: 'raw/ nije komitovan; prekršaj mora da reši čovek',
      });
      logger(`raw/ nije komitovan: ${rawProblems.map((f) => f.code).join(', ')}`);
    }
    return commitPaths(config.root, paths, message, { actor });
  }

  /**
   * Faza 1 — unos: registruj izvor (append-only manifest) i otvori zadatak.
   */
  async function ingest({ source, title = null, request = '', tags = [], dependsOn = [], priority = 'normal', extract = null } = {}) {
    if (!source) throw new PipelineError('izvor je obavezan', 'BAD_INPUT');
    const rel = source.split(path.sep).join('/');
    const abs = path.resolve(config.root, rel);
    if (!abs.startsWith(config.paths.sources + path.sep)) {
      throw new PipelineError(`izvor mora biti u ${config.vault.sources}/ (dobijeno: ${source})`, 'BAD_SOURCE');
    }
    if (!(await exists(abs))) throw new PipelineError(`izvor ne postoji: ${rel}`, 'NO_SOURCE');

    const manifest = await updateRawManifest(config);
    const id = await nextTaskId(config);
    const resolvedTitle = title ?? path.basename(rel, path.extname(rel));
    // Ekstrakcija je obavezna za sve što nije goli tekst: PDF, slike, skenovi,
    // tabele. Za tekstualne izvore bi bila čist gubitak vremena.
    const extractRequired = extract ?? !/\.(md|markdown|txt)$/i.test(rel);
    const { data, body } = newTaskData({
      id,
      title: resolvedTitle,
      source: rel,
      tags,
      dependsOn,
      priority,
      extractRequired,
      now: now(),
      body: defaultBody(resolvedTitle, request),
    });

    const file = path.join(config.inbox, `${id}.md`);
    await writeTaskFile(file, data, body);
    await store.emit('task.ingested', { task: id, source: rel, actor: 'operator' });

    const readiness = await evaluateReadiness(id);
    if (readiness.ready) {
      await store.transition(id, 'ready', { actor: 'agentctl', note: 'zavisnosti zadovoljene' });
    }
    await store.setAuthors(id, ['researcher'], { actor: 'agentctl' });
    await commitBookkeeping(`agentctl: unos zadatka ${id} (${rel})`);
    logger(`ingest: ${id} <- ${rel} (manifest: +${manifest.added})`);
    return store.get(id);
  }

  /**
   * Revizorski zadatak: nema izvora, ima **opseg**. Nastaje kada treba održati
   * postojeću bazu (duplikati, siročići, oznake, kontradikcije), a ne uneti nov
   * sadržaj.
   */
  async function audit({ title = null, scope, request = '', tags = [] } = {}) {
    if (!Array.isArray(scope) || scope.length === 0) {
      throw new PipelineError('revizorski zadatak zahteva opseg (npr. "wiki/*.md")', 'NO_SCOPE');
    }
    const id = await nextTaskId(config);
    const naslov = title ?? `Revizija baze ${id}`;
    const { data, body } = newTaskData({
      id,
      title: naslov,
      kind: 'audit',
      auditScope: scope,
      extractRequired: false,
      tags,
      now: now(),
      body: defaultBody(naslov, request || `Opseg revizije: ${scope.join(', ')}`),
    });
    await writeTaskFile(path.join(config.inbox, `${id}.md`), data, body);
    await store.emit('task.audit', { task: id, scope, actor: 'operator' });
    await store.transition(id, 'ready', { actor: 'agentctl', note: `opseg: ${scope.join(', ')}` });
    await commitBookkeeping(`agentctl: revizorski zadatak ${id} (${scope.join(', ')})`);
    logger(`audit: ${id} (${scope.join(', ')})`);
    return store.get(id);
  }

  /** Zavisnosti: sve iz `depends_on` moraju biti `consolidated`. */
  async function evaluateReadiness(id) {
    const task = await store.get(id);
    const deps = task.data.depends_on ?? [];
    const blocking = [];
    for (const dep of deps) {
      const other = await store.tryGet(dep);
      if (!other) blocking.push({ dep, reason: 'ne postoji' });
      else if (other.data.status !== 'consolidated') blocking.push({ dep, reason: other.data.status });
    }
    return { ready: blocking.length === 0, blocking };
  }

  /**
   * Svaki POKUŠAJ faze počinje od svežeg radnog stabla na aktuelnom `main`.
   *
   * Ponovni pokušaj nad zaleđenim radnim stablom nosi i zaleđene izvore: nacrt
   * odbijen u prvom prolazu vraća zadatak u `ready`, a izvor je u međuvremenu
   * mogao biti dopunjen ili komitovan. Bez ovoga bi istraživač radio nad starim
   * `raw/`, a verifikator bi ga s pravom odbio — isti nalaz iznova.
   */
  async function resetWorktree(id, role, branch) {
    await removeWorktree(config, id, { role });
    if (branch) await deleteBranch(config, branch);
  }

  /** Pripremi worktree za fazu; vrati putanju i granu. */
  async function prepareWorktree({ id, role, base = MAIN_BRANCH, fresh = false, branch = null }) {
    await ensureMainBranch(config);
    if (fresh) await resetWorktree(id, role, branch);
    const worktree = await createWorktree(config, { id, role, base });
    const freshConfig = await loadConfig(worktree.path);
    return { ...worktree, config: freshConfig };
  }

  /** Zajednički epilog neuspeha: oslobodi zakup, skloni radno stablo, zabeleži. */
  async function failPhase(id, role, { reason, toStatus = 'ready' }) {
    const owner = identityFor(config, role);
    const task = await store.tryGet(id);
    if (task && task.data.lock_owner === owner) {
      try {
        await store.release(id, owner, { toStatus, token: leaseTokens.get(id), note: `neuspeh: ${reason}` });
      } catch (error) {
        logger(`release nije uspeo za ${id}: ${error.message}`);
      }
    }
    await removeWorktree(config, id, { role });
    await store.emit('phase.failed', { task: id, role, reason });
    await commitBookkeeping(`agentctl: ${id} -> ${toStatus} (neuspeh faze ${role})`);
  }

  // ------------------------------------------------------------- faza 2

  async function runResearch(id) {
    const task = await store.get(id);
    if (task.data.status !== 'ready') {
      throw new PipelineError(`${id} nije u stanju ready (${task.data.status})`, 'NOT_READY');
    }
    if ((task.data.kind ?? 'ingest') !== 'ingest') {
      throw new PipelineError(`${id}: istraživanje se radi samo nad izvornim zadacima`, 'NOT_INGEST');
    }
    if (task.data.extract_required && !task.data.extracted) {
      throw new PipelineError(`${id}: izvor čeka fazu extract`, 'AWAIT_EXTRACT');
    }
    const readiness = await evaluateReadiness(id);
    if (!readiness.ready) {
      throw new PipelineError(`${id}: nezadovoljene zavisnosti ${JSON.stringify(readiness.blocking)}`, 'DEPS');
    }

    const role = ROLE_OF_PHASE.research;
    const owner = identityFor(config, role);
    const claimResult = await store.claim(id, owner);
    leaseTokens.set(id, claimResult.leaseToken);
    const claimed = { ...(await store.get(id)), leaseToken: claimResult.leaseToken };
    // Nacrt se gradi nad fragmentima ekstraktora, ako ih ima.
    const researchBase = task.data.extract_required ? `agent/${ROLE_OF_PHASE.extract}/${id}` : MAIN_BRANCH;
    const { path: wt, branch, config: wtConfig } = await prepareWorktree({
      id, role, base: researchBase, fresh: true, branch: `agent/${role}/${id}`,
    });
    await store.emit('phase.start', { task: id, phase: 'research', role, worktree: wt, branch });

    const prompt = await buildPrompt(config, {
      role,
      task: claimed,
      extra: { worktree: wt, instructions: `Izvor: ${claimed.data.source}. Nacrt ide u ${config.vault.drafts}/.` },
    });

    let result;
    try {
      result = await runAgent(config, { role, task: claimed, cwd: wt, prompt, now: now(), logger });
    } catch (error) {
      await failPhase(id, role, { reason: `harnes je bacio grešku: ${error.message}` });
      throw error;
    }

    const produced = await detectArtifacts(wtConfig, { role, before: [] });
    if (!result.ok || produced.length === 0) {
      await store.updateBody(id, {
        actor: owner,
        append: `### Neuspešna faza research (${now()})\n\n\`\`\`\n${result.output.slice(0, 2000)}\n\`\`\``,
        note: 'neuspešna faza research',
      });
      await failPhase(id, role, { reason: result.timedOut ? 'isteklo vreme harnesa' : `nema artefakta (exit ${result.exitCode})` });
      return { phase: 'research', task: id, ok: false, reason: 'nema artefakta', output: result.output };
    }

    const commit = await commitWorktreeSafe(config, id, role, `researcher(${id}): nacrt iz ${claimed.data.source}`, owner);
    await store.attachArtifacts(id, produced, { actor: owner, note: `nacrt: ${produced.join(', ')}` });
    await store.updateBody(id, {
      actor: owner,
      append: [
        `### Faza research (${now()})`,
        '',
        `- harnes: ${result.harness}`,
        `- trajanje: ${result.durationMs} ms`,
        `- grana: ${branch} @ ${commit.sha ?? '(bez komita)'}`,
        '',
        '```',
        result.output.slice(0, 4000),
        '```',
      ].join('\n'),
      note: 'faza research završena',
    });
    await store.release(id, owner, { toStatus: 'review', token: leaseTokens.get(id), note: `nacrt spreman: ${produced.join(', ')}` });
    await commitBookkeeping(`agentctl: ${id} -> review (nacrt: ${produced.join(', ')})`);
    await store.emit('phase.done', { task: id, phase: 'research', role, artifacts: produced, commit: commit.sha });
    logger(`research: ${id} -> ${produced.join(', ')} (${result.harness})`);
    return { phase: 'research', task: id, ok: true, artifacts: produced, commit: commit.sha, branch };
  }

  // ------------------------------------------------------------- faza 1b

  /**
   * Faza `audit`: održavanje postojeće baze (`librarian`).
   *
   * Kontrolni sloj ovde ima drugu, važniju dužnost od MCP-a: agent koji radi
   * fajl-sistemom može da zaobiđe MCP zonu, pa se **svaka** izmena proverava
   * prema opsegu zadatka pre nego što uđe u granu. Izmena van opsega obara fazu.
   */
  async function runAudit(id) {
    const task = await store.get(id);
    if ((task.data.kind ?? 'ingest') !== 'audit') {
      throw new PipelineError(`${id} nije revizorski zadatak`, 'NOT_AUDIT');
    }
    if (task.data.status !== 'ready') {
      throw new PipelineError(`${id} nije u stanju ready (${task.data.status})`, 'NOT_READY');
    }
    const scope = task.data.audit_scope ?? [];
    const role = ROLE_OF_PHASE.audit;
    const owner = identityFor(config, role);
    const claimResult = await store.claim(id, owner);
    leaseTokens.set(id, claimResult.leaseToken);
    const claimed = { ...(await store.get(id)), leaseToken: claimResult.leaseToken };
    const { path: wt, branch, config: wtConfig } = await prepareWorktree({
      id, role, fresh: true, branch: `agent/${role}/${id}`,
    });
    await store.emit('phase.start', { task: id, phase: 'audit', role, worktree: wt, branch, scope });

    const prompt = await buildPrompt(config, {
      role,
      task: claimed,
      extra: {
        worktree: wt,
        instructions: [
          `Opseg revizije: ${scope.join(', ')}`,
          `Izveštaj piši u ${config.vault.tasks}/audits/${id}.md.`,
          'Menjaj samo postojeće beleške iz opsega; ne kreiraj nove članke.',
        ].join('\n'),
      },
    });

    let result;
    try {
      result = await runAgent(config, { role, task: claimed, cwd: wt, prompt, now: now(), logger });
    } catch (error) {
      await failPhase(id, role, { reason: `harnes je bacio grešku: ${error.message}` });
      throw error;
    }

    const izvestaj = `tasks/audits/${id}.md`;
    const changed = await changedFilesInWorktree(wt, MAIN_BRANCH);
    const vanOpsega = changed.filter((rel) => rel !== izvestaj && !matchesScope(rel, scope));
    if (vanOpsega.length) {
      await store.updateBody(id, {
        actor: owner,
        append: `### Revizija odbijena (${now()})\n\nIzmene van opsega \`${scope.join(', ')}\`:\n\n${vanOpsega.map((r) => `- ${r}`).join('\n')}`,
        note: 'izmene van opsega revizije',
      });
      await failPhase(id, role, { reason: `izmene van opsega: ${vanOpsega.join(', ')}` });
      return { phase: 'audit', task: id, ok: false, reason: 'izmene van opsega', outside: vanOpsega };
    }
    const beleske = changed.filter((rel) => rel.startsWith('wiki/'));
    if (!result.ok || (!beleske.length && !changed.includes(izvestaj))) {
      await failPhase(id, role, { reason: `nema izveštaja ni izmena (exit ${result.exitCode})` });
      return { phase: 'audit', task: id, ok: false, reason: 'nema rezultata revizije' };
    }

    const commit = await commitWorktreeSafe(config, id, role, `librarian(${id}): revizija baze (${scope.join(', ')})`, owner);
    await store.attachArtifacts(id, changed, { actor: owner, note: `revizija: ${changed.length} fajlova` });
    await store.updateBody(id, {
      actor: owner,
      append: [
        `### Faza audit (${now()})`,
        '',
        `- harnes: ${result.harness}`,
        `- trajanje: ${result.durationMs} ms`,
        `- opseg: ${scope.join(', ')}`,
        `- izmenjenih belešaka: ${beleske.length}`,
        `- izveštaj: ${changed.includes(izvestaj) ? izvestaj : '(nije napisan)'}`,
        `- grana: ${branch} @ ${commit.sha ?? '(bez komita)'}`,
        '',
        '```',
        result.output.slice(0, 3000),
        '```',
      ].join('\n'),
      note: 'faza audit završena',
    });
    await store.release(id, owner, { toStatus: 'review', token: leaseTokens.get(id), note: `revizija predata: ${beleske.length} belešaka` });
    await commitBookkeeping(`agentctl: ${id} -> review (revizija baze)`);
    await store.emit('phase.done', { task: id, phase: 'audit', role, changed, commit: commit.sha, scope });
    logger(`audit: ${id} -> ${beleske.length} izmenjenih belešaka (${result.harness})`);
    return { phase: 'audit', task: id, ok: true, artifacts: changed, commit: commit.sha, scope };
  }

  // ------------------------------------------------------------- faza 2a

  /**
   * Faza `extract`: multimodalni unos pre istraživanja.
   *
   * Kontrolni sloj ne veruje transkriptu: pre nego što fragment uđe u lanac,
   * proverava da `source_sha256` u zaglavlju odgovara stvarnom izvoru u `raw/`.
   * Bez toga bi fragment mogao da tvrdi da potiče iz dokumenta koji nikad nije
   * pročitan.
   */
  async function runExtract(id) {
    const task = await store.get(id);
    if (task.data.status !== 'ready') {
      throw new PipelineError(`${id} nije u stanju ready (${task.data.status})`, 'NOT_READY');
    }
    if ((task.data.kind ?? 'ingest') !== 'ingest') {
      throw new PipelineError(`${id}: ekstrakcija se radi samo nad izvornim zadacima`, 'NOT_INGEST');
    }
    if (!task.data.extract_required) {
      throw new PipelineError(`${id}: izvor ne zahteva ekstrakciju`, 'NO_EXTRACT');
    }
    if (task.data.extracted) {
      throw new PipelineError(`${id}: izvor je već ekstraktovan`, 'ALREADY_EXTRACTED');
    }
    const role = ROLE_OF_PHASE.extract;
    const owner = identityFor(config, role);
    const claimResult = await store.claim(id, owner);
    leaseTokens.set(id, claimResult.leaseToken);
    const claimed = { ...(await store.get(id)), leaseToken: claimResult.leaseToken };
    const { path: wt, branch, config: wtConfig } = await prepareWorktree({
      id, role, fresh: true, branch: `agent/${role}/${id}`,
    });
    await store.emit('phase.start', { task: id, phase: 'extract', role, worktree: wt, branch });

    const prompt = await buildPrompt(config, {
      role,
      task: claimed,
      extra: {
        worktree: wt,
        instructions: `Izvor: ${claimed.data.source}. Fragmente piši u ${config.vault.drafts}/fragments/.`,
      },
    });

    let result;
    try {
      result = await runAgent(config, { role, task: claimed, cwd: wt, prompt, now: now(), logger });
    } catch (error) {
      await failPhase(id, role, { reason: `harnes je bacio grešku: ${error.message}` });
      throw error;
    }

    const produced = await detectArtifacts(wtConfig, { role });
    if (!result.ok || produced.length === 0) {
      await failPhase(id, role, { reason: result.timedOut ? 'isteklo vreme harnesa' : `nema fragmenata (exit ${result.exitCode})` });
      return { phase: 'extract', task: id, ok: false, reason: 'nema fragmenata' };
    }

    // Dokaz porekla: svaki fragment mora da nosi heš stvarnog izvora.
    const sourceFile = path.resolve(config.root, claimed.data.source);
    if (!(await exists(sourceFile))) {
      await failPhase(id, role, { reason: `izvor ${claimed.data.source} ne postoji u raw/` });
      return { phase: 'extract', task: id, ok: false, reason: 'nema izvora' };
    }
    const sourceSha = await sha256File(sourceFile);
    const badFragments = [];
    for (const rel of produced) {
      const fragment = await readNote(wt, rel);
      if (fragment.frontmatter?.source_sha256 !== sourceSha) {
        badFragments.push(`${rel} (${String(fragment.frontmatter?.source_sha256).slice(0, 12)}… ≠ ${sourceSha.slice(0, 12)}…)`);
      }
    }
    if (badFragments.length) {
      await failPhase(id, role, { reason: `fragmenti ne odgovaraju izvoru: ${badFragments.join(', ')}` });
      return { phase: 'extract', task: id, ok: false, reason: 'heš izvora se ne poklapa' };
    }

    const commit = await commitWorktreeSafe(config, id, role, `extractor(${id}): fragmenti iz ${claimed.data.source}`, owner);
    await store.attachArtifacts(id, produced, { actor: owner, note: `fragmenti: ${produced.join(', ')}` });
    await store.setFields(id, { extracted: true }, { actor: owner, note: `ekstrakcija: ${produced.length} fragmenata` });
    await store.updateBody(id, {
      actor: owner,
      append: [
        `### Faza extract (${now()})`,
        '',
        `- harnes: ${result.harness}`,
        `- trajanje: ${result.durationMs} ms`,
        `- fragmenti: ${produced.join(', ')}`,
        `- izvor: \`${claimed.data.source}\` sha256 \`${sourceSha}\``,
        `- grana: ${branch} @ ${commit.sha ?? '(bez komita)'}`,
        '',
        '```',
        result.output.slice(0, 2000),
        '```',
      ].join('\n'),
      note: 'faza extract završena',
    });
    await store.release(id, owner, { toStatus: 'ready', token: leaseTokens.get(id), note: `fragmenti spremni: ${produced.join(', ')}` });
    await commitBookkeeping(`agentctl: ${id} -> ready (fragmenti: ${produced.length})`);
    await store.emit('phase.done', { task: id, phase: 'extract', role, artifacts: produced, commit: commit.sha, sourceSha });
    logger(`extract: ${id} -> ${produced.length} fragment(a) (${result.harness})`);
    return { phase: 'extract', task: id, ok: true, artifacts: produced, commit: commit.sha };
  }

  // ------------------------------------------------------------- faza 3

  async function runVerify(id) {
    const task = await store.get(id);
    if (task.data.status !== 'review') {
      throw new PipelineError(`${id} nije u stanju review (${task.data.status})`, 'NOT_REVIEW');
    }
    const role = ROLE_OF_PHASE.verify;
    const owner = identityFor(config, role);
    // Revizorski zadatak dolazi iz `librarian` grane, izvorni iz `researcher`.
    const jeRevizija = (task.data.kind ?? 'ingest') === 'audit';
    const izvorna = jeRevizija
      ? `agent/${ROLE_OF_PHASE.audit}/${id}`
      : `agent/${ROLE_OF_PHASE.research}/${id}`;
    const claimResult = await store.claim(id, owner);
    leaseTokens.set(id, claimResult.leaseToken);
    const claimed = { ...(await store.get(id)), leaseToken: claimResult.leaseToken };
    const { path: wt, config: wtConfig } = await prepareWorktree({
      id, role, base: izvorna, fresh: true, branch: `agent/${role}/${id}`,
    });
    await store.emit('phase.start', { task: id, phase: 'verify', role, worktree: wt });

    const prompt = await buildPrompt(config, {
      role,
      task: claimed,
      extra: {
        worktree: wt,
        instructions: [
          jeRevizija
            ? `Ovo je REVIZIJA BAZE, ne nacrt. Opseg: ${(claimed.data.audit_scope ?? []).join(', ')}. Izveštaj revizije: ${config.vault.tasks}/audits/${id}.md. Izmenjene beleške: ${(claimed.data.artifacts ?? []).filter((r) => r.startsWith('wiki/')).join(', ') || '(nema)'}.`
            : `Nacrt: ${(claimed.data.artifacts ?? []).join(', ') || '(vidi wiki/drafts/)'}.`,
          jeRevizija
            ? 'Proveri da su izmene unutar opsega, da izveštaj navodi dokaz za svaku izmenu i da nijedan novi članak nije uveden.'
            : 'Proveri nacrt protiv izvora i postojećeg znanja.',
          `Revizorski trag ide u ${config.vault.tasks}/reviews/${id}.md.`,
          'Poslednja linija izlaza mora biti "VERDICT: pass" ili "VERDICT: fail".',
        ].join('\n'),
      },
    });

    let result;
    try {
      result = await runAgent(config, { role, task: claimed, cwd: wt, prompt, now: now(), logger });
    } catch (error) {
      await failPhase(id, role, { reason: `harnes je bacio grešku: ${error.message}`, toStatus: 'review' });
      throw error;
    }

    const verdict = result.verdict ?? inferVerdict(result);
    if (!result.ok || !verdict) {
      await failPhase(id, role, { reason: `nema verdikta (exit ${result.exitCode})`, toStatus: 'review' });
      await store.emit('phase.failed', { task: id, role, reason: 'nema verdikta' });
      return { phase: 'verify', task: id, ok: false, reason: 'nema verdikta', output: result.output };
    }

    const commit = await commitWorktreeSafe(config, id, role, `verifier(${id}): revizija -> ${verdict}`, owner);
    await store.setVerification(id, {
      verdict,
      harness: result.harness,
      at: now(),
      commit: commit.sha,
      summary: result.output.slice(-2000),
    }, { actor: owner });
    await store.updateBody(id, {
      actor: owner,
      append: [
        `### Faza verify (${now()})`,
        '',
        `- harnes: ${result.harness}`,
        `- trajanje: ${result.durationMs} ms`,
        `- verdikt: ${verdict}`,
        `- grana: ${izvorna} -> verifier @ ${commit.sha ?? '(bez komita)'}`,
        '',
        '```',
        result.output.slice(0, 4000),
        '```',
      ].join('\n'),
      note: `faza verify: ${verdict}`,
    });

    if (verdict === 'pass') {
      await store.release(id, owner, { toStatus: 'verified', token: leaseTokens.get(id), note: 'verifikator dao pečat' });
      await commitBookkeeping(`agentctl: ${id} -> verified (${result.harness})`);
      await store.emit('phase.done', { task: id, phase: 'verify', role, verdict });
      logger(`verify: ${id} -> pass`);
      return { phase: 'verify', task: id, ok: true, verdict, commit: commit.sha };
    }

    // Odbijen nacrt: broj pokušaja je ograničen da sistem ne uđe u beskonačnu petlju.
    const attempts = (await store.get(id)).data.history.filter((h) => h.status === 'review').length;
    if (attempts > maxRevisions) {
      await store.transition(id, 'blocked', {
        actor: 'agentctl',
        note: `nacrt je odbijen ${attempts} puta (dozvoljeno ${maxRevisions}); potrebna ljudska intervencija`,
      });
      await commitBookkeeping(`agentctl: ${id} -> blocked (previse revizija)`);
      await removeWorktree(config, id, { role });
      await store.emit('phase.failed', { task: id, role, reason: 'previse revizija' });
      return { phase: 'verify', task: id, ok: false, verdict: 'fail', blocked: true };
    }
    await store.release(id, owner, { toStatus: 'ready', token: leaseTokens.get(id), note: `odbijen nacrt (pokušaj ${attempts}); vraćeno istraživaču` });
    await commitBookkeeping(`agentctl: ${id} -> ready (nacrt odbijen, pokušaj ${attempts})`);
    await removeWorktree(config, id, { role });
    await store.emit('phase.rejected', { task: id, role, attempts });
    logger(`verify: ${id} -> fail (pokušaj ${attempts})`);
    return { phase: 'verify', task: id, ok: false, verdict: 'fail', attempts };
  }

  // ------------------------------------------------------------- faza 4

  /**
   * Revizorski zadatak nema šta da se „promoviše": izmene su već u `wiki/`, na
   * grani verifikatora. Zato ovde nema konsolidatora — kontrolni sloj samo
   * spaja verifikovanu granu i regeneriše izvedene artefakte.
   */
  async function mergeAudit(id, task) {
    const role = ROLE_OF_PHASE.consolidate;
    const owner = identityFor(config, role);
    const verifyRole = ROLE_OF_PHASE.verify;
    const branch = `agent/${verifyRole}/${id}`;
    await store.claim(id, owner);
    await store.emit('phase.start', { task: id, phase: 'consolidate', role, branch, kind: 'audit' });

    const merge = await mergeIntoMain(config, {
      branch,
      message: `agentctl(${id}): revizija baze (librarian+verifier)`,
      worktreeDir: worktreePath(config, id, verifyRole),
      generatedPaths: [config.vault.index],
    });
    if (!merge.merged) {
      await store.transition(id, 'blocked', { actor: 'agentctl', note: `merge revizije nije prošao: ${merge.reason}` });
      await commitBookkeeping(`agentctl: ${id} -> blocked (revizija: ${merge.reason})`);
      await store.emit('phase.failed', { task: id, phase: 'consolidate', kind: 'audit', reason: merge.reason });
      return { phase: 'consolidate', task: id, ok: false, reason: merge.reason, kind: 'audit' };
    }

    await store.transition(id, 'consolidated', { actor: 'agentctl', note: `revizija spojena ${merge.sha.slice(0, 8)}` });
    await store.setAuthors(id, [ROLE_OF_PHASE.audit, verifyRole], { actor: 'agentctl' });
    await removeWorktreesForTask(config, id);
    await deleteBranch(config, `agent/${ROLE_OF_PHASE.audit}/${id}`);
    await deleteBranch(config, branch);
    await commitBookkeeping(`agentctl: ${id} revizija konsolidovana (${merge.sha.slice(0, 8)})`);
    await store.emit('phase.done', { task: id, phase: 'consolidate', role, kind: 'audit', merge: merge.sha });
    logger(`consolidate: ${id} (revizija) -> main @ ${merge.sha.slice(0, 8)}`);
    return { phase: 'consolidate', task: id, ok: true, kind: 'audit', merge: merge.sha };
  }

  async function runConsolidate(id) {
    const task = await store.get(id);
    if (task.data.status !== 'verified') {
      throw new PipelineError(`${id} nije u stanju verified (${task.data.status})`, 'NOT_VERIFIED');
    }
    if ((task.data.kind ?? 'ingest') === 'audit') return mergeAudit(id, task);
    const role = ROLE_OF_PHASE.consolidate;
    const owner = identityFor(config, role);
    const verifierBranch = `agent/${ROLE_OF_PHASE.verify}/${id}`;
    const claimResult = await store.claim(id, owner);
    leaseTokens.set(id, claimResult.leaseToken);
    const claimed = { ...(await store.get(id)), leaseToken: claimResult.leaseToken };
    const { path: wt, config: wtConfig } = await prepareWorktree({
      id, role, base: verifierBranch, fresh: true, branch: `agent/${role}/${id}`,
    });
    await store.emit('phase.start', { task: id, phase: 'consolidate', role, worktree: wt });

    const prompt = await buildPrompt(config, {
      role,
      task: claimed,
      extra: {
        worktree: wt,
        instructions: `Nacrt(i): ${(claimed.data.artifacts ?? []).join(', ')}. Premesti u ${config.vault.production}/ i regeneriši ${config.vault.index}.`,
      },
    });

    let result;
    try {
      result = await runAgent(config, { role, task: claimed, cwd: wt, prompt, now: now(), logger });
    } catch (error) {
      await failPhase(id, role, { reason: `harnes je bacio grešku: ${error.message}`, toStatus: 'review' });
      throw error;
    }

    // Konsolidacija je jedina faza u kojoj promene ulaze u produkciju: proveri
    // da postoje i da linter ćuti, pre nego što se grana spoji u main.
    const lintWorktree = await lintVault(wtConfig);
    if (lintWorktree.errors.length) {
      await store.updateBody(id, {
        actor: owner,
        append: `### Konsolidacija odbijena (${now()})\n\nLinter u radnom stablu prijavljuje greške:\n\n\`\`\`\n${lintWorktree.errors.map((e) => `${e.code} ${e.target}: ${e.message}`).join('\n')}\n\`\`\``,
        note: 'konsolidacija odbijena od lintera',
      });
      await failPhase(id, role, { reason: `linter: ${lintWorktree.errors.length} grešaka`, toStatus: 'review' });
      return { phase: 'consolidate', task: id, ok: false, reason: 'linter', errors: lintWorktree.errors.length };
    }

    if (!result.ok) {
      await failPhase(id, role, { reason: `harnes nije uspeo (exit ${result.exitCode})`, toStatus: 'review' });
      return { phase: 'consolidate', task: id, ok: false, reason: 'harnes' };
    }

    // Nacrt više ne postoji: artefakti zadatka od sada pokazuju na produkciju.
    const produced = await detectArtifacts(wtConfig, { role });
    if (!produced.length) {
      // Izlazni kod 0 nije dokaz: bez produkcione beleške u radnom stablu nema
      // šta da se spoji u `main`.
      await store.updateBody(id, {
        actor: owner,
        append: `### Konsolidacija bez artefakta (${now()})\n\nHarnes je izašao sa kodom ${result.exitCode}, ali u \`${config.vault.production}/\` nema ni jedne produkcione beleške.\n\n\`\`\`\n${result.output.slice(0, 2000)}\n\`\`\``,
        note: 'konsolidacija bez produkcione beleške',
      });
      await failPhase(id, role, { reason: 'nema produkcione beleške u radnom stablu', toStatus: 'review' });
      return { phase: 'consolidate', task: id, ok: false, reason: 'nema produkcione beleške' };
    }
    // Zaglavlje produkcionih belešaka je knjigovodstvo, ne prepisivanje sadržaja:
    // status i spisak autora su izvedeni iz evidencije zadatka.
    const contributors = [...new Set([...(claimed.data.authors ?? []), 'researcher', 'verifier', 'consolidator'])];
    for (const rel of produced) {
      await normalizeConsolidatedNote(wt, rel, { authors: contributors, now: now() });
    }
    await store.setArtifacts(id, produced, { actor: owner, note: `konsolidovano: ${produced.join(', ')}` });

    const branch = `agent/${role}/${id}`;
    const commit = await commitWorktreeSafe(config, id, role, `consolidator(${id}): konsolidacija u wiki/`, owner);
    // Grana se rebase-uje na aktuelni main, izvedeni artefakti (Index.md) se
    // poravnavaju, pa tek onda sledi eksplicitan merge commit.
    const merge = await mergeIntoMain(config, {
      branch,
      message: `agentctl(${id}): konsolidacija (researcher+verifier+consolidator)`,
      worktreeDir: worktreePath(config, id, role),
      generatedPaths: [config.vault.index],
    });

    if (!merge.merged) {
      await store.transition(id, 'blocked', {
        actor: 'agentctl',
        note: `merge u main nije prošao: ${merge.reason}`,
      });
      if (merge.conflict) {
        await store.updateBody(id, {
          actor: 'agentctl',
          append: `### Konflikt pri merge-u (${now()})\n\nFajlovi: ${merge.files.join(', ')}\n\nRadna stabla su zadržana za arbitražu.`,
          note: 'konflikt pri merge-u',
        });
      }
      await commitBookkeeping(`agentctl: ${id} -> blocked (merge: ${merge.reason})`);
      await store.emit('phase.failed', { task: id, phase: 'consolidate', reason: merge.reason, conflict: Boolean(merge.conflict) });
      logger(`consolidate: ${id} -> KONFLIKT/ODBIJENO (${merge.reason})`);
      return { phase: 'consolidate', task: id, ok: false, conflict: Boolean(merge.conflict), reason: merge.reason };
    }

    await store.transition(id, 'consolidated', { actor: 'agentctl', note: `merge ${merge.sha.slice(0, 8)}` });
    await store.setAuthors(id, ['consolidator'], { actor: 'agentctl' });
    await removeWorktreesForTask(config, id);
    await deleteBranch(config, `agent/${ROLE_OF_PHASE.research}/${id}`);
    await deleteBranch(config, `agent/${ROLE_OF_PHASE.verify}/${id}`);
    await deleteBranch(config, branch);
    await commitBookkeeping(`agentctl: ${id} konsolidovan (${merge.sha.slice(0, 8)})`);
    await store.emit('phase.done', { task: id, phase: 'consolidate', role, merge: merge.sha, commit: commit.sha });
    logger(`consolidate: ${id} -> main @ ${merge.sha.slice(0, 8)}`);
    return { phase: 'consolidate', task: id, ok: true, merge: merge.sha };
  }

  // ------------------------------------------------------------- faza 5

  async function reflect() {
    const generatedAt = now();
    const { text, entries } = await renderIndex(config.root, { dirs: [config.vault.production], generatedAt });
    const indexFile = path.join(config.root, config.vault.index);
    await fs.mkdir(path.dirname(indexFile), { recursive: true });

    // `wiki/Index.md` je izveden: ako se sadržaj nije promenio, ne diraj fajl.
    // Bez ovoga svaki krug kontrolne petlje proizvodi novi commit samo zbog
    // vremenske oznake, a main i grane se razilaze bez razloga.
    const stripTimestamps = (value) => value.replace(/^(created|updated):.*$/gm, '');
    let existing = null;
    try {
      existing = await fs.readFile(indexFile, 'utf8');
    } catch { /* prvi prolaz */ }
    const changed = !existing || stripTimestamps(existing) !== stripTimestamps(text);
    if (changed) await fs.writeFile(indexFile, text, 'utf8');

    const { added, total } = await updateRawManifest(config);
    const commit = await commitBookkeeping(changed
      ? 'agentctl: reflect (indeks + manifest izvora)'
      : 'agentctl: reflect (manifest izvora)');
    const history = await gitLog(config.root, { limit: 10 });

    await store.emit('phase.done', {
      task: null,
      phase: 'reflect',
      notes: entries.length,
      indexChanged: changed,
      rawManifestAdded: added,
      rawManifestTotal: total,
      commit: commit.sha,
    });
    return { phase: 'reflect', ok: true, notes: entries.length, indexChanged: changed, manifest: { added, total }, commit: commit.sha, history };
  }

  // ------------------------------------------------------------- petlja

  /** Jedan prolaz kroz sve faze; dovršava započeto pre nego što otvara novo. */
  async function runOnce({ only = null } = {}) {
    const actions = [];
    const reclaimed = await store.reclaimExpired();
    for (const entry of reclaimed) {
      await removeWorktreesForTask(config, entry.id);
      actions.push({ phase: 'reclaim', task: entry.id, ok: true, previousOwner: entry.previousOwner });
    }

    const tasks = await store.list();
    const pick = (status) => tasks.filter((t) => t.data.status === status).map((t) => t.data.id);

    const phases = only ? [only] : ['consolidate', 'verify', 'audit', 'extract', 'research'];
    for (const phase of phases) {
      const status = {
        consolidate: 'verified', verify: 'review', audit: 'ready', extract: 'ready', research: 'ready',
      }[phase];
      for (const id of pick(status)) {
        const role = ROLE_OF_PHASE[phase];
        // Stanje se čita iznova: faza `extract` u istom krugu pušta `research`.
        const fresh = await store.tryGet(id);
        if (!fresh) continue;
        const kind = fresh.data.kind ?? 'ingest';
        if (phase === 'audit' && kind !== 'audit') continue;
        if (phase === 'extract' && (kind !== 'ingest' || !fresh.data.extract_required || fresh.data.extracted)) continue;
        if (phase === 'research' && (kind !== 'ingest' || (fresh.data.extract_required && !fresh.data.extracted))) continue;
        if (phase === 'verify' && fresh.data.status !== 'review') continue;
        if (phase === 'consolidate' && fresh.data.status !== 'verified') continue;
        try {
          const result = phase === 'consolidate' ? await runConsolidate(id)
            : phase === 'verify' ? await runVerify(id)
              : phase === 'audit' ? await runAudit(id)
                : phase === 'extract' ? await runExtract(id)
                  : await runResearch(id);
          actions.push(result);
        } catch (error) {
          await store.emit('phase.error', { task: id, phase, role, error: error.message });
          logger(`greška u fazi ${phase} za ${id}: ${error.message}`);
          actions.push({ phase, task: id, ok: false, error: error.message });
        }
      }
    }

    // Napredak nije samo uspeh: opozvan zakup i odbijen verdikt takođe menjaju
    // stanje crne table. Bez toga `run()` stane posle prvog `fail` i dozvoljeni
    // broj pokušaja (maxRevisions) se nikad ne potroši.
    const progressed = (a) => a.ok === true
      || a.phase === 'reclaim'
      || (a.phase === 'verify' && a.verdict === 'fail');

    if (!only) {
      const reflected = await reflect();
      return { actions, changed: actions.some(progressed), reflect: reflected };
    }
    return { actions, changed: actions.some(progressed) };
  }

  async function run({ rounds = config.pipeline.maxRounds, intervalMs = config.pipeline.intervalMs } = {}) {
    const all = [];
    for (let round = 0; round < rounds; round += 1) {
      const result = await runOnce();
      all.push({ round, ...result });
      logger(`krug ${round + 1}/${rounds}: ${result.actions.length} akcija, promena=${result.changed}`);
      if (!result.changed) break;
      if (intervalMs > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return all;
  }

  async function status() {
    const tasks = await store.list();
    const lint = await lintVault(config);
    const byStatus = {};
    for (const task of tasks) byStatus[task.data.status] = (byStatus[task.data.status] ?? 0) + 1;
    const branch = await ensureMainBranch(config);
    return {
      root: config.root,
      branch: branch.branch,
      tasks: tasks.map((t) => ({
        id: t.data.id,
        title: t.data.title,
        status: t.data.status,
        phase: t.phase,
        owner: t.data.lock_owner ?? null,
        expires: t.data.lease_expires_at ?? null,
        artifacts: t.data.artifacts ?? [],
      })),
      byStatus,
      lint: { errors: lint.errors.length, warnings: lint.warnings.length },
    };
  }

  return {
    config, store, clock, logger,
    ingest, audit, runAudit, runExtract, runResearch, runVerify, runConsolidate, reflect, runOnce, run, status,
    evaluateReadiness, failPhase,
  };
}

// ------------------------------------------------------------------ pomoćno

/** Detektuj artefakte koje je faza proizvela u radnom stablu. */
async function detectArtifacts(worktreeConfig, { role, before = [] }) {
  const zone = {
    extractor: [path.join(worktreeConfig.paths.drafts, 'fragments')],
    researcher: [worktreeConfig.paths.drafts],
    verifier: [worktreeConfig.paths.reviews],
    consolidator: [worktreeConfig.paths.production],
  }[role] ?? [];
  const found = [];
  for (const dir of zone) {
    const relBase = path.relative(worktreeConfig.root, dir).split(path.sep).join('/');
    const notes = await listNotes(worktreeConfig.root, [relBase || '.']).catch(() => []);
    for (const rel of notes) {
      if (before.includes(rel)) continue;
      // Konsolidator ne prisvaja nacrte; istraživač ne prisvaja tuđe fragmente —
      // inače bi fragment mogao da završi kao produkciona beleška.
      if (role === 'consolidator' && rel.includes('/drafts/')) continue;
      if (role === 'researcher' && rel.includes('/fragments/')) continue;
      found.push(rel);
    }
  }
  return found.filter((rel) => rel.endsWith('.md') && !rel.endsWith('Index.md'));
}

async function commitWorktreeSafe(config, id, role, message, actor) {
  const { commitWorktree } = await import('./worktree.mjs');
  return commitWorktree(config, id, message, { actor, role });
}

function inferVerdict(result) {
  return parseVerdict(result.output ?? '').verdict;
}
