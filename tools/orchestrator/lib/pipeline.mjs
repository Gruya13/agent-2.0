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
import { exists } from './fsx.mjs';
import { commitPaths, log as gitLog } from './git.mjs';
import {
  alignGeneratedPaths, createWorktree, deleteBranch, ensureMainBranch, mergeIntoMain,
  removeWorktree, removeWorktreesForTask, worktreePath, MAIN_BRANCH,
} from './worktree.mjs';
import { buildPrompt, parseVerdict, runAgent } from './agents/index.mjs';
import { lintVault, updateRawManifest } from './lint.mjs';
import { listNotes, renderIndex } from './vault.mjs';
import { defaultBody, newTaskData, nextTaskId, writeTaskFile } from './task.mjs';

export class PipelineError extends Error {
  constructor(message, code = 'PIPELINE_ERROR') {
    super(message);
    this.name = 'PipelineError';
    this.code = code;
  }
}

const ROLE_OF_PHASE = {
  research: 'researcher',
  verify: 'verifier',
  consolidate: 'consolidator',
};

export function createPipeline(config, options = {}) {
  const clock = options.clock ?? (() => new Date());
  const logger = options.logger ?? (() => {});
  const store = options.store ?? createStore(config, { clock });
  const maxRevisions = options.maxRevisions ?? config.pipeline.maxRevisions ?? 3;

  const now = () => clock().toISOString();

  /**
   * Knjigovodstvo kontrolnog sloja: komituju se isključivo zone crne table.
   * Izmene u kodu ili tuđim zonama se ne diraju.
   */
  const BOOKKEEPING_PATHS = ['tasks', 'wiki', '.agents/raw-manifest.json'];

  async function commitBookkeeping(message, actor = 'agentctl') {
    return commitPaths(config.root, BOOKKEEPING_PATHS, message, { actor });
  }

  /**
   * Faza 1 — unos: registruj izvor (append-only manifest) i otvori zadatak.
   */
  async function ingest({ source, title = null, request = '', tags = [], dependsOn = [], priority = 'normal' } = {}) {
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
    const { data, body } = newTaskData({
      id,
      title: resolvedTitle,
      source: rel,
      tags,
      dependsOn,
      priority,
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

  /** Pripremi worktree za fazu; vrati putanju i granu. */
  async function prepareWorktree({ id, role, base = MAIN_BRANCH }) {
    await ensureMainBranch(config);
    const worktree = await createWorktree(config, { id, role, base });
    const fresh = await loadConfig(worktree.path);
    return { ...worktree, config: fresh };
  }

  /** Zajednički epilog neuspeha: oslobodi zakup, skloni radno stablo, zabeleži. */
  async function failPhase(id, role, { reason, toStatus = 'ready' }) {
    const task = await store.tryGet(id);
    if (task && task.data.lock_owner === role) {
      try {
        await store.release(id, role, { toStatus, note: `neuspeh: ${reason}` });
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
    const readiness = await evaluateReadiness(id);
    if (!readiness.ready) {
      throw new PipelineError(`${id}: nezadovoljene zavisnosti ${JSON.stringify(readiness.blocking)}`, 'DEPS');
    }

    const role = ROLE_OF_PHASE.research;
    await store.claim(id, role);
    const claimed = await store.get(id);
    const { path: wt, branch, config: wtConfig } = await prepareWorktree({ id, role });
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
        actor: role,
        append: `### Neuspešna faza research (${now()})\n\n\`\`\`\n${result.output.slice(0, 2000)}\n\`\`\``,
        note: 'neuspešna faza research',
      });
      await failPhase(id, role, { reason: result.timedOut ? 'isteklo vreme harnesa' : `nema artefakta (exit ${result.exitCode})` });
      return { phase: 'research', task: id, ok: false, reason: 'nema artefakta', output: result.output };
    }

    const commit = await commitWorktreeSafe(config, id, role, `researcher(${id}): nacrt iz ${claimed.data.source}`, role);
    await store.attachArtifacts(id, produced, { actor: role, note: `nacrt: ${produced.join(', ')}` });
    await store.updateBody(id, {
      actor: role,
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
    await store.release(id, role, { toStatus: 'review', note: `nacrt spreman: ${produced.join(', ')}` });
    await commitBookkeeping(`agentctl: ${id} -> review (nacrt: ${produced.join(', ')})`);
    await store.emit('phase.done', { task: id, phase: 'research', role, artifacts: produced, commit: commit.sha });
    logger(`research: ${id} -> ${produced.join(', ')} (${result.harness})`);
    return { phase: 'research', task: id, ok: true, artifacts: produced, commit: commit.sha, branch };
  }

  // ------------------------------------------------------------- faza 3

  async function runVerify(id) {
    const task = await store.get(id);
    if (task.data.status !== 'review') {
      throw new PipelineError(`${id} nije u stanju review (${task.data.status})`, 'NOT_REVIEW');
    }
    const role = ROLE_OF_PHASE.verify;
    const researcherBranch = `agent/${ROLE_OF_PHASE.research}/${id}`;
    await store.claim(id, role);
    const claimed = await store.get(id);
    const { path: wt, branch: _branch, config: wtConfig } = await prepareWorktree({ id, role, base: researcherBranch });
    await store.emit('phase.start', { task: id, phase: 'verify', role, worktree: wt });

    const prompt = await buildPrompt(config, {
      role,
      task: claimed,
      extra: {
        worktree: wt,
        instructions: `Nacrt: ${(claimed.data.artifacts ?? []).join(', ') || '(vidi wiki/drafts/)'}. Revizorski trag ide u ${config.vault.tasks}/reviews/${id}.md. Poslednja linija izlaza mora biti "VERDICT: pass" ili "VERDICT: fail".`,
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

    const commit = await commitWorktreeSafe(config, id, role, `verifier(${id}): revizija -> ${verdict}`, role);
    await store.setVerification(id, {
      verdict,
      harness: result.harness,
      at: now(),
      commit: commit.sha,
      summary: result.output.slice(-2000),
    }, { actor: role });
    await store.updateBody(id, {
      actor: role,
      append: [
        `### Faza verify (${now()})`,
        '',
        `- harnes: ${result.harness}`,
        `- trajanje: ${result.durationMs} ms`,
        `- verdikt: ${verdict}`,
        `- grana: ${researcherBranch} -> verifier @ ${commit.sha ?? '(bez komita)'}`,
        '',
        '```',
        result.output.slice(0, 4000),
        '```',
      ].join('\n'),
      note: `faza verify: ${verdict}`,
    });

    if (verdict === 'pass') {
      await store.release(id, role, { toStatus: 'verified', note: 'verifikator dao pečat' });
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
        note: `nacrt je odbijen ${attempts} puta; potrebna ljudska intervencija`,
      });
      await commitBookkeeping(`agentctl: ${id} -> blocked (previse revizija)`);
      await removeWorktree(config, id, { role });
      await store.emit('phase.failed', { task: id, role, reason: 'previse revizija' });
      return { phase: 'verify', task: id, ok: false, verdict: 'fail', blocked: true };
    }
    await store.release(id, role, { toStatus: 'ready', note: `odbijen nacrt (pokušaj ${attempts}); vraćeno istraživaču` });
    await commitBookkeeping(`agentctl: ${id} -> ready (nacrt odbijen, pokušaj ${attempts})`);
    await removeWorktree(config, id, { role });
    await store.emit('phase.rejected', { task: id, role, attempts });
    logger(`verify: ${id} -> fail (pokušaj ${attempts})`);
    return { phase: 'verify', task: id, ok: false, verdict: 'fail', attempts };
  }

  // ------------------------------------------------------------- faza 4

  async function runConsolidate(id) {
    const task = await store.get(id);
    if (task.data.status !== 'verified') {
      throw new PipelineError(`${id} nije u stanju verified (${task.data.status})`, 'NOT_VERIFIED');
    }
    const role = ROLE_OF_PHASE.consolidate;
    const verifierBranch = `agent/${ROLE_OF_PHASE.verify}/${id}`;
    await store.claim(id, role);
    const claimed = await store.get(id);
    const { path: wt, config: wtConfig } = await prepareWorktree({ id, role, base: verifierBranch });
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
        actor: role,
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

    const branch = `agent/${role}/${id}`;
    const commit = await commitWorktreeSafe(config, id, role, `consolidator(${id}): konsolidacija u wiki/`, role);
    // Indeks je izveden artefakt: poravnaj ga sa main pre merge-a, pa ga
    // kontrolni sloj regeneriše posle spajanja (faza 5).
    await alignGeneratedPaths(config, worktreePath(config, id, role), [config.vault.index]);
    const merge = await mergeIntoMain(config, {
      branch,
      message: `agentctl(${id}): konsolidacija (researcher+verifier+consolidator)`,
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

    const phases = only ? [only] : ['consolidate', 'verify', 'research'];
    for (const phase of phases) {
      const status = { consolidate: 'verified', verify: 'review', research: 'ready' }[phase];
      for (const id of pick(status)) {
        const role = ROLE_OF_PHASE[phase];
        try {
          const result = phase === 'consolidate' ? await runConsolidate(id)
            : phase === 'verify' ? await runVerify(id)
              : await runResearch(id);
          actions.push(result);
        } catch (error) {
          await store.emit('phase.error', { task: id, phase, role, error: error.message });
          logger(`greška u fazi ${phase} za ${id}: ${error.message}`);
          actions.push({ phase, task: id, ok: false, error: error.message });
        }
      }
    }

    if (!only) {
      const reflected = await reflect();
      const changed = actions.some((a) => a.ok);
      return { actions, changed, reflect: reflected };
    }
    return { actions, changed: actions.some((a) => a.ok) };
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
    ingest, runResearch, runVerify, runConsolidate, reflect, runOnce, run, status,
    evaluateReadiness, failPhase,
  };
}

// ------------------------------------------------------------------ pomoćno

/** Detektuj artefakte koje je faza proizvela u radnom stablu. */
async function detectArtifacts(worktreeConfig, { role, before = [] }) {
  const zone = {
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
      if (role === 'consolidator' && rel.includes('/drafts/')) continue;
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
