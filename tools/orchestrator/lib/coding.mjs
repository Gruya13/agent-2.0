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
import { holdsLease } from './lease.mjs';
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
    const realno = async (p) => { try { return await fs.realpath(p); } catch { return path.resolve(p); } };
    // Simbolički link može da pokaže na kontrolni repo, pa se poredi REALNA
    // putanja, ne samo tekst.
    const root = await realno(String(task.data.code_target));
    const kontrolni = await realno(config.root);
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
      // Greška PRI POKRETANJU (npr. ENOENT: komanda ne postoji) nije izlazni
      // kod procesa. Pretvorena u 1, izgleda kao "test je pao", pa bi faza
      // reprodukcije prihvatila nepostojeću komandu kao dokaz buga.
      const spawnError = Number.isInteger(error.code) ? null : String(error.code ?? error.message ?? 'spawn-error');
      return {
        exitCode: spawnError === null ? Number(error.code) : null,
        spawnError,
        stdout: String(error.stdout ?? ''),
        stderr: String(error.stderr ?? error.message),
        durationMs: Date.now() - started,
        timedOut: error.killed === true || error.signal === 'SIGTERM',
      };
    }
  }

/**
   * Izvrši posao DRŽEĆI zakup živim.
   *
   * Coding tok poziva harnes i test komande direktno, pa bez ovoga dug poziv
   * ostavlja zakup da istekne (dokazano kontrolnim testom R2). Obnavljanje ide
   * kroz isti `store.renew` koji koristi dokumentni tok; ovde nema nove
   * infrastrukture. Ako obnova ne uspe, zakup je stvarno izgubljen i posao se ne
   * sme nastaviti kao uspešan.
   */
  async function saZakupom(id, token, fn) {
    let greska = null;
    const period = Math.max(50, Number(config.lease?.heartbeatMs ?? 2000));
    const timer = setInterval(() => {
      store.renew(id, OWNER, { token }).catch((error) => { greska = greska ?? error; });
    }, period);
    timer.unref?.();
    try {
      const rezultat = await fn();
      return { rezultat, izgubljen: greska };
    } catch (error) {
      return { rezultat: null, izgubljen: greska, error };
    } finally {
      clearInterval(timer);
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
   * Ukloni zaostala radna stabla ovog zadatka (posle naglog prekida procesa).
   * `git worktree prune` sam ne uklanja stablo koje još postoji na disku.
   */
  async function ocistiZaostalaStabla(root, id) {
    const lista = (await git(root, ['worktree', 'list', '--porcelain'], { allowFailure: true })).stdout;
    for (const blok of lista.split(/\n{2,}/).filter(Boolean)) {
      const dir = /^worktree (.+)$/m.exec(blok)?.[1];
      const branch = /^branch (.+)$/m.exec(blok)?.[1];
      if (!dir) continue;
      const nas = (branch && branch.endsWith(`/code/${id}`))
        || path.basename(dir).startsWith(`agent2-code-${id}-`);
      if (!nas) continue;
      await git(root, ['worktree', 'remove', '--force', dir], { actor: OWNER, allowFailure: true });
      await fs.rm(dir, { recursive: true, force: true });
    }
    await git(root, ['worktree', 'prune'], { actor: OWNER, allowFailure: true });
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
      // Pomoćni kontekst kontrolnog sloja nije deo zadatka.
      .filter((rel) => !rel.startsWith('.agent-context/'));
  }

  /**
   * Vrsta pada na osnovi. Dokaz buga je samo `assertion`: greška importa,
   * sintakse ili timeout znače da test nije ni proverio ponašanje.
   */
  function klasifikujPad(test) {
    // (izvezeno za testiranje klasifikacije)
    const tekst = `${test.stdout ?? ''}\n${test.stderr ?? ''}`;
    // Prekid ima prioritet nad svim ostalim: i `timeout(1)` daje 124, a izlaz
    // može da sadrži i prethodnu assertion poruku (Codex: takav pad je prošao).
    if (test.timedOut || test.exitCode === 124 || /Command timed out|timed out after/.test(tekst)) return 'timeout';
    // Komanda koja se nije pokrenula nije pad testa; nikad nije dokaz buga.
    if (test.spawnError) return 'error';
    // Greške izvršavanja idu PRVE: `node --test` obeležava i njih sa ✖, pa se
    // ✖ ne sme koristiti kao dokaz tvrdnje (Codex: TypeError je prošao kao assertion).
    if (/SyntaxError|TypeError|ReferenceError|RangeError|Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM/.test(tekst)) return 'error';
    if (/AssertionError|ERR_ASSERTION/.test(tekst)) return 'assertion';
    // Node 26 podrazumevani runner za grešku učitavanja test fajla ispisuje SAMO
    // 'test failed' (bez AssertionError). To nije tvrdnja o ponašanju nego greška
    // izvršavanja, pa se ne sme prihvatiti kao dokaz buga.
    if (/'test failed'|\btest failed\b/.test(tekst)) return 'error';
    return 'unknown';
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
        spawnError: test.spawnError ?? null,
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
    // Nikad u projektni `MEMORY.md`: to može biti legitiman fajl ciljnog projekta.
    const rel = path.join('.agent-context', 'MEMORY.md');
    await fs.mkdir(path.join(dir, '.agent-context'), { recursive: true });
    await fs.writeFile(path.join(dir, rel), telo, 'utf8');
    return { notes: [...notes], file: rel.split(path.sep).join('/'), bytes: Buffer.byteLength(telo) };
  }

  /**
   * Zapis o prihvaćenoj promeni u wiki. Piše ga KONTROLNI SLOJ (`agentctl`),
   * tek posle prihvatanja, iz evidencije zadatka — radni agent nema pristup
   * `wiki/`-ju.
   */
  async function upisiZapisUMemoriju(id, task, ev) {
    const rel = `wiki/Izmene/${id}.md`;
    // Postojeća beleška na istoj putanji se NE prepisuje: to može biti tuđe
    // znanje ili raniji zapis drugog zadatka (nalaz iz Codex-ovog scenarija
    // 'code-collision'). Naš zapis nosi marker, pa je ponovni pokušaj dozvoljen.
    const marker = `<!-- agentctl: zapis o izmeni ${id} -->`;
    try {
      const postojeci = await readNote(config.root, rel);
      if (!String(postojeci.body ?? '').includes(marker)) {
        throw new CodingError(
          `putanja ${rel} je zauzeta postojećom beleškom; zapis ne prepisuje tuđe znanje`,
          'MEMORY_PATH_TAKEN',
        );
      }
    } catch (error) {
      if (error instanceof CodingError) throw error;
      // Beleška ne postoji (ili nije čitljiva kao beleška) — slobodna je.
    }
    const zahtev = (() => {
      const m = /## Zahtev\n+([\s\S]*?)(?=\n## |$)/.exec(task.body ?? '');
      return (m?.[1] ?? task.body ?? '').trim();
    })();
    const sada = now();
    const izmene = ev.implement?.files ?? [];
    const telo = [
      marker,
      '',
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
    // Komituje se TAČNO ova beleška. `['wiki']` bi kroz `git add -A` povukao i
    // tuđe nekomitovane izmene u wiki-ju (potvrđeno testom W1).
    const commit = await commitPaths(config.root, [rel], `agentctl: zapis o izmeni ${id} u memoriju`, { actor: 'agentctl' });
    if (commit.lockCleared) {
      // Dokumentuj da je uklonjen zaostali git lock (posle naglog prekida), da
      // oporavak ne bude tih.
      await store.updateBody(id, {
        actor: 'agentctl',
        append: `### Uklonjen zaostali git index.lock (${now()})\n\nPrethodni proces je prekinut tokom git upisa; lock nije nestao posle 2 s i uklonjen je pre zapisa.`,
        note: 'zaostali git index.lock uklonjen',
      });
    }
    return rel;
  }

  // ------------------------------------------------------- 1+2+3: izmena

  async function fazaIzrade(id, task, root, ev) {
    const claim = await store.claim(id, OWNER);
    const token = claim.leaseToken;
    let dir = null;
    // Neuspeo pokušaj ne sme da ostavi granu iza sebe (nalaz W6): nastavak
    // treba da počne od čistog stanja, bez ostataka prethodnog rada.
    let uspesno = false;
    // `implement` se upisuje u evidenciju TEK kada izrada uspe. Bez toga bi
    // neuspeo pokušaj ostavio "implement" i nastavak bi pogrešno otišao na
    // pregled grane koja ne postoji (nalaz W6).
    let impl = null;
    try {
      // Nagli prekid (SIGKILL) ne izvršava `finally`: zaostaje radno stablo i
      // grana. Bez ovog čišćenja nastavak pada na "already used by worktree".
      await ocistiZaostalaStabla(root, id);
      await git(root, ['branch', '-D', granaZa(id)], { actor: OWNER, allowFailure: true });
      dir = await napraviStablo(root, id, { rev: task.data.code_base, grana: granaZa(id) });

      // 1. reprodukcija — kratka komanda koja PADA dok je bug prisutan. Cela
      // test suite nije dokaz reprodukcije: bug često nije pokriven testovima.
      const reproKomanda = task.data.code_repro ?? task.data.code_test;
      const pre = await pokreniTest(dir, reproKomanda);
      ev = { ...ev, reproduce: { command: reproKomanda, exitCode: pre.exitCode, spawnError: pre.spawnError ?? null, base: task.data.code_base, at: now() } };
      await store.setFields(id, { code_evidence: ev }, { actor: OWNER, note: 'reprodukcija problema' });
      if (pre.spawnError) {
        return await odbij(id, ev, `repro komanda se nije pokrenula (${pre.spawnError}): "${reproKomanda}" — to nije pad testa i ne dokazuje bug`, token);
      }
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
      const autor = identityFor(config, ROLE_IMPLEMENT);
      // Zakup se obnavlja dok traje poziv: bez toga dug poziv ostavlja zadatak
      // bez važećeg zakupa (kontrolni test R2).
      const poziv = await saZakupom(id, token, () => runAgent(config, { role: ROLE_IMPLEMENT, task, cwd: dir, prompt, now: now(), logger }));
      if (poziv.error) throw poziv.error;
      if (poziv.izgubljen) {
        return await odbij(id, ev, `zakup je izgubljen tokom poziva programera: ${poziv.izgubljen.message}`, token);
      }
      const rezultat = poziv.rezultat;
      impl = { harness: rezultat.harness, exitCode: rezultat.exitCode, at: now() };
      if (!rezultat.ok) return await odbij(id, ev, `programer nije uspeo (exit ${rezultat.exitCode})`, token);

      // kapija opsega PRE ičega drugog
      const izmene = await izmeneU(dir, task.data.code_base);
      const vanOpsega = izmene.filter((rel) => !matchesScope(rel, task.data.code_scope ?? []));
      impl = { ...impl, files: izmene, outside: vanOpsega };
      if (vanOpsega.length) {
        // Dijagnostika ostaje u evidenciji i kada `implement` nije upisan.
        ev = { ...ev, outside_scope: vanOpsega };
        return await odbij(id, ev, `izmena van dozvoljenog opsega: ${vanOpsega.join(', ')}`, token);
      }
      if (!izmene.length) return await odbij(id, ev, 'programer nije napravio nijednu izmenu', token);
      const testFajlovi = izmene.filter((rel) => TEST_RE.test(rel));
      if (!testFajlovi.length) return await odbij(id, ev, 'nema regresionog testa u izmenama', token);

      // Postojeći testovi se NE smeju menjati: dozvoljeni su samo NOVI test
      // fajlovi. Bez ovoga bi "popravka" mogla da oslabi tuđi test.
      const izmenjeniPostojeci = [];
      for (const rel of testFajlovi) {
        const naOsnovi = await git(dir, ['cat-file', '-e', `${task.data.code_base}:${rel}`], { allowFailure: true });
        if (naOsnovi.code === 0) izmenjeniPostojeci.push(rel);
      }
      if (izmenjeniPostojeci.length) {
        ev = { ...ev, changed_existing_tests: izmenjeniPostojeci };
        return await odbij(id, ev, `postojeći testovi su menjani: ${izmenjeniPostojeci.join(', ')}`, token);
      }
      // Nova preskakanja u novim testovima nisu dokaz. Čita se RADNO stablo:
      // fajl je u ovom trenutku još nekomitovan.
      for (const rel of testFajlovi) {
        const sadrzaj = await fs.readFile(path.join(dir, rel), 'utf8').catch(() => '');
        const PRESKAKANJE = /\.(skip|todo)\s*\(|\[\s*['"`](skip|todo)['"`]\s*\]|\b(skip|todo)\s*:\s*true/;
        if (PRESKAKANJE.test(sadrzaj)) {
          return await odbij(id, ev, `regresioni test sadrži preskakanje: ${rel}`, token);
        }
      }

      // Pomoćni fajl kontrolnog sloja se UKLANJA pre komita: `MEMORY.md` je
      // kontekst, ne deo zadatka. (`git add -A` ga je inače nosio u granu i u
      // merge — dokazano stvarnim prolazom.)
      await fs.rm(path.join(dir, '.agent-context'), { recursive: true, force: true });
      await git(dir, ['add', '-A'], { actor: OWNER });
      const staged = (await git(dir, ['diff', '--cached', '--name-only'], { allowFailure: true })).stdout.trim();
      // Ako je agent ipak sam komitovao, ne pravimo prazan commit — HEAD je već
      // njegov rad.
      if (staged) {
        await git(dir, ['-c', `user.name=${autor}`, '-c', `user.email=${autor}@agent-2.0.local`, 'commit', '-q', '-m', `programer(${id}): popravka`], { actor: OWNER });
      }
      const commit = (await git(dir, ['rev-parse', 'HEAD'])).stdout;
      impl = { ...impl, commit, author: autor };
      logger(`code: ${id} izmena ${commit.slice(0, 8)} (${izmene.length} fajlova)`);

      // 3. testiranje posle popravke: i propisana suite i reprodukciona komanda.
      // Test komande umeju da traju dugo, pa i one idu pod obnovljenim zakupom.
      const testiranje = await saZakupom(id, token, async () => {
        const posle = await pokreniTest(dir, task.data.code_test);
        const reproPosle = task.data.code_repro ? await pokreniTest(dir, task.data.code_repro) : posle;
        return { posle, reproPosle };
      });
      if (testiranje.error) throw testiranje.error;
      if (testiranje.izgubljen) {
        return await odbij(id, ev, `zakup je izgubljen tokom testiranja: ${testiranje.izgubljen.message}`, token);
      }
      const { posle, reproPosle } = testiranje.rezultat;
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
      if (posle.spawnError || reproPosle.spawnError) {
        return await odbij(id, ev, `komanda se nije pokrenula posle popravke (suite ${posle.spawnError ?? 'ok'}, repro ${reproPosle.spawnError ?? 'ok'})`, token);
      }
      if (posle.exitCode !== 0 || reproPosle.exitCode !== 0) {
        return await odbij(id, ev, `test ne prolazi posle popravke (suite ${posle.exitCode}, repro ${reproPosle.exitCode})`, token);
      }

      // dokaz 1: regresioni test pada na početnoj reviziji
      // I baseline provera pokreće test komandu, pa i ona ide pod obnovljenim
      // zakupom (Codex: sa TTL 400 ms i dugom proverom zakup je istekao).
      const baselineProba = await saZakupom(id, token, () => dokaziPadNaOsnovi(root, task, testFajlovi, dir));
      if (baselineProba.error) throw baselineProba.error;
      if (baselineProba.izgubljen) {
        return await odbij(id, ev, `zakup je izgubljen tokom provere na osnovi: ${baselineProba.izgubljen.message}`, token);
      }
      const osnova = baselineProba.rezultat;
      ev = { ...ev, baseline: osnova };
      if (osnova.exitCode === 0) return await odbij(id, ev, 'regresioni test ne pada na početnoj reviziji (ne reprodukuje bug)', token);
      // Pad na osnovi mora biti zbog OČEKIVANOG pogrešnog ponašanja: greška
      // importa, sintaksa ili timeout nisu dokaz reprodukovanog buga.
      const klasa = klasifikujPad(osnova);
      ev = { ...ev, baseline: { ...osnova, failure_kind: klasa } };
      if (klasa !== 'assertion') {
        return await odbij(id, ev, `pad na osnovi nije tvrdnja o ponašanju (vrsta: ${klasa})`, token);
      }

      ev = { ...ev, implement: impl };
      await store.setFields(id, { code_evidence: ev }, { actor: OWNER, note: 'popravka + testovi + dokaz pada na osnovi' });
      await store.setArtifacts(id, izmene, { actor: OWNER, note: `izmene: ${izmene.join(', ')}` });
      await store.release(id, OWNER, { toStatus: 'verified', token, note: `popravka ${commit.slice(0, 8)}` });
      await store.emit('code.implemented', { task: id, commit, files: izmene });
      logger(`code: ${id} -> verified (test prolazi posle popravke, pada pre)`);
      uspesno = true;
      return { phase: 'code', task: id, ok: true, step: 'implement', commit };
    } finally {
      if (dir) await ukloniStablo(root, dir);
      if (!uspesno) await git(root, ['branch', '-D', granaZa(id)], { actor: OWNER, allowFailure: true });
    }
  }

  // ------------------------------------------------------- 4: nezavisan pregled

  async function fazaPregleda(id, task, root, ev) {
    const claim = await store.claim(id, OWNER);
    const token = claim.leaseToken;
    let dir = null;
    try {
      const grana = granaZa(id);
      // Nezavisnost nije stvar naziva uloge: reviewer mora biti DRUGI vendor od
      // autora popravke, inače "nezavisan pregled" to nije.
      const autorPopravke = ev.implement?.author ?? identityFor(config, ROLE_IMPLEMENT);
      const vendorPregleda = identityFor(config, ROLE_REVIEW);
      if (vendorPregleda === autorPopravke) {
        return await odbij(id, ev, `reviewer i autor popravke su isti vendor (${vendorPregleda})`, token);
      }
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
      const poziv = await saZakupom(id, token, () => runAgent(config, { role: ROLE_REVIEW, task, cwd: dir, prompt, now: now(), logger }));
      if (poziv.error) throw poziv.error;
      if (poziv.izgubljen) {
        return await odbij(id, ev, `zakup je izgubljen tokom pregleda: ${poziv.izgubljen.message}`, token);
      }
      const rezultat = poziv.rezultat;
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
      // Tačno koja revizija je pregledana i na kojoj osnovi — bez toga prihvatanje
      // ne može da dokaže da spaja baš pregledani kod.
      const pregledanSha = (await git(dir, ['rev-parse', 'HEAD'])).stdout.trim();
      const osnovaMain = (await git(root, ['rev-parse', 'main'], { allowFailure: true })).stdout.trim()
        || (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
      ev = {
        ...ev,
        review: {
          harness: rezultat.harness,
          verdict: rezultat.verdict ?? null,
          exitCode: rezultat.exitCode,
          file: rel,
          sha: pregledanSha,
          base: osnovaMain,
          at: now(),
        },
      };
      await store.setFields(id, { code_evidence: ev }, { actor: OWNER, note: `nezavisan pregled (${rezultat.harness})` });
      // Prihvata se SAMO izričit `pass`: izveštaj i exit 0 nisu dovoljni.
      if (!imaNalaz || !rezultat.ok || rezultat.verdict !== 'pass') {
        return await odbij(id, ev, `nezavisan pregled nije dao izričit pass (verdikt: ${rezultat.verdict ?? 'nema'})`, token);
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

  /**
   * Integraciona provera u IZOLOVANOM stablu: spojiti kandidata sa trenutnom
   * glavnom granom i pokrenuti propisanu proveru — PRE nego što se glavna grana
   * uopšte promeni. `merge exit 0` sam po sebi nije dokaz ispravnog rezultata.
   */
  async function integracionaProba(root, { grana, testCommand }) {
    let dir = null;
    try {
      dir = await napraviStablo(root, `${path.basename(root)}-integracija`, { rev: 'main' });
      const merge = await git(dir, ['merge', '--no-ff', '-m', 'integracija (proba)', grana], { actor: OWNER, allowFailure: true });
      if (merge.code !== 0) {
        await git(dir, ['merge', '--abort'], { actor: OWNER, allowFailure: true });
        return { ok: false, reason: `spajanje nije prošlo: ${merge.stderr.split('\n')[0]}`, at: now() };
      }
      const test = await pokreniTest(dir, testCommand);
      const tree = (await git(dir, ['rev-parse', 'HEAD^{tree}'])).stdout.trim();
      return {
        ok: test.exitCode === 0 && !test.spawnError,
        reason: test.spawnError
          ? `integracijska provera se nije pokrenula (${test.spawnError})`
          : test.exitCode === 0 ? null : `zajednički rezultat ne prolazi proveru (exit ${test.exitCode})`,
        exitCode: test.exitCode,
        spawnError: test.spawnError ?? null,
        command: testCommand,
        stdout: String(test.stdout).slice(0, 800),
        tree,
        at: now(),
      };
    } finally {
      if (dir) await ukloniStablo(root, dir);
    }
  }

  async function fazaPrihvatanja(id, task, root, ev) {
    const claim = await store.claim(id, OWNER);
    const token = claim.leaseToken;
    try {
      // 1) Potpuna evidencija: prisustvo polja nije dokaz. Prihvatanje ne sme da
      // se osloni na to da je prethodna faza "prošla".
      const problemi = [];
      if (!(ev.reproduce?.exitCode > 0)) problemi.push('bug nije reprodukovan');
      if (ev.check?.exitCode !== 0) problemi.push('provera posle popravke nije prošla');
      if (!(ev.baseline?.exitCode > 0)) problemi.push('regresioni test nije pao na osnovi');
      if (ev.baseline?.failure_kind && ev.baseline.failure_kind !== 'assertion') {
        problemi.push(`pad na osnovi nije tvrdnja o ponašanju (${ev.baseline.failure_kind})`);
      }
      if (ev.review?.verdict !== 'pass') problemi.push('nema izričitog nezavisnog pass-a');
      if (!ev.review?.sha) problemi.push('nije zabeležena pregledana revizija');
      if (problemi.length) return await odbij(id, ev, `nepotpuna evidencija: ${problemi.join('; ')}`, token);

      // 2) Zakup je i dalje naš, pod istim tokenom.
      const svez = await store.get(id);
      if (!holdsLease(svez.data, OWNER, token)) {
        return await odbij(id, ev, 'zakup nad zadatkom više nije naš (tuđi ili istekao)', token);
      }

      const grana = granaZa(id);
      const trenutna = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
      if (trenutna !== 'main' && trenutna !== 'master') {
        return await odbij(id, ev, `glavna grana ciljnog repoa je "${trenutna}"`, token);
      }
      const prljavo = (await git(root, ['status', '--porcelain'])).stdout.trim();
      if (prljavo) return await odbij(id, ev, 'ciljni repo je prljav pre prihvatanja', token);

      // 3) Spaja se TAČNO pregledana revizija.
      const granaSha = (await git(root, ['rev-parse', grana])).stdout.trim();
      if (granaSha !== ev.review.sha) {
        return await odbij(id, ev, `grana je promenjena posle pregleda (${granaSha.slice(0, 8)} != ${String(ev.review.sha).slice(0, 8)})`, token);
      }
      const mainSha = (await git(root, ['rev-parse', 'main'])).stdout.trim();
      // Oporavak: ako je pregledani SHA već predak main-a, merge je obavljen u
      // ranijem procesu (koji je prekinut pre evidencije/zapisa). Ne spajaj
      // ponovo i ne traži nov pregled — dopuni evidenciju i dovrši zapis.
      const vecSpojen = (await git(root, ['merge-base', '--is-ancestor', ev.review.sha, 'main'], { allowFailure: true })).code === 0;
      if (vecSpojen) {
        ev = {
          ...ev,
          accept: {
            merge: mainSha, branch: grana, reviewed: ev.review.sha,
            tag: `dokaz/${id}-accept`, recovered: true, at: now(),
          },
        };
        await store.setFields(id, { code_evidence: ev }, { actor: OWNER, note: 'prihvatanje prepoznato iz Gita' });
        const zapis = await pokusajZapisa(id, task, ev, token);
        // Evidencija mora da ponese i ishod zapisa: bez toga zadatak ostaje bez
        // `memory_write`, iako je zapis obavljen (nalaz nezavisne provere).
        if (zapis.ok) {
          await store.setFields(id, { code_evidence: zapis.ev }, { actor: OWNER, note: 'zapis u memoriju (oporavak)' });
        }
        if (!zapis.ok) {
          return {
            phase: 'code', task: id, ok: false, merge: mainSha,
            reason: `prihvatanje je već u Gitu, ali zapis u memoriju nije prošao: ${zapis.error.message}`,
          };
        }
        await store.transition(id, 'consolidated', { actor: 'agentctl', note: `oporavak: ${mainSha.slice(0, 8)}` });
        await store.emit('code.accepted', { task: id, merge: mainSha, branch: grana, recovered: true });
        logger(`code: ${id} -> consolidated (oporavak posle prekida)`);
        return { phase: 'code', task: id, ok: true, step: 'memory', recovered: true };
      }
      const osnovaPromenjena = Boolean(ev.review.base) && mainSha !== ev.review.base;
      // Definicija: nova osnovica znači da pregled više ne pokriva rezultat koji
      // se prihvata — traži se NOV pregled, a ne automatski rebase (Codex).
      if (osnovaPromenjena) {
        ev = {
          ...ev,
          review_reset: {
            reason: 'osnovica ciljnog repoa se promenila posle pregleda',
            base_was: ev.review.base,
            base_now: mainSha,
            at: now(),
          },
          review: null,
        };
        return await odbij(id, ev, 'osnovica ciljnog repoa se promenila posle pregleda; potreban nov pregled', token);
      }

      // 4) Integraciona provera pre diranja glavne grane.
      const proba = await saZakupom(id, token, () => integracionaProba(root, { grana, testCommand: task.data.code_test }));
      if (proba.izgubljen) {
        return await odbij(id, ev, `zakup je izgubljen tokom integracione provere: ${proba.izgubljen.message}`, token);
      }
      ev = { ...ev, integration: { ...proba.rezultat, base_stale: false, base_was: ev.review.base, base_now: mainSha } };
      if (!proba.rezultat.ok) {
        return await odbij(id, ev, `integraciona provera nije prošla: ${proba.rezultat.reason}`, token);
      }

      // 5) Ni grana ni osnovica se nisu pomerile TOKOM provere. Spaja se tačno
      // pregledani SHA, pa izmena posle pregleda ne može da uđe u main.
      const granaSad = (await git(root, ['rev-parse', grana])).stdout.trim();
      const mainSad = (await git(root, ['rev-parse', 'main'])).stdout.trim();
      if (granaSad !== ev.review.sha || mainSad !== mainSha) {
        ev = { ...ev, review: null, review_reset: { reason: 'grana ili osnovica se promenila tokom integracione provere', at: now() } };
        return await odbij(id, ev, 'grana ili osnovica se promenila tokom integracione provere; potreban nov pregled', token);
      }

      // 6) Zakup je i dalje naš neposredno pre upisa.
      if (!holdsLease((await store.get(id)).data, OWNER, token)) {
        return await odbij(id, ev, 'zakup nad zadatkom nije naš neposredno pre prihvatanja', token);
      }

      // 7) Dokazni tag PRE merge-a: neuspeh upisa se ne ignorise. Tag pokazuje
      // na PREGLEDANU reviziju (ona je posle merge-a predak main-a).
      const tag = await git(root, ['tag', '-f', `dokaz/${id}-accept`, ev.review.sha], { actor: OWNER, allowFailure: true });
      if (tag.code !== 0) {
        return await odbij(id, ev, `dokazni tag nije nastao: ${tag.stderr.split('\n')[0]}`, token);
      }

      // 7b) Upis taga ume da potraje; zakup se proverava PONOVO, neposredno pre
      // merge-a (Codex: preuzimanje tokom usporenog upisa taga je prošlo).
      if (!holdsLease((await store.get(id)).data, OWNER, token)) {
        return await odbij(id, ev, 'zakup nad zadatkom je izgubljen tokom upisa dokaznog taga', token);
      }
      const granaPreMerge = (await git(root, ['rev-parse', grana])).stdout.trim();
      const mainPreMerge = (await git(root, ['rev-parse', 'main'])).stdout.trim();
      if (granaPreMerge !== ev.review.sha || mainPreMerge !== mainSha) {
        ev = { ...ev, review: null, review_reset: { reason: 'grana ili osnovica se promenila pre merge-a', at: now() } };
        return await odbij(id, ev, 'grana ili osnovica se promenila pre merge-a; potreban nov pregled', token);
      }

      // 8) Merge TAČNO pregledanog SHA (ime grane nije dokaz sadržaja).
      const merge = await git(root, ['merge', '--no-ff', '-m', `agentctl(${id}): prihvacena popravka`, ev.review.sha], { actor: OWNER, allowFailure: true });
      if (merge.code !== 0) {
        await git(root, ['merge', '--abort'], { actor: OWNER, allowFailure: true });
        return await odbij(id, ev, `merge nije prošao: ${merge.stderr.split('\n')[0]}`, token);
      }
      const sha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
      const drvo = (await git(root, ['rev-parse', 'HEAD^{tree}'])).stdout.trim();
      ev = {
        ...ev,
        accept: {
          merge: sha, branch: grana, reviewed: granaSha, tag: `dokaz/${id}-accept`,
          tree: drvo, integration_tree: proba.rezultat.tree, at: now(),
        },
      };
      // Prihvatanje se upisuje ODMAH posle merge-a: ako proces pogine pre wiki
      // zapisa, nastavak mora da vidi da je promena već prihvaćena (test CR2).
      await store.setFields(id, { code_evidence: ev }, { actor: OWNER, note: `prihvaćeno: ${sha.slice(0, 8)}` });

      // Zadatak vraća ishod u memoriju; piše kontrolni sloj, ne agent.
      const zapis = await pokusajZapisa(id, task, ev, token);
      ev = zapis.ev;
      if (!zapis.ok) {
        return {
          phase: 'code',
          task: id,
          ok: false,
          merge: sha,
          reason: `kod je prihvaćen (${sha.slice(0, 8)}), ali zapis u memoriju nije prošao: ${zapis.error.message}`,
        };
      }
      logger(`code: ${id} zapis u memoriju: ${ev.memory_write}`);
      await store.setFields(id, { code_evidence: ev }, { actor: OWNER, note: `prihvaćeno: ${sha.slice(0, 8)}` });
      await store.transition(id, 'consolidated', { actor: 'agentctl', note: `merge ${sha.slice(0, 8)}` });
      await store.emit('code.accepted', { task: id, merge: sha, branch: grana });
      logger(`code: ${id} -> prihvaćeno u ${trenutna} @ ${sha.slice(0, 8)}`);
      return { phase: 'code', task: id, ok: true, step: 'accept', merge: sha };
    } finally {
      void token;
    }
  }

  /**
   * Pokušaj zapisa ishoda u wiki memoriju. Neuspeh se NE guta: upisuje se u
   * evidenciju zadatka, emituje kao događaj i zadatak se vraća u `verified` da
   * zapis može da se ponovi (kod je već prihvaćen u ciljnom repou).
   */
  async function pokusajZapisa(id, task, ev, token) {
    try {
      const rel = await upisiZapisUMemoriju(id, task, ev);
      return { ok: true, ev: { ...ev, memory_write: rel, memory_write_error: null } };
    } catch (error) {
      const novi = {
        ...ev,
        memory_write: null,
        memory_write_error: { message: error.message, at: now() },
      };
      await store.setFields(id, { code_evidence: novi }, { actor: OWNER, note: 'zapis u memoriju nije prošao' });
      await store.emit('code.memory_write_failed', { task: id, error: error.message, merge: ev.accept?.merge ?? null });
      await store.release(id, OWNER, { toStatus: 'verified', token, note: 'kod prihvaćen; čeka zapis u memoriju' }).catch(() => {});
      logger(`code: ${id} zapis u memoriju nije prošao: ${error.message}`);
      return { ok: false, ev: novi, error };
    }
  }

  /** Ponovni pokušaj zapisa u memoriju kada je kod već prihvaćen. */
  async function fazaZapisa(id, task, ev) {
    const claim = await store.claim(id, OWNER);
    const token = claim.leaseToken;
    const zapis = await pokusajZapisa(id, task, ev, token);
    if (!zapis.ok) {
      return { phase: 'code', task: id, ok: false, reason: `zapis u memoriju nije prošao: ${zapis.error.message}` };
    }
    await store.setFields(id, { code_evidence: zapis.ev }, { actor: OWNER, note: 'zapis u memoriju' });
    await store.transition(id, 'consolidated', { actor: 'agentctl', note: `zapis: ${zapis.ev.memory_write}` });
    await store.emit('code.memory_written', { task: id, file: zapis.ev.memory_write });
    logger(`code: ${id} -> consolidated (zapis u memoriju)`);
    return { phase: 'code', task: id, ok: true, step: 'memory' };
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
    // Kod je prihvaćen, ali zapis u memoriju nije prošao: pokušaj ponovo.
    if (!ev.memory_write) return await fazaZapisa(id, task, ev);
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

  return { runCodeTask, dodajCodeZadatak, proveriCilj, klasifikujPad };
}
