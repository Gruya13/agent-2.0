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
import { commitPaths, git, headSha, log as gitLog, statusPorcelain } from './git.mjs';
import {
  changedFilesInWorktree, createWorktree, deleteBranch, ensureMainBranch, mergeIntoMain,
  removeWorktree, removeWorktreesForTask, worktreePath, MAIN_BRANCH,
} from './worktree.mjs';
import { buildPrompt, identityFor, parseVerdict, runAgent } from './agents/index.mjs';
import { lintRawImmutability, lintVault, updateRawManifest } from './lint.mjs';
import { isReproductionScript, runReproductionScripts } from './reproduce.mjs';
import { matchesScope } from './scope.mjs';
import { listNotes, normalizeConsolidatedNote, readNote, renderIndex } from './vault.mjs';
import { defaultBody, dirForPhase, findTask, newTaskData, nextTaskId, phaseFor, writeTaskFile } from './task.mjs';

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
  challenge: 'red-team',
  research: 'researcher',
  verify: 'verifier',
  consolidate: 'consolidator',
};

export function createPipeline(config, options = {}) {
  const clock = options.clock ?? (() => new Date());
  const logger = options.logger ?? (() => {});
  const store = options.store ?? createStore(config, { clock });
  const maxRevisions = options.maxRevisions ?? config.pipeline.maxRevisions ?? 3;
  // Red-team faza se može isključiti po pozivu (npr. u testovima koji proveravaju
  // samo mehaniku spajanja), bez diranja konfiguracije vault-a.
  const challengeEnabled = options.challenge ?? (config.pipeline.challenge !== false);
  /**
   * Zakup je vezan za PROCES, ne samo za ime vendora: svaki `claim` dobija token
   * koji se pamti ovde i predaje dalje uz `release`. Bez toga bi dva procesa
   * istog harnesa držala „isti" zakup.
   */
  const leaseTokens = new Map();

  /**
   * Poziv harnesa uz održavanje zakupa. `lease.heartbeatMs` je do sada postojao
   * samo u konfiguraciji, pa je poziv duži od `lease.ttlMs` gubio zakup usred
   * rada i drugi proces je mogao da preuzme zadatak (dokazano probom: TTL 2 s,
   * poziv 6 s → zakup istekao posle 3 s, preuzet od drugog procesa).
   *
   * Obnova ide iz ISTOG procesa i sa ISTIM tokenom, pa je ne može izvesti tuđi
   * proces; ako obnova ne uspe, to se prijavljuje, a faza će ionako pasti na
   * otpuštanju zakupa.
   */
  async function runAgentDrzeciZakup(id, owner, args) {
    const token = leaseTokens.get(id);
    const period = Math.max(50, config.lease?.heartbeatMs ?? 120_000);
    const timer = setInterval(() => {
      store.renew(id, owner, { token }).catch((error) => {
        logger(`obnova zakupa nije uspela za ${id}: ${error.message}`);
      });
    }, period);
    timer.unref?.();
    try {
      return await runAgent(config, args);
    } finally {
      clearInterval(timer);
    }
  }

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

  /**
   * Sta grana ovog zadatka sme da menja. Grubi prefiks (`wiki/`) ne razlikuje
   * nacrt od produkcije, pa bi `researcher` mogao da upise produkcionu belesku —
   * dokazano skriptom NALAZ-2 drugog red-team prolaza.
   */
  function zonePolicyFor(task) {
    const data = task.data ?? task;
    if ((data.kind ?? 'ingest') === 'audit') {
      return { scope: data.audit_scope ?? [] };
    }
    // Artefakt moze biti nacrt (`wiki/drafts/X.md` -> `wiki/X.md`) ili vec
    // produkciona beleska (kada je konsolidator upise pre merge-a).
    const production = (data.artifacts ?? [])
      .filter((rel) => rel.startsWith('wiki/') && !rel.startsWith('wiki/drafts/fragments/'))
      .map((rel) => (rel.startsWith('wiki/drafts/') ? 'wiki/' + path.basename(rel) : rel));
    return { production };
  }

  /**
   * Knjigovodstvo komituje TACNO poznate fajlove, ne sve sto je prljavo.
   *
   * Ranije se komitovalo sve pod `tasks/` i `wiki/`, pa je fajl upisan direktno u
   * kontrolni koren zavrsavao u `main` bez ijednog merge-a, pecata ili kapije
   * (dokazano skriptom NALAZ-3). Sve sto nije na spisku se prijavljuje kao tuda
   * izmena i ne komituje.
   */
  const BOOKKEEPING_ALLOW = [
    /^tasks\/(inbox|active|review|completed)\/TASK-\d+\.md$/,
    /^tasks\/events\.jsonl$/,
    /^wiki\/Index\.md$/,
    /^\.agents\/raw-manifest\.json$/,
  ];

  async function bookkeepingTargets() {
    const { stdout } = await statusPorcelain(config.root, { raw: true, untracked: 'all' });
    const dozvoljeni = [];
    const tudji = [];
    for (const line of String(stdout ?? '').split('\n')) {
      if (!line.trim()) continue;
      let rel = line.slice(3).trim();
      if (rel.includes(' -> ')) rel = rel.split(' -> ').pop();
      rel = rel.replace(/^"|"$/g, '');
      const noviIzvor = rel.startsWith('raw/') && line.trimStart().startsWith('??');
      if (BOOKKEEPING_ALLOW.some((rx) => rx.test(rel)) || noviIzvor) dozvoljeni.push(rel);
      else if (rel.startsWith('wiki/') || rel.startsWith('tasks/') || rel.startsWith('.agents/')) tudji.push(rel);
    }
    return { dozvoljeni, tudji };
  }

  async function commitBookkeeping(message, actor = 'agentctl') {
    const { dozvoljeni, tudji } = await bookkeepingTargets();
    if (tudji.length) {
      await store.emit('bookkeeping.foreign-change', {
        task: null, actor, files: tudji,
        note: 'izmena u zoni crne table koja nije knjigovodstvena; nije komitovana',
      });
      logger(`ne komitujem tude izmene: ${tudji.join(', ')}`);
    }
    const rawProblems = (await lintRawImmutability(config))
      .filter((f) => f.level === 'error' && ['raw.modified', 'raw.deleted', 'raw.legacy-unknown', 'raw.no-manifest', 'raw.symlink'].includes(f.code));
    let paths = dozvoljeni;
    if (rawProblems.length) {
      paths = dozvoljeni.filter((rel) => !rel.startsWith('raw/'));
      await store.emit('raw.violation', {
        task: null, actor,
        findings: rawProblems.map((f) => ({ code: f.code, target: f.target, message: f.message })),
        note: 'raw/ nije komitovan; prekrsaj mora da resi covek',
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
    // Snimak pre poziva: `detectArtifacts` vraća SVE beleške u zoni uloge, pa bi
    // bez ovoga tuđi nacrti ušli u artefakte ovog zadatka.
    const before = await detectArtifacts(wtConfig, { role });

    const prompt = await buildPrompt(config, {
      role,
      task: claimed,
      extra: { worktree: wt, instructions: `Izvor: ${claimed.data.source}. Nacrt ide u ${config.vault.drafts}/.` },
    });

    let result;
    try {
      result = await runAgentDrzeciZakup(id, owner, { role, task: claimed, cwd: wt, prompt, now: now(), logger });
    } catch (error) {
      await failPhase(id, role, { reason: `harnes je bacio grešku: ${error.message}` });
      throw error;
    }

    const produced = await detectArtifacts(wtConfig, { role, before });
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

  /**
   * Sačuvaj dokazne revizije kao TAGOVE pre brisanja grana.
   *
   * Posle konsolidacije grane verifikatora i red-teama se brišu, pa
   * `verification.commit` i `challenge.revision` ostaju samo kao nedosežni
   * objekti u object store-u izvornog vault-a — svež `git clone --no-local` ih
   * ne prenosi (nezavisna provera, nalaz 1). Tagovi se, za razliku od
   * `refs/evidence/*`, kloniraju po defaultu, pa dokaz ostaje proverljiv.
   */
  async function oznaciDokaz(id, data) {
    const oznaceni = [];
    for (const [oznaka, sha] of [
      ['verify', data?.verification?.commit],
      ['challenge', data?.challenge?.revision],
    ]) {
      if (!sha || !/^[0-9a-f]{40}$/.test(String(sha))) continue;
      const ime = `dokaz/${id}-${oznaka}`;
      await git(config.root, ['tag', '-f', ime, String(sha)], { actor: 'agentctl', allowFailure: true });
      // Neuspeh upisa se NE ignorise: bez taga dokaz ne putuje u svež klon, a
      // grane se posle ovoga brišu. Ako tag nije nastao, faza se prekida PRE
      // brisanja grana (dokaz ostaje dosežan), a neuspeh je vidljiv.
      const provera = await git(config.root, ['rev-parse', '-q', '--verify', `refs/tags/${ime}`], { allowFailure: true });
      if (provera.code !== 0) {
        throw new PipelineError(
          `dokaz nije sačuvan: tag ${ime} za ${sha} nije nastao; grane zadatka ${id} nisu obrisane`,
          'EVIDENCE_TAG',
        );
      }
      oznaceni.push(ime);
    }
    return oznaceni;
  }

  /**
   * Prenesi AKTUELAN zapis zadatka u radno stablo koje se zamrzava.
   *
   * Grana se pravi iz Gita, pa njen `tasks/<faza>/<id>.md` ostaje snimak crne
   * table iz trenutka kada je grana nastala. Red-team tada čita zastareo zapis
   * (stari status, pečat i nalaz PRETHODNOG pokušaja) i može da ga obori
   * skriptom — a to nije nalaz o sadržaju, nego o evidenciji koju autor ne može
   * da ispravi. Zato se aktuelni zapis prenosi u zamrznutu reviziju:
   *   - polje `challenge` (nalaz prethodnog pokušaja) se u toj kopiji uklanja —
   *     ono nije deo ove revizije, a istorija ga čuva u telu zadatka;
   *   - ostala polja (status, zakup, pečat) su aktuelna, pa reference na
   *     revizije razrešavaju iz same zamrznute revizije (grana verifikatora je
   *     predak ove grane).
   * Vraća hash komita sa usklađenim zapisom (to je zamrznuta revizija).
   */
  async function uskladiZapisZadatka(wt, wtConfig, id, claimed) {
    const data = { ...claimed.data, challenge: null };
    const target = path.join(dirForPhase(wtConfig, phaseFor(data.status)), `${id}.md`);
    const postojeci = await findTask(wtConfig, id);
    if (postojeci && postojeci.file !== target) await fs.rm(postojeci.file, { force: true });
    await writeTaskFile(target, data, claimed.body);
    await git(wt, ['add', 'tasks', '--all']);
    await git(
      wt,
      ['-c', 'user.name=agentctl', '-c', 'user.email=agentctl@local', 'commit', '-q', '--allow-empty',
        '-m', `agentctl: zapis ${id} usklađen sa kontrolnim korenom`],
      { actor: 'agentctl', allowFailure: true },
    );
    return headSha(wt);
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
      result = await runAgentDrzeciZakup(id, owner, { role, task: claimed, cwd: wt, prompt, now: now(), logger });
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
    const before = await detectArtifacts(wtConfig, { role });

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
      result = await runAgentDrzeciZakup(id, owner, { role, task: claimed, cwd: wt, prompt, now: now(), logger });
    } catch (error) {
      await failPhase(id, role, { reason: `harnes je bacio grešku: ${error.message}` });
      throw error;
    }

    const produced = await detectArtifacts(wtConfig, { role, before });
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
      result = await runAgentDrzeciZakup(id, owner, { role, task: claimed, cwd: wt, prompt, now: now(), logger });
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

  // ------------------------------------------------------------- faza 3b

  /**
   * Faza `challenge` (red-team): posle pečata, pre spajanja.
   *
   * Radi na **zamrznutoj reviziji** i ne popravlja ono što napada. Ono što je
   * čini korisnom nije mišljenje, nego reprodukcija: kontrolni sloj uzme skript
   * koji je red-team napisao i pokrene ga u svežem klonu te iste revizije. Samo
   * nalaz koji se tamo reprodukuje blokira merge — sve ostalo se broji kao
   * lažni nalaz i ostaje zapisano.
   */
  async function runChallenge(id) {
    const task = await store.get(id);
    if (task.data.status !== 'verified') {
      throw new PipelineError(`${id} nije u stanju verified (${task.data.status})`, 'NOT_VERIFIED');
    }
    if (task.data.challenge?.verdict === 'clean') {
      throw new PipelineError(`${id}: red-team je već dao čist nalaz`, 'ALREADY_CLEAN');
    }
    const role = ROLE_OF_PHASE.challenge;
    const owner = identityFor(config, role);
    const izvorna = `agent/${ROLE_OF_PHASE.verify}/${id}`;
    const claimResult = await store.claim(id, owner);
    leaseTokens.set(id, claimResult.leaseToken);
    const claimed = { ...(await store.get(id)), leaseToken: claimResult.leaseToken };
    const { path: wt, config: wtConfig } = await prepareWorktree({
      id, role, base: izvorna, fresh: true, branch: `agent/${role}/${id}`,
    });
    // Zamrznuta revizija mora da nosi ISTU evidenciju koju red-team proverava.
    const revision = await uskladiZapisZadatka(wt, wtConfig, id, claimed);
    await store.emit('phase.start', { task: id, phase: 'challenge', role, worktree: wt, revision });

    const izvestaj = `tasks/challenges/${id}.md`;
    const prompt = await buildPrompt(config, {
      role,
      task: claimed,
      extra: {
        worktree: wt,
        instructions: [
          `Zamrznuta revizija: ${revision}`,
          `Artefakti zadatka: ${(claimed.data.artifacts ?? []).join(', ') || '(nema)'}`,
          `Izveštaj: ${izvestaj}; skripti: ${config.vault.tasks}/challenges/${id}/NALAZ-<n>.sh`,
          'Skript ispisuje OBORENO: <šta> i izlazi sa 0 ako je tvrdnja oborena; inače izlazi sa 1.',
          'Ne popravljaj ništa i ne piši van tasks/challenges/.',
        ].join('\n'),
      },
    });

    let result;
    try {
      result = await runAgentDrzeciZakup(id, owner, { role, task: claimed, cwd: wt, prompt, now: now(), logger });
    } catch (error) {
      await failPhase(id, role, { reason: `harnes je bacio grešku: ${error.message}`, toStatus: 'verified' });
      throw error;
    }

    // Osnova za proveru zone je zamrznuta revizija (sa usklađenim zapisom), ne
    // stara grana: inače bi sam prenos zapisa izgledao kao izlazak iz zone.
    const changed = await changedFilesInWorktree(wt, revision);
    const vanZone = changed.filter((rel) => !rel.startsWith('tasks/challenges/'));
    if (vanZone.length) {
      await failPhase(id, role, { reason: `red-team je menjao van svoje zone: ${vanZone.join(', ')}`, toStatus: 'verified' });
      return { phase: 'challenge', task: id, ok: false, reason: `red-team je menjao van svoje zone: ${vanZone.join(', ')}`, outside: vanZone };
    }

    // Red-team koji je pao ili nije napisao izveštaj NIJE čist nalaz. Bez ove
    // provere bi pad harnesa tiho otvarao kapiju (dokazano skriptom NALAZ-4).
    const imaIzvestaj = await exists(path.join(wt, izvestaj));
    if (!result.ok || !imaIzvestaj) {
      const razlog = !result.ok ? `harnes je pao (exit ${result.exitCode})` : 'nema izveštaja';
      await store.setFields(id, {
        challenge: { verdict: 'error', revision, by: owner, at: now(), reason: razlog },
      }, { actor: owner, note: `red-team: greška (${razlog})` });
      if (changed.length) await commitWorktreeSafe(config, id, role, `red-team(${id}): neuspeo prolaz`, owner);
      await failPhase(id, role, { reason: `red-team nije dao nalaz: ${razlog}`, toStatus: 'verified' });
      return { phase: 'challenge', task: id, ok: false, verdict: 'error', reason: razlog };
    }

    const scripts = changed.filter(isReproductionScript);
    const maxSkripti = config.pipeline.challengeMaxScripts ?? 3;
    const neizvrseni = scripts.slice(maxSkripti);
    let rezultati = [];
    let izvrsavanje = 'isključeno';
    if (config.pipeline.challengeExecute !== false && scripts.length) {
      izvrsavanje = 'izvršeno';
      rezultati = await runReproductionScripts({
        repoRoot: config.root,
        revision,
        worktreeDir: wt,
        scripts,
        max: maxSkripti,
        timeoutMs: config.pipeline.challengeTimeoutMs,
      });
    }
    const reprodukovani = rezultati.filter((r) => r.reproduced === true);
    const istekli = rezultati.filter((r) => r.timedOut === true).length;
    // Skript koji nije ni pokrenut (sandbox je pukao, interpreter ne postoji,
    // klon nije napravljen) nije lazni nalaz: to je neizvrsena provera i po
    // invarijanti 24 blokira spajanje. Bez ove provere greska okruzenja tiho
    // otvara kapiju — dokazano eksperimentom na a0dc5c8: kada je AF_NETLINK
    // zabranjen, bwrap se prekida, reproduktivni nalaz je brojan kao lazni,
    // verdikt je bio 'clean' i merge je prosao.
    const neizvrseniIzvršavanjem = rezultati.filter((r) => r.executed === false);
    const lažni = rezultati.filter((r) => r.reproduced === false && r.timedOut !== true && r.executed !== false).length;
    const neizvrseniSvi = [...neizvrseni, ...neizvrseniIzvršavanjem.map((r) => r.script)];
    // Verdikt: reproduktivni nalaz blokira; neizvršeni i ISTEKLI skripti se ne
    // smeju tumačiti kao „nema nalaza" (dokazano skriptom NALAZ-5 i sumnjom 2),
    // pa su i oni nalaz.
    const verdict = reprodukovani.length ? 'reproducible'
      : (neizvrseniSvi.length || istekli) ? 'unexecuted'
        : 'clean';
    // Kada verifikator i red-team dele identitet, njihove slepe tačke su
    // korelisane — to se u zadatku beleži, a ne prećutkuje.
    // Korelacija je svojstvo MODELA, ne adaptera: i u mock režimu je par
    // verifikator/red-team isti vendor ako je tako konfigurisan.
    const vendor = (r) => config.agents?.[r]?.harness ?? r;
    const correlationRisk = vendor(ROLE_OF_PHASE.verify) === vendor(role);

    if (changed.length) {
      await commitWorktreeSafe(config, id, role, `red-team(${id}): nalazi na ${revision.slice(0, 8)}`, owner);
    }
    await store.setFields(id, {
      challenge: {
        verdict,
        revision,
        scripts,
        reproduced: reprodukovani.map((r) => r.script),
        falsePositives: lažni,
        timedOut: istekli,
        unexecuted: neizvrseniSvi,
        executionFailures: neizvrseniIzvršavanjem.map((r) => ({
          script: r.script,
          exitCode: r.exitCode ?? null,
          reason: r.error ?? 'sandbox nije pokrenuo skript',
        })),
        executed: izvrsavanje,
        correlationRisk,
        by: owner,
        at: now(),
      },
    }, { actor: owner, note: `red-team: ${verdict}` });
    await store.updateBody(id, {
      actor: owner,
      append: [
        `### Faza challenge / red-team (${now()})`,
        '',
        `- harnes: ${result.harness}`,
        `- zamrznuta revizija: ${revision}`,
        `- verdikt: ${verdict}`,
        `- skripti: ${scripts.length}, reprodukovano: ${reprodukovani.length}, lažnih: ${lažni}, neizvršenih: ${neizvrseniSvi.length} (izvršavanje: ${izvrsavanje})`,
        `- korelacioni rizik (isti vendor kao verifikator): ${correlationRisk ? 'DA' : 'ne'}`,
        `- izveštaj: ${changed.includes(izvestaj) ? izvestaj : '(nije napisan)'}`,
        '',
        ...(rezultati.length
          ? ['| skript | izlaz | reprodukovan |', '|---|---|---|',
            ...rezultati.map((r) => `| ${r.script} | ${r.exitCode ?? '—'}${r.timedOut ? ' (isteklo)' : ''} | ${r.reproduced ? 'DA' : 'ne'} |`), '']
          : []),
        '```',
        result.output.slice(0, 3000),
        '```',
      ].join('\n'),
      note: `red-team: ${verdict}`,
    });

    if (verdict === 'clean') {
      await store.release(id, owner, { toStatus: 'verified', token: leaseTokens.get(id), note: 'red-team nije našao reproduktivni nalaz' });
      await commitBookkeeping(`agentctl: ${id} -> verified (red-team čist)`);
      await store.emit('phase.done', { task: id, phase: 'challenge', role, verdict, revision, scripts: scripts.length, falsePositives: lažni, correlationRisk });
      logger(`challenge: ${id} -> clean (${scripts.length} skripti, ${lažni} lažnih${correlationRisk ? ', korelacioni rizik' : ''})`);
      return { phase: 'challenge', task: id, ok: true, verdict, revision, falsePositives: lažni, correlationRisk };
    }

    // Reproduktivni ili neizvršeni nalaz: ne ide u produkcionu granu.
    const attempts = (await store.get(id)).data.history.filter((h) => h.status === 'review').length;
    if (attempts > maxRevisions) {
      await store.transition(id, 'blocked', {
        actor: 'agentctl',
        note: `red-team je reprodukovao nalaz ${reprodukovani.length} put(a) (dozvoljeno ${maxRevisions}); potrebna ljudska intervencija`,
      });
      await commitBookkeeping(`agentctl: ${id} -> blocked (red-team)`);
      await removeWorktree(config, id, { role });
      await store.emit('phase.failed', { task: id, phase: 'challenge', role, reason: 'reproduktivni nalazi' });
      return { phase: 'challenge', task: id, ok: false, verdict, blocked: true };
    }
    // Nalaz se vraća AUTORU, a autor (istraživač) radi samo iz stanja `ready`.
    // Vraćanje u `review` je značilo da zadatak ulazi u verifikatorov red i da
    // se isti nacrt samo ponovo verifikuje — istraživač nikad ne dobije priliku
    // da ispravi (dokazano petljom: research se posle nalaza nijednom ne pokrene).
    await store.release(id, owner, { toStatus: 'ready', token: leaseTokens.get(id), note: `red-team oborio ${reprodukovani.length} tvrdnji; vraćeno autoru na ispravku` });
    await commitBookkeeping(`agentctl: ${id} -> ready (red-team nalaz)`);
    await removeWorktree(config, id, { role });
    await store.emit('phase.rejected', {
      task: id, phase: 'challenge', role,
      reproduced: reprodukovani.map((r) => r.script),
      falsePositives: lažni,
      timedOut: istekli,
      unexecuted: neizvrseniSvi,
      attempts,
    });
    logger(`challenge: ${id} -> reproducible (${reprodukovani.length} nalaza)`);
    return { phase: 'challenge', task: id, ok: false, verdict, reproduced: reprodukovani.map((r) => r.script), attempts };
  }

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

    try {
      await oznaciDokaz(id, task.data);
    } catch (error) {
      await failPhase(id, role, { reason: error.message, toStatus: 'verified' });
      return { phase: 'consolidate', task: id, ok: false, reason: 'dokaz nije sačuvan', kind: 'audit' };
    }
    const merge = await mergeIntoMain(config, {
      branch,
      message: `agentctl(${id}): revizija baze (librarian+verifier)`,
      zonePolicy: zonePolicyFor(task),
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
    await deleteBranch(config, `agent/${ROLE_OF_PHASE.challenge}/${id}`);
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
    // Red-team kapija: bez čistog nalaza nema spajanja. Nalaz koji se
    // reprodukuje blokira merge; lažni nalaz se samo zabeleži.
    if (challengeEnabled && task.data.challenge?.verdict !== 'clean') {
      throw new PipelineError(`${id}: nije prošao red-team fazu (challenge: ${task.data.challenge?.verdict ?? 'nema'})`, 'NO_CHALLENGE');
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
    // Snimak PRE poziva: u zoni konsolidatora (`wiki/`) su i SVE postojeće
    // produkcione beleške. Bez snimka bi `detectArtifacts` vratio i tuđe
    // beleške, pa bi ih `normalizeConsolidatedNote` prepisao i prijavio kao
    // artefakte ovog zadatka (potvrđeno na TASK-103).
    const before = await detectArtifacts(wtConfig, { role });

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
      result = await runAgentDrzeciZakup(id, owner, { role, task: claimed, cwd: wt, prompt, now: now(), logger });
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
    const produced = await detectArtifacts(wtConfig, { role, before });
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
      // `created` dolazi iz evidencije zadatka (kada je zadatak nastao), ne iz
      // onoga što je model upisao u nacrt.
      await normalizeConsolidatedNote(wt, rel, { authors: contributors, now: now(), created: claimed.data.created ?? null });
    }
    // NAPOMENA: `artifacts` se NE upisuju ovde. `produced` je sve što grana menja
    // u radnom stablu, a grana može da dira i tuđu postojeću belešku. Kapija
    // spajanja čita `artifacts` kao dozvoljene produkcione mete, pa bi upis pre
    // merge-a pretvorio odbijenu putanju u dozvoljenu metu za sledeći pokušaj
    // (potvrđeno na TASK-103: tuđa beleška je ostala u zadatku posle odbijanja).

    const branch = `agent/${role}/${id}`;
    const commit = await commitWorktreeSafe(config, id, role, `consolidator(${id}): konsolidacija u wiki/`, owner);
    // Grana se rebase-uje na aktuelni main, izvedeni artefakti (Index.md) se
    // poravnavaju, pa tek onda sledi eksplicitan merge commit.
    // Dokaz se označava PRE merge-a: ako upis taga ne uspe, zadatak ostaje u
    // stanju `verified` bez objavljivanja i može da se ponovi, a grane (jedine
    // dosežne reference) nisu obrisane. Da je označavanje posle tranzicije,
    // neuspeh bi ostavio zadatak `consolidated` bez dokaznih tagova i bez
    // mogućnosti ponovnog pokušaja (nalaz nezavisne provere). Neuspeh se vraća
    // kroz `failPhase`, koji otpušta zakup — inače bi zadatak ostao `in_progress`.
    try {
      await oznaciDokaz(id, task.data);
    } catch (error) {
      await failPhase(id, role, { reason: error.message, toStatus: 'verified' });
      return { phase: 'consolidate', task: id, ok: false, reason: 'dokaz nije sačuvan' };
    }
    const merge = await mergeIntoMain(config, {
      branch,
      message: `agentctl(${id}): konsolidacija (researcher+verifier+consolidator)`,
      zonePolicy: zonePolicyFor(task),
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
      // Predložene putanje odbijenog pokušaja ostaju u ISTORIJI zadatka, ne u
      // `artifacts`: evidencija mora da opiše ono što je stvarno prošlo kapiju.
      await store.updateBody(id, {
        actor: 'agentctl',
        append: [
          `### Konsolidacija odbijena (${now()})`,
          '',
          `Razlog: ${merge.reason}`,
          '',
          `Predloženi artefakti ovog (odbijenog) pokušaja: ${produced.join(', ')}`,
          '',
          'Ove putanje NISU upisane u `artifacts` i ne postaju dozvoljene produkcione mete.',
        ].join('\n'),
        note: 'konsolidacija odbijena (predloženi artefakti u istoriji)',
      });
      await commitBookkeeping(`agentctl: ${id} -> blocked (merge: ${merge.reason})`);
      await store.emit('phase.failed', { task: id, phase: 'consolidate', reason: merge.reason, conflict: Boolean(merge.conflict) });
      logger(`consolidate: ${id} -> KONFLIKT/ODBIJENO (${merge.reason})`);
      return { phase: 'consolidate', task: id, ok: false, conflict: Boolean(merge.conflict), reason: merge.reason };
    }

    // Tek sada, posle uspešnog merge-a, `artifacts` opisuju ono što je zaista
    // objavljeno ovim zadatkom.
    await store.setArtifacts(id, produced, { actor: owner, note: `konsolidovano: ${produced.join(', ')}` });
    await store.transition(id, 'consolidated', { actor: 'agentctl', note: `merge ${merge.sha.slice(0, 8)}` });
    await store.setAuthors(id, ['consolidator'], { actor: 'agentctl' });
    await removeWorktreesForTask(config, id);
    await deleteBranch(config, `agent/${ROLE_OF_PHASE.research}/${id}`);
    await deleteBranch(config, `agent/${ROLE_OF_PHASE.verify}/${id}`);
    await deleteBranch(config, `agent/${ROLE_OF_PHASE.challenge}/${id}`);
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

    const phases = only ? [only] : ['consolidate', 'verify', 'challenge', 'audit', 'extract', 'research'];
    for (const phase of phases) {
      const status = {
        consolidate: 'verified', verify: 'review', challenge: 'verified',
        audit: 'ready', extract: 'ready', research: 'ready',
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
        if (phase === 'challenge' && (fresh.data.status !== 'verified' || fresh.data.challenge?.verdict === 'clean')) continue;
        if (phase === 'consolidate' && fresh.data.status !== 'verified') continue;
        if (phase === 'consolidate' && challengeEnabled && fresh.data.challenge?.verdict !== 'clean') continue;
        try {
          const result = phase === 'consolidate' ? await runConsolidate(id)
            : phase === 'verify' ? await runVerify(id)
              : phase === 'challenge' ? await runChallenge(id)
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
      || (a.phase === 'verify' && a.verdict === 'fail')
      || (a.phase === 'challenge' && (a.verdict === 'reproducible' || a.verdict === 'unexecuted'));

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
    ingest, audit, runAudit, runExtract, runResearch, runVerify, runChallenge, runConsolidate, reflect, runOnce, run, status,
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
