/**
 * Semantički parovi izvor/nacrt: dokaz da provera razlikuje vernu parafrazu od
 * nedokazane tvrdnje. Pokreće STVARNI verifikator (preko pipeline.runVerify),
 * pa poredi verdikt sa očekivanjem. Nije produkcioni sloj.
 *
 * Upotreba: node tools/fixtures/semantika.mjs <vault-root>
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { loadConfig } from '../orchestrator/lib/config.mjs';
import { createStore } from '../orchestrator/lib/store.mjs';
import { createPipeline } from '../orchestrator/lib/pipeline.mjs';
import { writeNote } from '../orchestrator/lib/vault.mjs';
import { commitWorktree, createWorktree } from '../orchestrator/lib/worktree.mjs';

const root = process.argv[2];
if (!root) { console.error('upotreba: semantika.mjs <vault-root>'); process.exit(2); }

const PAROVI = [
  {
    ime: 'P1 dozvoljena parafraza',
    ocekivano: 'pass',
    izvor: 'Flatpak aplikacije se izvršavaju u sandbox okruženju. Tehnologija OSTree, koja se nalazi u osnovi Flatpak-a, vrši deduplikaciju poklapajućih datoteka.',
    nacrt: 'Flatpak pokreće aplikacije izolovano u sandbox-u. U osnovi koristi OSTree, koji uklanja duplikate datoteka.',
  },
  {
    ime: 'P2 prihvatljivo pitanje',
    ocekivano: 'pass',
    izvor: 'Za instalaciju Flatpak aplikacija potrebni su Bubblewrap i OSTree. Aplikacije se mogu koristiti i na ChromeOS-u.',
    nacrt: 'Za instalaciju su potrebni Bubblewrap i OSTree.\n\n## Otvorena pitanja\n\n- Koje su minimalne verzije Bubblewrap-a i OSTree-a potrebne?',
  },
  {
    ime: 'P3 promenjen broj',
    ocekivano: 'fail',
    izvor: 'Do 2023. godine Flathub je beležio više od 700.000 preuzimanja dnevno.',
    nacrt: 'Do 2023. godine Flathub je beležio više od 70.000 preuzimanja dnevno.',
  },
  {
    ime: 'P4 neosnovana definicija',
    ocekivano: 'fail',
    izvor: 'Aplikacije zahtevaju dozvole za pristup Bluetooth-u, zvuku, mreži i fajlovima.',
    nacrt: 'Aplikacije zahtevaju dozvole za Bluetooth, zvuk, mrežu i fajlove. Dozvole se realizuju kroz XDG Desktop Portals, standardni mehanizam za komunikaciju sa sandbox-om.',
  },
  {
    ime: 'P5 jača tvrdnja od izvora',
    ocekivano: 'fail',
    izvor: 'Moguće je hostovati Flatpak repozitorijum koji je nezavisan od Flathub-a.',
    nacrt: 'Postoji puna podrška za hostovanje potpuno nezavisnih Flatpak repozitorijuma.',
  },
];

// Pravi harnesi: bez ovoga bi se koristio default (mock) i nalaz ne bi ništa
// dokazivao.
const config = await loadConfig(root, { configFile: path.join(root, 'tools', 'config', 'agents.real.yml') });
const store = createStore(config);
const pipeline = createPipeline(config, { store });

const nov = '2026-01-01T00:00:00.000Z';
const rezultati = [];
for (const [i, par] of PAROVI.entries()) {
  const slug = `P${i + 1}`;
  const izvorRel = `raw/${slug}.md`;
  await fs.mkdir(path.join(root, 'raw'), { recursive: true });
  await fs.writeFile(path.join(root, izvorRel), `# ${par.ime}\n\n${par.izvor}\n`, 'utf8');

  const zadatak = await pipeline.ingest({ source: izvorRel, title: par.ime });
  const id = zadatak.data.id;

  // Nacrt upisuje sam fixture na GRANU ISTRAŽIVAČA (kao da ga je researcher
  // ostavio) — verifikator radi nad tom granom, a pečat ostaje kontrolnog sloja.
  const wt = await createWorktree(config, { id, role: 'researcher', base: 'main' });
  await writeNote(wt.path, `wiki/drafts/${slug}.md`, {
    frontmatter: {
      title: par.ime, created: nov, updated: nov, authors: ['researcher'],
      status: 'draft', tags: ['semantika'],
    },
    body: `# ${par.ime}\n\n${par.nacrt}\n`,
  });
  await commitWorktree(config, id, `researcher(${id}): nacrt (${slug})`, { actor: 'researcher', role: 'researcher' });
  const claim = await store.claim(id, 'agentctl');
  await store.release(id, 'agentctl', { toStatus: 'review', token: claim.leaseToken, note: 'fixture: nacrt spreman' });
  await store.attachArtifacts(id, [`wiki/drafts/${slug}.md`], { actor: 'agentctl' });

  const verify = await pipeline.runVerify(id);
  rezultati.push({ par: par.ime, ocekivano: par.ocekivano, dobijeno: verify.verdict, ok: par.ocekivano === verify.verdict });
}

console.log('| par | očekivano | dobijeno | ishod |');
console.log('|---|---|---|---|');
for (const r of rezultati) console.log(`| ${r.par} | ${r.ocekivano} | ${r.dobijeno} | ${r.ok ? 'OK' : 'NEUSKLAĐENO'} |`);
const neuspesni = rezultati.filter((r) => !r.ok);
console.log(neuspesni.length ? `NEUSKLAĐENO: ${neuspesni.length}/${rezultati.length}` : `SVI PAROVI USKLAĐENI (${rezultati.length}/${rezultati.length})`);
process.exit(neuspesni.length ? 1 : 0);
