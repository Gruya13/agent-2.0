/**
 * Održavanje zakupa tokom dugog poziva harnesa — na jednom mestu.
 *
 * Dokumentni i coding tok su imali dve kopije istog tajmera sa različitim
 * default-ima (120 s vs 2 s) i različitim tretmanom neuspeha: coding je grešku
 * pamtiо i odbijao fazu, dokumentni ju je samo logovao i nastavljao.
 *
 * Ovde je jedno pravilo: period dolazi iz `config.lease.heartbeatMs` (default
 * 120 s, minimum 50 ms), a neuspeh obnove se pamti. Pozivalac odlučuje šta
 * dalje — ali greška se nikad ne gubi.
 */

/** Zakup je stvarno izgubljen; faza se ne sme nastaviti kao uspešna. */
export class LeaseLostError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LeaseLostError';
    this.code = 'LEASE_LOST';
  }
}

/** Period obnavljanja: jedan izvor istine za oba toka. */
export function heartbeatPeriodMs(config) {
  const configured = Number(config?.lease?.heartbeatMs);
  return Number.isFinite(configured) && configured > 0 ? Math.max(50, configured) : 120_000;
}

/**
 * Pokreni obnavljanje zakupa i vrati ručku.
 *
 * @param {{store: object, id: string, owner: string, token: string, config: object, logger?: Function}} options
 * @returns {{period: number, izgubljen: Error|null, stop: () => void}}
 */
export function startLeaseHeartbeat({ store, id, owner, token, config, logger = () => {}, onError }) {
  let prvaGreska = null;
  const period = heartbeatPeriodMs(config);
  const timer = setInterval(() => {
    store.renew(id, owner, { token }).catch((error) => {
      const prva = prvaGreska === null;
      prvaGreska = prvaGreska ?? error;
      logger(`obnova zakupa nije uspela za ${id}: ${error.message}`);
      // Pozivalac može da prekine rad odmah; samo prva greška ga obaveštava.
      if (prva && typeof onError === 'function') onError(error);
    });
  }, period);
  timer.unref?.();
  return {
    period,
    get izgubljen() { return prvaGreska; },
    stop() { clearInterval(timer); },
  };
}
