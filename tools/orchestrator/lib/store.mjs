/**
 * Store je kontrolni sloj nad fajlovima zadataka: čita, menja stanje, pomera
 * fajl u odgovarajuću faznu fasciklu i drži zakup.
 *
 * Sve mutacije idu kroz međuprocesni fajl-lock, jer kontrolna petlja može da
 * radi u više procesa (jedan po harnesu).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  TaskError, assertTransition, appendHistory, dirForPhase, findTask, listTasks,
  phaseFor, readTaskFile, writeTaskFile, validateTaskData,
} from './task.mjs';
import { appendJsonl, withFileLock } from './fsx.mjs';
import { canTakeOver, clearLease, isLeaseLive, leaseExpired, leaseInfo, newLease } from './lease.mjs';

export function createStore(config, options = {}) {
  const clock = options.clock ?? (() => new Date());
  const lockOptions = options.lockOptions ?? {};
  const lockFile = (id) => path.join(config.paths.locks, `${id}.lock`);

  async function emit(kind, payload) {
    const record = { ts: clock().toISOString(), kind, ...payload };
    await appendJsonl(config.paths.events, record);
    return record;
  }

  async function withTaskLock(id, fn) {
    return withFileLock(lockFile(id), fn, lockOptions);
  }

  function nowIso() {
    return clock().toISOString();
  }

  async function requireTask(id) {
    const task = await findTask(config, id);
    if (!task) throw new TaskError(`zadatak ${id} ne postoji`, 'NOT_FOUND');
    return task;
  }

  /** Atomski: pročitaj zadatak, primeni mutator, upiši, prebaci fazu ako treba. */
  async function mutate(id, actor, mutator) {
    return withTaskLock(id, async () => {
      const task = await requireTask(id);
      const result = await mutator({ ...task, data: { ...task.data } });
      if (!result) return task;
      const { data, body, extra } = result;
      const problems = validateTaskData(data);
      if (problems.length) throw new TaskError(`zadatak ${id} nije validan: ${problems.join('; ')}`, 'INVALID_TASK');

      const targetPhase = phaseFor(data.status);
      const targetFile = path.join(dirForPhase(config, targetPhase), `${id}.md`);
      const previousPhase = task.phase;
      await writeTaskFile(targetFile, data, body ?? task.body);
      if (targetFile !== task.file) {
        await fs.rm(task.file, { force: true });
      }
      await emit('task.write', {
        task: id, actor, status: data.status, phase: targetPhase,
        moved: previousPhase !== targetPhase ? `${previousPhase}->${targetPhase}` : null,
      });
      return { ...task, file: targetFile, phase: targetPhase, data, body: body ?? task.body, extra };
    });
  }

  const store = {
    config,
    clock,

    async list(filter = {}) {
      const tasks = await listTasks(config);
      if (filter.status) return tasks.filter((t) => t.data.status === filter.status);
      if (filter.statuses) return tasks.filter((t) => filter.statuses.includes(t.data.status));
      return tasks;
    },

    async get(id) {
      const task = await findTask(config, id);
      if (!task) throw new TaskError(`zadatak ${id} ne postoji`, 'NOT_FOUND');
      return task;
    },

    async tryGet(id) {
      return findTask(config, id);
    },

    /** Prelaz stanja sa proverom automata; jedina dozvoljena izmena statusa. */
    async transition(id, nextStatus, { actor = 'agentctl', note = null, body = null } = {}) {
      return mutate(id, actor, (task) => {
        const from = task.data.status;
        assertTransition(from, nextStatus);
        let data = { ...task.data, status: nextStatus, updated: nowIso() };
        if (nextStatus === 'blocked' && note) data.blocked_reason = note;
        if (nextStatus !== 'blocked') data.blocked_reason = null;
        if (nextStatus !== 'in_progress') data = { ...data, ...clearLease() };
        data = appendHistory(data, { status: nextStatus, actor, note, now: nowIso() });
        return { data, body: body ?? task.body };
      });
    },

    async updateBody(id, { actor = 'agentctl', append = null, replace = null, note = null } = {}) {
      return mutate(id, actor, (task) => {
        const body = replace ?? (append ? `${task.body.replace(/\s*$/, '')}\n\n${append}\n` : task.body);
        return {
          data: appendHistory(task.data, { status: task.data.status, actor, note, now: nowIso() }),
          body,
        };
      });
    },

    /**
     * Preuzmi zadatak pod zakup. Dozvoljeno je samo iz stanja `ready` ili iz
     * stanja sa isteklim zakupom (tada se prethodni vlasnik opoziva).
     */
    async claim(id, owner, { ttlMs = config.lease.ttlMs, force = false } = {}) {
      const task = await mutate(id, owner, (current) => {
        const now = clock();
        const info = leaseInfo(current.data, now);
        if (!force && current.data.status === 'in_progress' && info.live && info.owner !== owner) {
          throw new TaskError(
            `zadatak ${id} drži "${info.owner}" do ${info.expiresAt}`,
            'LEASE_HELD',
          );
        }
        if (current.data.status === 'in_progress' && info.held && info.owner !== owner && !canTakeOver(current.data, owner, now)) {
          throw new TaskError(`zadatak ${id} je pod živim zakupom vlasnika "${info.owner}"`, 'LEASE_HELD');
        }
        if (!['ready', 'review', 'verified', 'in_progress'].includes(current.data.status)) {
          throw new TaskError(`zadatak ${id} je u stanju "${current.data.status}" i ne može se preuzeti`, 'NOT_READY');
        }
        if (current.data.status !== 'in_progress') assertTransition(current.data.status, 'in_progress');
        const lease = newLease(owner, ttlMs, now);
        let data = { ...current.data, ...lease, status: 'in_progress', assignee: owner, updated: now.toISOString() };
        data = appendHistory(data, { status: 'in_progress', actor: owner, note: info.held ? 'preuzet istekao zakup' : null, now: now.toISOString() });
        return { data };
      });
      return task;
    },

    /** Obnovi zakup. Vraća grešku ako zakup nije vaš ili je istekao. */
    async renew(id, owner, { ttlMs = config.lease.ttlMs } = {}) {
      return mutate(id, owner, (current) => {
        const now = clock();
        if (current.data.lock_owner !== owner) {
          throw new TaskError(`zadatak ${id} ne drži "${owner}"`, 'NOT_OWNER');
        }
        if (leaseExpired(current.data, now)) {
          throw new TaskError(`zakup nad ${id} je istekao`, 'LEASE_EXPIRED');
        }
        return {
          data: {
            ...current.data,
            ...newLease(owner, ttlMs, now),
            updated: now.toISOString(),
          },
        };
      });
    },

    /** Oslobodi zakup i vrati zadatak u zadato stanje (podrazumevano `ready`). */
    async release(id, owner, { toStatus = 'ready', note = null, actor = owner } = {}) {
      // `in_progress` bez zakupa je nevalidno stanje; otpuštanje zakupa mora da
      // ostavi zadatak u stanju koje čeka sledeću fazu.
      if (toStatus === 'in_progress') {
        throw new TaskError(
          `oslobađanje zakupa ne može da ostavi ${id} u stanju "in_progress" (to stanje zahteva zakup); koristi "review", "verified" ili "ready"`,
          'BAD_RELEASE_TARGET',
        );
      }
      return mutate(id, actor, (current) => {
        if (current.data.lock_owner && current.data.lock_owner !== owner) {
          throw new TaskError(`zadatak ${id} drži "${current.data.lock_owner}", ne "${owner}"`, 'NOT_OWNER');
        }
        assertTransition(current.data.status, toStatus);
        let data = { ...current.data, ...clearLease(), status: toStatus, assignee: null, updated: nowIso() };
        data = appendHistory(data, { status: toStatus, actor, note, now: nowIso() });
        return { data };
      });
    },

    /**
     * Vrati sve zadatke sa isteklim zakupom u stanje `ready`. Vraća listu
     * opozvanih zadataka da kontrolni sloj može da očisti njihova radna stabla.
     */
    async reclaimExpired({ actor = 'agentctl' } = {}) {
      const reclaimed = [];
      const tasks = await listTasks(config);
      for (const task of tasks) {
        if (task.data.status !== 'in_progress') continue;
        if (!leaseExpired(task.data, clock())) continue;
        const owner = task.data.lock_owner;
        await mutate(task.data.id, actor, (current) => {
          assertTransition(current.data.status, 'ready');
          let data = { ...current.data, ...clearLease(), status: 'ready', assignee: null, updated: nowIso() };
          data = appendHistory(data, { status: 'ready', actor, note: `zakup vlasnika "${owner}" istekao`, now: nowIso() });
          return { data };
        });
        await emit('lease.reclaimed', { task: task.data.id, previousOwner: owner, actor });
        reclaimed.push({ id: task.data.id, previousOwner: owner });
      }
      return reclaimed;
    },

    async attachArtifacts(id, artifacts, { actor = 'agentctl', note = null } = {}) {
      return mutate(id, actor, (current) => {
        const merged = new Set([...(current.data.artifacts ?? []), ...artifacts]);
        return {
          data: appendHistory({ ...current.data, artifacts: [...merged] }, { status: current.data.status, actor, note, now: nowIso() }),
        };
      });
    },

    /** Postavi proizvoljna polja zadatka (npr. `extracted: true`) uz trag u istoriji. */
    async setFields(id, patch, { actor = 'agentctl', note = null } = {}) {
      return mutate(id, actor, (current) => ({
        data: appendHistory(
          { ...current.data, ...patch },
          { status: current.data.status, actor, note, now: nowIso() },
        ),
      }));
    },

    /** Zameni listu artefakata (npr. nacrt -> produkciona beleška posle konsolidacije). */
    async setArtifacts(id, artifacts, { actor = 'agentctl', note = null } = {}) {
      return mutate(id, actor, (current) => ({
        data: appendHistory(
          { ...current.data, artifacts: [...artifacts] },
          { status: current.data.status, actor, note, now: nowIso() },
        ),
      }));
    },

    async setVerification(id, verification, { actor = 'verifier' } = {}) {
      return mutate(id, actor, (current) => ({
        data: appendHistory(
          { ...current.data, verification: { ...verification, by: verification.by ?? actor } },
          { status: current.data.status, actor, note: `verdikt: ${verification.verdict}`, now: nowIso() },
        ),
      }));
    },

    async setAuthors(id, authors, { actor = 'agentctl' } = {}) {
      return mutate(id, actor, (current) => {
        const merged = new Set([...(current.data.authors ?? []), ...authors]);
        return {
          data: appendHistory({ ...current.data, authors: [...merged] }, { status: current.data.status, actor, now: nowIso() }),
        };
      });
    },

    /** Da li je zakup nad zadatkom živ i pripada datom vlasniku? */
    async assertLease(id, owner) {
      const task = await requireTask(id);
      if (task.data.lock_owner !== owner) {
        throw new TaskError(`zadatak ${id} ne drži "${owner}" (drži "${task.data.lock_owner}")`, 'NOT_OWNER');
      }
      if (!isLeaseLive(task.data, clock())) {
        throw new TaskError(`zakup nad ${id} je istekao u ${task.data.lease_expires_at}`, 'LEASE_EXPIRED');
      }
      return task;
    },

    emit,
  };

  return store;
}
