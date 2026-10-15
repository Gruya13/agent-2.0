/**
 * Coding tok — programski zahtev do prihvaćene promene.
 *
 * Ciljni repozitorijum (`code_target`) je JEDINI koji se menja; kontrolni repo
 * (`config.root`) drži pravila, zakupe i evidenciju. Zato je provera cilja prva
 * kapija: cilj ne sme biti kontrolni repo, ni unutar njega, ni obrnuto.
 *
 * Koraci:
 *   1. reproduce — worktree na `code_base`; `code_test` MORA pasti.
 *   2. implement — agent (uloga `programer`) piše popravku i regresioni test;
 *      svaka izmena mora biti unutar `code_scope`.
 *   3. check     — `code_test` prolazi; kontrolni sloj SAM dokazuje da regresioni
 *      test pada na početnoj reviziji (nije tautologija ni oslabljen test).
 *   4. review    — drugi vendor u svom checkout-u pravi sopstveni kontrolni
 *      slučaj i daje nalaz.
 *   5. accept    — merge grane u `main` ciljnog repoa + dokazni tag. Bez push-a.
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { exists, walkFiles, writeFileAtomic } from './fsx.mjs';
import { commitPaths, git } from './git.mjs';
import { buildPrompt, identityFor, runAgent } from './agents/index.mjs';
import { matchesScope } from './scope.mjs';
import { readNote, writeNote } from './vault.mjs';
import { defaultBody, newTaskData, nextTaskId, writeTaskFile } from './task.mjs';

const execAsync = promisify(exec);
const OWNER = 'agentctl';
const ROLE_IMPLEMENT = 'programer';
const ROLE_REVIEW = 'reviewer';
const MAX_POKUSAJA = 3;
const TEST_RE = /(^|\/)(tests?|__tests__|spec)(\/|$)|[.](test|spec)[.][a-z]+$/i;

export class CodingError extends Error {
  constructor(message, code = 'CODING_ERROR') {
    super(message);
    this.name = 'CodingError';
    this.code = code;
  }
}

export function createCodingPipeline(config, { store, logger = () => {} } = {}) {
  const now = () => new Date().toISOString();

  /** Ciljni repo mora biti git repozitorijum, strogo odvojen od kontrolnog. */
  async function proveriCilj(task) {
    if (!task.data.code_target) throw new CodingError('zadatak nema "code_target"', 'NO_TARGET');
    const root = path.resolve(String(task.data.code_target));
    const kontrolni = path.resolve(config.root);
    if (root === kontrolni || root.startsWith(kontrolni + path.sep)) {
      throw new CodingError(`code_target (${root}) je kontrolni repo ili unutar njega`, 'TARGET_IS_CONTROL');
    }
    if (kontrolni.startsWith(root + path.sep)) {
      throw new CodingError(`kontrolni repo je unutar code_target (${root})`, 'CONTROL_INSIDE_TARGET');
    }
    if (!(await exists(path.join(root, '.git')))) {
      throw new CodingError(`code_target ${root} nije git repozitorijum`, 'NOT_A_REPO');
    }
    return root;
  }

  async function pokreniTest(dir, komanda) {
    const started = Date.now();
    // `NODE_TEST_CONTEXT` se nasleđuje iz procesa koji je i sam pokrenut kao test:
    // tada `node --test` u podprocesu pomisli da je rekurzija i preskoči fajlove,
    // pa bi "test pada" izgledalo kao prolaz. Podproces dobija čisto okruženje.
    const env = { ...process.env, CI: '1' };
    delete env.NODE_TEST_CONTEXT;
    try {
      const { stdout, stderr } = await execAsync(komanda, {
        cwd: dir,
        timeout: 10 * 60 * 1000,
        maxBuffer: 16 * 1024 * 1024,
        env,
      });
      return { exitCode: 0, stdout: String(stdout), stderr: String(stderr), durationMs: Date.now() - started };
    } catch (error) {
      return {
        exitCode: Number.isInteger(error.code) ? error.code : 1,
        stdout: String(error.stdout ?? ''),
        stderr: String(error.stderr ?? error.message),
        durationMs: Date.now() - started,
      };
    }
  }

  const granaZa = (id) => `agent/code/${id}`;

  async function napraviStablo(root, id, { rev, grana = null } = {}) {
    await git(root, ['worktree', 'prune'], { actor: OWNER, allowFailure: true });
    const dir = path.join(os.tmpdir(), `agent2-code-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    const args = grana
      ? ['worktree', 'add', '-B', grana, dir, rev]
      : ['worktree', 'add', '--detach', dir, rev];
    await git(root, args, { actor: OWNER });
    return dir;
  }

  async function ukloniStablo(root, dir) {
    await git(root, ['worktree', 'remove', '--force', dir], { actor: OWNER, allowFailure: true });
    await fs.rm(dir, { recursive: true, force: true });
  }

  /**
   * Izmene u radnom stablu ciljnog repoa (bez kontrolnog `.runtime`).
   *
   * Uzima i nepraćene/izmenjene fajlove i razliku prema početnoj reviziji: ako je
   * agent sam komitovao, `git status` je prazan i izmene bi se izgubile.
   */
  async function izmeneU(dir, base) {
    await fs.rm(path.join(dir, '.runtime'), { recursive: true, force: true });
    const status = await git(dir, ['status', '--porcelain'], { allowFailure: true });
    const izStatusa = status.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^\S+\s+/, '').replace(/^"|"$/g, ''));
    const izDiffa = base
      ? (await git(dir, ['diff', '--name-only', base], { allowFailure: true })).stdout.split('\n').filter(Boolean)
      : [];
    return [...new Set([...izStatusa, ...izDiffa])]
      .filter((rel) => rel && !rel.startsWith('.agent-review/'))
      // `MEMORY.md` i `.runtime/` pripadaju kontrolnom sloju, ne zadatku.
      .filter((rel) => rel !== 'MEMORY.md');
  }

  /** Dokaz 1: regresioni test iz popravke mora pasti na početnoj reviziji. */
  async function dokaziPadNaOsnovi(root, task, testFajlovi, dir) {
    const baza = await napraviStablo(root, `${task.data.id}-baza`, { rev: task.data.code_base });
    try {
      for (const rel of testFajlovi) {
        const sadrzaj = await git(dir, ['show', `HEAD:${rel}`], { allowFailure: true });
        if (sadrzaj.code !== 0) continue;
        const cilj = path.join(baza, rel);
        await fs.mkdir(path.dirname(cilj), { recursive: true });
        await fs.writeFile(cilj, `${sadrzaj.stdout}\n`, 'utf8');
      }
      const test = await pokreniTest(baza, task.data.code_test);
      return {
        exitCode: test.exitCode,
        files: testFajlovi,
        command: task.data.code_test,
        at: now(),
        stdout: String(test.stdout).slice(0, 1500),
        stderr: String(test.stderr).slice(0, 500),
      };
    } finally {
      await ukloniStablo(root, baza);
    }
  }

  async function zapisiNalaz(id, ime, naslov, telo) {
    const rel = path.join('tasks', 'reviews', `${id}-${ime}.md`);
    await writeFileAtomic(path.join(config.root, rel), [
      '---',
      `title: ${naslov}`,
      `created: ${now()}`,
      `updated: ${now()}`,
      'authors: [agentctl]',
      'status: review',
      `tags: [${id}, code]`,
      '---',
      '',
      telo,
      '',
    ].join('\n'));
    return rel;
  }

  /** Vrati zadatak u `ready` (može novi pokušaj) ili u `blocked` kad su iscrpljeni. */
  async function odbij(id, ev, razlog, token) {
    const pokusaji = Number(ev.pokusaji ?? 0) + 1;
    const dokaz = { ...ev, pokusaji, poslednji_razlog: razlog };
    await store.setFields(id, { code_evidence: dokaz }, { actor: OWNER, note: razlog });
    if (pokusaji >= MAX_POKUSAJA) {
      await store.release(id, OWNER, { toStatus: 'ready', token, note: razlog }).catch(() => {});
      await store.setFields(id, { blocked_reason: razlog }, { actor: 'agentctl', note: 'iscrpljeni pokušaji' });
      await store.transition(id, 'blocked', { actor: 'agentctl', note: razlog });
      await store.emit('code.blocked', { task: id, reason: razlog, attempts: pokusaji });
      logger(`code: ${id} -> blocked (${razlog})`);
      return { phase: 'code', task: id, ok: false, reason: razlog, attempts: pokusaji };
    }
    await store.release(id, OWNER, { toStatus: 'ready', token, note: `odbijeno: ${razlog}` });
    await store.emit('code.rejected', { task: id, reason: razlog, attempts: pokusaji });
    logger(`code: ${id} -> ready (${razlog}), pokušaj ${pokusaji}/${MAX_POKUSAJA}`);
    return { phase: 'code', task: id, ok: false, reason: razlog, attempts: pokusaji };
  }


  /**
   * Memorija zadatka ide iz wiki-ja u radno stablo kao `MEMORY.md`.
   *
   * Ovo je JEDINI smer u kojem wiki ulazi u coding zadatak: agent ga čita, ali
   * ga ne menja (fajl je van `code_scope` i ne komituje se). Zaštite wiki-ja se
   * time ne diraju — nema nove dozvole za pisanje po memoriji.
   */
  async function eksportujMemoriju(task, dir) {
    const notes = task.data.code_memory ?? [];
    if (!notes.length) return null;
    const delovi = [
      '# Memorija zadatka (iz wiki-ja, samo za čitanje)',
      '',
      'Ovaj fajl je kontekst koji je kontrolni sloj izvezao iz baze znanja.',
      'Ne menjaj ga i ne komituj: nije deo tvog zadatka.',
      '',
    ];
    for (const rel of notes) {
      try {
        const n = await readNote(config.root, rel);
        delovi.push(`## ${n.frontmatter?.title ?? rel}`, '', `_izvor: ${rel}_`, '', n.body.trim(), '');
      } catch {
        delovi.push(`## ${rel}`, '', '_(beleška nije dostupna u bazi znanja)_', '');
      }
    }
    const telo = delovi.join('\n');
    await fs.writeFile(path.join(dir, 'MEMORY.md'), telo, 'utf8');
    return { notes: [...notes], file: 'MEMORY.md', bytes: Buffer.byteLength(telo) };
  }

  /**
   * Zapis o prihvaćenoj promeni u wiki. Piše ga KONTROLNI SLOJ (`agentctl`),
   * tek posle prihvatanja, iz evidencije zadatka — radni agent nema pristup
   * `wiki/`-ju.
   */
  async function upisiZapisUMemoriju(id, task, ev) {
    const rel = `wiki/Izmene/${id}.md`;
    const zahtev = (() => {
      const m = /## Zahtev\n+([\s\S]*?)(?=\n## |$)/.exec(task.body ?? '');
      return (m?.[1] ?? task.body ?? '').trim();
    })();
    const sada = now();
    const izmene = ev.implement?.files ?? [];
    const telo = [
      `# ${task.data.title} (${id})`,
      '',
      '## Zahtev',
      '',
      zahtev,
      '',
      '## Ishod',
      '',
      `- ciljni repozitorijum: \`${task.data.code_target}\``,
      `- početna revizija: \`${task.data.code_base}\``,
      `- popravka: \`${ev.implement?.commit ?? '—'}\``,
      `- prihvaćeno: \`${ev.accept?.merge ?? '—'}\``,
      `- izmene: ${izmene.map((f) => `\`${f}\``).join(', ') || '—'}`,
      '',
      '## Dokazi',
      '',
      `- reprodukcija pre popravke: \`${ev.reproduce?.command ?? '—'}\` → exit ${ev.reproduce?.exitCode ?? '—'}`,
      `- provera posle popravke: \`${ev.check?.command ?? '—'}\` → exit ${ev.check?.exitCode ?? '—'}`,
      `- regresioni test na početnoj reviziji: exit ${ev.baseline?.exitCode ?? '—'}`,
      `- nezavisan pregled: ${ev.review?.harness ?? '—'} (verdikt: ${ev.review?.verdict ?? '—'})`,
      ev.memory ? `- memorija korišćena: ${(ev.memory.notes ?? []).join(', ')}` : '- memorija korišćena: (nema)',
      '',
      '## Veze',
      '',
      '- [[Index]]',
      '',
    ].join('\n');
    await writeNote(config.root, rel, {
      frontmatter: {
        title: `${task.data.title} (${id})`,
        created: task.data.created ?? sada,
        updated: sada,
        authors: ['agentctl', ev.implement?.author ?? 'dsh', ev.review?.harness ?? 'reviewer'].filter(Boolean),
        status: 'consolidated',
        tags: ['izmena', 'code', id],
      },
      body: telo,
    });
    await commitPaths(config.root, ['wiki'], `agentctl: zapis o izmeni ${id} u memoriju`, { actor: 'agentctl' });
    return rel;
  }

  // ------------------------------------------------------- 1+2+3: izmena

  async function fazaIzrade(id, task, root, ev) {
    const claim = await store.claim(id, OWNER);
    const token = claim.leaseToken;
    let dir = null;
    try {
      await git(root, ['worktree', 'prune'], { actor: OWNER, allowFailure: true });
      await git(root, ['branch', '-D', granaZa(id)], { actor: OWNER, allowFailure: true });
      dir = await napraviStablo(root, id, { rev: task.data.code_base, grana: granaZa(id) });

      // 1. reprodukcija — kratka komanda koja PADA dok je bug prisutan. Cela
      // test suite nije dokaz reprodukcije: bug često nije pokriven testovima.
      const reproKomanda = task.data.code_repro ?? task.data.code_test;
      const pre = await pokreniTest(dir, reproKomanda);
      ev = { ...ev, reproduce: { command: reproKomanda, exitCode: pre.exitCode, base: task.data.code_base, at: now() } };
      await store.setFields(id, { code_evidence: ev }, { actor: OWNER, note: 'reprodukcija problema' });
      if (pre.exitCode === 0) return await odbij(id, ev, `bug se ne reprodukuje: "${reproKomanda}" prolazi na ${task.data.code_base}`, token);
      logger(`code: ${id} reprodukcija OK (repro pada na ${String(task.data.code_base).slice(0, 8)})`);

      // 2. izmena koda — prvo memorija iz wiki-ja (samo za čitanje)
      const memorija = await eksportujMemoriju(task, dir);
      if (memorija) {
        ev = { ...ev, memory: memorija };
        await store.setFields(id, { code_evidence: ev }, { actor: OWNER, note: `memorija: ${memorija.notes.join(', ')}` });
        logger(`code: ${id} memorija izvezena (${memorija.notes.length} beleške, ${memorija.bytes} B)`);
      }
      const prompt = await buildPrompt(config, {
        role: ROLE_IMPLEMENT,
        task,
        extra: {
          worktree: dir,
          instructions: [
            '## Programski zahtev',
            '',
            task.body.trim(),
            '',
            '## Pravila',
            '',
            `- Dozvoljen opseg u ovom repozitorijumu: ${(task.data.code_scope ?? []).join(', ')}`,
            `- Komanda koja proverava rezultat: \`${task.data.code_test}\``,
            '- Napiši popravku I regresioni test koji na početnoj reviziji PADA, a posle popravke prolazi.',
            '- Ne menjaj postojeće testove da bi prošli i ne dodaj preskakanje (skip/todo).',
            '- Ne izlazi iz dozvoljenog opsega i ne diraj ništa van ovog radnog stabla.',
          ].join('\n'),
        },
      });
      const spec = config.agents?.[ROLE_IMPLEMENT] ?? {};
      const autor = identityFor(config, ROLE_IMPLEMENT);
      const rezultat = await runAgent(config, { role: ROLE_IMPLEMENT, task, cwd: dir, prompt, now: now(), logger });
      ev = { ...ev, implement: { harness: rezultat.harness, exitCode: rezultat.exitCode, at: now() } };
      if (!rezultat.ok) return await odbij(id, ev, `programer nije uspeo (exit ${rezultat.exitCode})`, token);

      // kapija opsega PRE ičega drugog
      const izmene = await izmeneU(dir, task.data.code_base);
      const vanOpsega = izmene.filter((rel) => !matchesScope(rel, task.data.code_scope ?? []));
      ev = { ...ev, implement: { ...ev.implement, files: izmene, outside: vanOpsega } };
      if (vanOpsega.length) return await odbij(id, ev, `izmena van dozvoljenog opsega: ${vanOpsega.join(', ')}`, token);
      if (!izmene.length) return await odbij(id, ev, 'programer nije napravio nijednu izmenu', token);
      const testFajlovi = izmene.filter((rel) => TEST_RE.test(rel));
      if (!testFajlovi.length) return await odbij(id, ev, 'nema regresionog testa u izmenama', token);

      await git(dir, ['add', '-A'], { actor: OWNER });
      const staged = (await git(dir, ['diff', '--cached', '--name-only'], { allowFailure: true })).stdout.trim();
      // Ako je agent ipak sam komitovao, ne pravimo prazan commit — HEAD je već
      // njegov rad.
      if (staged) {
        await git(dir, ['-c', `user.name=${autor}`, '-c', `user.email=${autor}@agent-2.0.local`, 'commit', '-q', '-m', `programer(${id}): popravka`], { actor: OWNER });
      }
      const commit = (await git(dir, ['rev-parse', 'HEAD'])).stdout;
      ev = { ...ev, implement: { ...ev.implement, commit, author: autor } };
      logger(`code: ${id} izmena ${commit.slice(0, 8)} (${izmene.length} fajlova)`);

      // 3. testiranje posle popravke: i propisana suite i reprodukciona komanda
      const posle = await pokreniTest(dir, task.data.code_test);
      const reproPosle = task.data.code_repro ? await pokreniTest(dir, task.data.code_repro) : posle;
      ev = {
        ...ev,
        check: {
          command: task.data.code_test,
          exitCode: posle.exitCode,
          reproCommand: task.data.code_repro ?? null,
          reproExitCode: reproPosle.exitCode,
          at: now(),
        },
      };
      if (posle.exitCode !== 0 || reproPosle.exitCode !== 0) {
        return await odbij(id, ev, `test ne prolazi posle popravke (suite ${posle.exitCode}, repro ${reproPosle.exitCode})`, token);
      }

      // dokaz 1: regresioni test pada na početnoj reviziji
      const osnova = await dokaziPadNaOsnovi(root, task, testFajlovi, dir);
      ev = { ...ev, baseline: osnova };
      if (osnova.exitCode === 0) return await odbij(id, ev, 'regresioni test ne pada na početnoj reviziji (ne reprodukuje bug)', token);

      await store.setFields(id, { code_evidence: ev }, { actor: OWNER, note: 'popravka + testovi + dokaz pada na osnovi' });
      await store.setArtifacts(id, izmene, { actor: OWNER, note: `izmene: ${izmene.join(', ')}` });
      await store.release(id, OWNER, { toStatus: 'verified', token, note: `popravka ${commit.slice(0, 8)}` });
      await store.emit('code.implemented', { task: id, commit, files: izmene });
      logger(`code: ${id} -> verified (test prolazi posle popravke, pada pre)`);
      return { phase: 'code', task: id, ok: true, step: 'implement', commit };
    } finally {
      if (dir) await ukloniStablo(root, dir);
    }
  }

  // ------------------------------------------------------- 4: nezavisan pregled

  async function fazaPregleda(id, task, root, ev) {
    const claim = await store.claim(id, OWNER);
    const token = claim.leaseToken;
    let dir = null;
    try {
      const grana = granaZa(id);
      dir = await napraviStablo(root, id, { rev: grana });
      const diff = await git(dir, ['diff', `${task.data.code_base}..HEAD`], { allowFailure: true });
      const izmene = (await git(dir, ['diff', '--name-only', `${task.data.code_base}..HEAD`])).stdout.split('\n').filter(Boolean);
      const prompt = await buildPrompt(config, {
        role: ROLE_REVIEW,
        task,
        extra: {
          worktree: dir,
          instructions: [
            '## Programski zahtev',
            '',
            task.body.trim(),
            '',
            '## Diff koji pregledaš',
            '',
            '\u0060\u0060\u0060diff',
            diff.stdout.slice(0, 60000),
            '\u0060\u0060\u0060',
            '',
            '## Pravila',
            '',
            `- Izmene: ${izmene.join(', ')} (opseg zadatka: ${(task.data.code_scope ?? []).join(', ')})`,
            `- Komanda provere: \`${task.data.code_test}\``,
            '- Napravi SOPSTVENI granični slučaj (fajl u ovom radnom stablu) i izvrši ga; ne veruj tuđem testu.',
            '- Proveri da regresioni test nije oslabljen, preskočen ni prilagođen pogrešnom ponašanju.',
            `- Nalaz napiši u .agent-review/${id}.md i završi sa \`VERDICT: pass\` ili \`VERDICT: fail\`.`,
            '- Ne popravljaj kod; samo pregledaj i dokaži.',
          ].join('\n'),
        },
      });
      const rezultat = await runAgent(config, { role: ROLE_REVIEW, task, cwd: dir, prompt, now: now(), logger });
      // Reviewer-ov SOPSTVENI scenario je dokaz: čuva se uz evidenciju PRE nego
      // što se radno stablo obriše, inače ostaje samo opis u nalazu.
      const scenarioDir = path.join(config.paths.reviews, `${id}-review`);
      await fs.rm(scenarioDir, { recursive: true, force: true });
      const agentReview = path.join(dir, '.agent-review');
      if (await exists(agentReview)) {
        await fs.mkdir(scenarioDir, { recursive: true });
        // `walkFiles` vraća RELATIVNE putanje u odnosu na koren.
        for (const rel of await walkFiles(agentReview)) {
          const cilj = path.join(scenarioDir, rel);
          await fs.mkdir(path.dirname(cilj), { recursive: true });
          await fs.copyFile(path.join(agentReview, rel), cilj);
        }
      }
      const put = path.join(dir, '.agent-review', `${id}.md`);
      const imaNalaz = await exists(put);
      const telo = imaNalaz ? await fs.readFile(put, 'utf8') : `_Nema nalaza; harnes izlaz:\n\n${String(rezultat.output).slice(0, 4000)}_`;
      const rel = await zapisiNalaz(id, 'review', `Nezavisan pregled ${id}`, telo);
      ev = { ...ev, review: { harness: rezultat.harness, verdict: rezultat.verdict ?? null, exitCode: rezultat.exitCode, file: rel, at: now() } };
      await store.setFields(id, { code_evidence: ev }, { actor: OWNER, note: `nezavisan pregled (${rezultat.harness})` });
      if (!imaNalaz || !rezultat.ok || rezultat.verdict === 'fail') {
        return await odbij(id, ev, `nezavisan pregled nije prošao (verdikt: ${rezultat.verdict ?? 'nema'})`, token);
      }
      await store.release(id, OWNER, { toStatus: 'verified', token, note: `nezavisan pregled: ${rezultat.verdict}` });
      await store.emit('code.reviewed', { task: id, harness: rezultat.harness, verdict: rezultat.verdict, file: rel });
      logger(`code: ${id} nezavisan pregled ${rezultat.harness} -> ${rezultat.verdict}`);
      return { phase: 'code', task: id, ok: true, step: 'review', verdict: rezultat.verdict };
    } finally {
      if (dir) await ukloniStablo(root, dir);
    }
  }

  // ------------------------------------------------------- 5: prihvatanje

  async function fazaPrihvatanja(id, task, root, ev) {
    const claim = await store.claim(id, OWNER);
    const token = claim.leaseToken;
    try {
      const grana = granaZa(id);
      const trenutna = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
      if (trenutna !== 'main' && trenutna !== 'master') {
        return await odbij(id, ev, `glavna grana ciljnog repoa je "${trenutna}"`, token);
      }
      const prljavo = (await git(root, ['status', '--porcelain'])).stdout.trim();
      if (prljavo) return await odbij(id, ev, 'ciljni repo je prljav pre prihvatanja', token);

      const merge = await git(root, ['merge', '--no-ff', '-m', `agentctl(${id}): prihvacena popravka`, grana], { actor: OWNER, allowFailure: true });
      if (merge.code !== 0) {
        await git(root, ['merge', '--abort'], { actor: OWNER, allowFailure: true });
        return await odbij(id, ev, `merge nije prošao: ${merge.stderr.split('\n')[0]}`, token);
      }
      const sha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
      await git(root, ['tag', '-f', `dokaz/${id}-accept`, sha], { actor: OWNER, allowFailure: true });
      ev = { ...ev, accept: { merge: sha, branch: grana, at: now() } };
      // Zadatak vraća ishod u memoriju; piše kontrolni sloj, ne agent.
      try {
        ev.memory_write = await upisiZapisUMemoriju(id, task, ev);
        logger(`code: ${id} zapis u memoriju: ${ev.memory_write}`);
      } catch (error) {
        logger(`code: ${id} zapis u memoriju nije uspeo: ${error.message}`);
      }
      await store.setFields(id, { code_evidence: ev }, { actor: OWNER, note: `prihvaćeno: ${sha.slice(0, 8)}` });
      await store.transition(id, 'consolidated', { actor: 'agentctl', note: `merge ${sha.slice(0, 8)}` });
      await store.emit('code.accepted', { task: id, merge: sha, branch: grana });
      logger(`code: ${id} -> prihvaćeno u ${trenutna} @ ${sha.slice(0, 8)}`);
      return { phase: 'code', task: id, ok: true, step: 'accept', merge: sha };
    } finally {
      void token;
    }
  }

  // ------------------------------------------------------- ulaz

  async function runCodeTask(id) {
    const task = await store.get(id);
    if ((task.data.kind ?? '') !== 'code') {
      throw new CodingError(`${id} nije coding zadatak (kind: ${task.data.kind ?? 'ingest'})`, 'NOT_CODE');
    }
    const root = await proveriCilj(task);
    const ev = { ...(task.data.code_evidence ?? {}) };
    if (!ev.implement) return await fazaIzrade(id, task, root, ev);
    if (!ev.review) return await fazaPregleda(id, task, root, ev);
    if (!ev.accept) return await fazaPrihvatanja(id, task, root, ev);
    return { phase: 'code', task: id, ok: true, step: 'done', merge: ev.accept?.merge ?? null };
  }

  async function dodajCodeZadatak({
    title, requirement, target, base, scope, testCommand, reproCommand = null,
    memory = [], tags = [], priority = 'normal',
  }) {
    if (!title) throw new CodingError('code zadatak zahteva naslov', 'NO_TITLE');
    if (!requirement || String(requirement).trim().length < 10) {
      throw new CodingError('code zadatak zahteva zahtev (tekst zadatka)', 'NO_REQUIREMENT');
    }
    const id = await nextTaskId(config);
    const { data, body } = newTaskData({
      id,
      title,
      kind: 'code',
      codeTarget: path.resolve(String(target)),
      codeBase: base,
      codeScope: scope,
      codeTest: testCommand,
      codeRepro: reproCommand,
      // Beleške iz wiki-ja koje zadatak dobija kao kontekst (samo za čitanje).
      codeMemory: memory,
      tags,
      priority,
      extractRequired: false,
      now: now(),
      body: defaultBody(title, String(requirement).trim()),
    });
    // provera cilja odmah, pre nego što zadatak uopšte uđe u petlju
    await proveriCilj({ data });
    await writeTaskFile(path.join(config.inbox, `${id}.md`), data, body);
    await store.emit('task.code', { task: id, target: data.code_target, base, scope, test: testCommand });
    await store.transition(id, 'ready', { actor: 'agentctl', note: `coding zadatak (osnova ${String(base).slice(0, 8)})` });
    logger(`code: ${id} (${title}) za ${data.code_target}`);
    return store.get(id);
  }

  return { runCodeTask, dodajCodeZadatak, proveriCilj };
}
