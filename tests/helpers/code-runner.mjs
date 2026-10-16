/**
 * Testna instrumentacija: izvrši coding fazu u ZASEBNOM procesu.
 *
 * Služi testovima naglog prekida — proces se može ubiti u kontrolisanoj tački
 * (marker fajl piše mock komanda), pa se oporavak proverava u novom procesu.
 * Nije produkcioni sloj.
 */
import { loadConfig } from '../../tools/orchestrator/lib/config.mjs';
import { createStore } from '../../tools/orchestrator/lib/store.mjs';
import { createCodingPipeline } from '../../tools/orchestrator/lib/coding.mjs';

const [root, id] = process.argv.slice(2);
if (!root || !id) {
  console.error('upotreba: code-runner.mjs <vault> <TASK-ID>');
  process.exit(2);
}
const config = await loadConfig(root);
const store = createStore(config);
const coding = createCodingPipeline(config, { store });
try {
  const rezultat = await coding.runCodeTask(id);
  console.log(JSON.stringify(rezultat));
  process.exit(rezultat.ok ? 0 : 1);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
