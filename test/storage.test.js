import { test } from "node:test";
import assert from "node:assert/strict";
import { STORAGE_KEYS, createStore, discardForeignSession, unreadableError } from "../js/core/storage.js";
import { FORMAT_VERSION, createState, newUnit } from "../js/core/state.js";

const NOW = new Date("2026-11-07T08:30:00.000Z");
const LATER = new Date("2026-11-08T09:00:00.000Z");

// Verhält sich wie localStorage: fehlende Schlüssel liefern null, Werte sind Text.
function memoryBackend(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => {
      items.set(key, String(value));
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

function clock(...dates) {
  let index = 0;
  return () => dates[Math.min(index++, dates.length - 1)];
}

test("Alle Schlüssel beginnen mit der Vorsilbe der App", () => {
  assert.deepEqual(STORAGE_KEYS, {
    state: "radiology-english.app.state",
    broken: "radiology-english.app.state.broken",
    previous: "radiology-english.app.previous",
    session: "radiology-english.app.session",
  });
});

test("Ohne gespeicherten Stand liefert load einen neuen und schreibt nichts", () => {
  const backend = memoryBackend();
  const { state, error } = createStore(backend, { now: clock(NOW) }).load();
  assert.equal(error, null);
  assert.deepEqual(state, createState(NOW));
  assert.equal(backend.items.size, 0);
});

test("save setzt updatedAt, load liest denselben Stand wieder", () => {
  const backend = memoryBackend();
  const store = createStore(backend, { now: clock(NOW, LATER) });
  const { state } = store.load();
  state.units.a = { ...newUnit(), box: 1 };
  store.save(state);
  assert.equal(state.updatedAt, LATER.toISOString());
  assert.equal(state.createdAt, NOW.toISOString());
  const again = createStore(backend, { now: clock(LATER) }).load();
  assert.equal(again.error, null);
  assert.deepEqual(again.state, state);
});

test("Unbekannte Felder und IDs bleiben beim Lesen und Speichern erhalten", () => {
  const stored = createState(NOW);
  stored.extraTop = { a: [1, 2] };
  stored.units["gibt.es.nicht.mehr"] = { ...newUnit(), box: 4, extraUnit: "z" };
  stored.settings.extraSetting = 7;
  const backend = memoryBackend({ [STORAGE_KEYS.state]: JSON.stringify(stored) });
  const store = createStore(backend, { now: clock(LATER) });
  const { state } = store.load();
  store.save(state);
  const written = JSON.parse(backend.items.get(STORAGE_KEYS.state));
  assert.deepEqual(written.extraTop, stored.extraTop);
  assert.deepEqual(written.units, stored.units);
  assert.equal(written.settings.extraSetting, 7);
});

test("Kaputtes JSON: Fehler gesetzt, nichts überschrieben, Rohdaten unter broken", () => {
  const raw = "{ das ist kein JSON";
  const backend = memoryBackend({ [STORAGE_KEYS.state]: raw });
  const { state, error } = createStore(backend, { now: clock(NOW) }).load();
  assert.ok(error instanceof Error);
  assert.equal(error.code, "broken");
  assert.match(error.message, /beschädigt/);
  assert.deepEqual(state, createState(NOW));
  assert.equal(backend.items.get(STORAGE_KEYS.state), raw);
  assert.equal(backend.items.get(STORAGE_KEYS.broken), raw);
});

test("Gültiges JSON mit falschem Inhalt gilt ebenso als kaputt", () => {
  const raw = JSON.stringify({ formatVersion: 1, units: "falsch" });
  const backend = memoryBackend({ [STORAGE_KEYS.state]: raw });
  const { error } = createStore(backend, { now: clock(NOW) }).load();
  assert.equal(error.code, "broken");
  assert.equal(backend.items.get(STORAGE_KEYS.broken), raw);
});

test("Nach einem kaputten Stand überschreibt save nur den Stand, die Rohdaten bleiben", () => {
  const raw = "kaputt";
  const backend = memoryBackend({ [STORAGE_KEYS.state]: raw });
  const store = createStore(backend, { now: clock(NOW) });
  const { state } = store.load();
  store.save(state);
  assert.equal(backend.items.get(STORAGE_KEYS.broken), raw);
  assert.deepEqual(JSON.parse(backend.items.get(STORAGE_KEYS.state)), state);
});

test("Ein zweiter kaputter Stand verdrängt den ersten nicht", () => {
  const backend = memoryBackend({ [STORAGE_KEYS.state]: "erster", [STORAGE_KEYS.broken]: "älter" });
  const store = createStore(backend, { now: clock(NOW) });
  store.load();
  store.load();
  assert.equal(backend.items.get(STORAGE_KEYS.broken), "erster");
  assert.equal(backend.items.get(STORAGE_KEYS.broken + ".1"), "älter");
  assert.equal(backend.items.has(STORAGE_KEYS.broken + ".2"), false);
});

test("Lässt sich broken nicht schreiben, überschreibt save den Stand nicht", () => {
  const raw = "kaputt";
  const backend = memoryBackend({ [STORAGE_KEYS.state]: raw });
  const setItem = backend.setItem;
  backend.setItem = () => {
    throw new Error("Speicher voll");
  };
  const store = createStore(backend, { now: clock(NOW) });
  const { state, error } = store.load();
  assert.equal(error.code, "broken");
  assert.throws(() => store.save(state), /Speicher voll/);
  assert.equal(backend.items.get(STORAGE_KEYS.state), raw);
  backend.setItem = setItem;
  store.save(state);
  assert.equal(backend.items.get(STORAGE_KEYS.broken), raw);
  assert.notEqual(backend.items.get(STORAGE_KEYS.state), raw);
});

test("Ein zu neuer Stand wird gemeldet und bleibt erhalten", () => {
  const raw = JSON.stringify({ ...createState(NOW), formatVersion: FORMAT_VERSION + 1 });
  const backend = memoryBackend({ [STORAGE_KEYS.state]: raw });
  const { state, error } = createStore(backend, { now: clock(NOW) }).load();
  assert.equal(error.code, "tooNew");
  assert.match(error.message, /neueren Version/);
  assert.equal(state.formatVersion, FORMAT_VERSION);
  assert.equal(backend.items.get(STORAGE_KEYS.state), raw);
  assert.equal(backend.items.get(STORAGE_KEYS.broken), raw);
});

test("Ein älterer Stand wird migriert, der alte Text bleibt unter previous", () => {
  const old = { ...createState(NOW), units: { a: { ...newUnit(), box: 3 } } };
  const raw = JSON.stringify(old);
  const backend = memoryBackend({ [STORAGE_KEYS.state]: raw });
  const store = createStore(backend, {
    now: clock(LATER),
    target: FORMAT_VERSION + 1,
    migrations: { [FORMAT_VERSION]: (state) => ({ ...state, addedLater: true }) },
  });
  const { state, error, migratedFrom } = store.load();
  assert.equal(error, null);
  assert.equal(migratedFrom, FORMAT_VERSION);
  assert.equal(state.formatVersion, FORMAT_VERSION + 1);
  assert.equal(state.addedLater, true);
  assert.deepEqual(state.units, old.units);
  assert.equal(backend.items.get(STORAGE_KEYS.previous), raw);
  assert.equal(backend.items.get(STORAGE_KEYS.state), raw);
});

test("Ein nicht lesbarer Speicher liefert einen neuen Stand und einen Fehler", () => {
  const backend = {
    getItem: () => {
      throw new Error("gesperrt");
    },
    setItem: () => {},
    removeItem: () => {},
  };
  const { state, error } = createStore(backend, { now: clock(NOW) }).load();
  assert.equal(error.code, "unavailable");
  assert.deepEqual(state, createState(NOW));
});

test("Ohne Uhr gilt die Gerätezeit", () => {
  const { state } = createStore(memoryBackend()).load();
  assert.ok(Number.isFinite(Date.parse(state.createdAt)));
});

test("keepPrevious sichert den Stand vor dem Einlesen", () => {
  const backend = memoryBackend();
  const store = createStore(backend, { now: clock(NOW) });
  assert.equal(store.keepPrevious(), false);
  assert.equal(backend.items.has(STORAGE_KEYS.previous), false);
  const { state } = store.load();
  store.save(state);
  const saved = backend.items.get(STORAGE_KEYS.state);
  assert.equal(store.keepPrevious(), true);
  assert.equal(backend.items.get(STORAGE_KEYS.previous), saved);
  assert.equal(backend.items.get(STORAGE_KEYS.state), saved);
});

test("Die laufende Übung lässt sich speichern, lesen und löschen", () => {
  const backend = memoryBackend();
  const store = createStore(backend, { now: clock(NOW) });
  assert.equal(store.loadSession(), null);
  const session = { kind: "speech", appVersion: "0.9.0", queue: [{ unitId: "a" }], index: 0, step: "listen", result: null };
  store.saveSession(session);
  assert.deepEqual(store.loadSession(), session);
  store.clearSession();
  assert.equal(store.loadSession(), null);
  assert.equal(backend.items.has(STORAGE_KEYS.session), false);
});

test("Eine kaputte Übung liefert null, der Lernstand bleibt", () => {
  const stateText = JSON.stringify(createState(NOW));
  const backend = memoryBackend({ [STORAGE_KEYS.session]: "{ kaputt", [STORAGE_KEYS.state]: stateText });
  const store = createStore(backend, { now: clock(NOW) });
  assert.equal(store.loadSession(), null);
  assert.equal(backend.items.get(STORAGE_KEYS.state), stateText);
  assert.equal(store.load().error, null);
});

// ----- Scheitert das Lesen, darf das nächste save den echten Stand nicht überschreiben -----

function storedWithUnit() {
  const state = createState(NOW);
  state.units.a = { ...newUnit(), box: 3 };
  return JSON.stringify(state);
}

// Das erste getItem wirft, danach liest der Speicher wieder.
function failingOnce(backend) {
  const getItem = backend.getItem;
  let failed = false;
  backend.getItem = (key) => {
    if (!failed) {
      failed = true;
      throw new Error("gesperrt");
    }
    return getItem(key);
  };
  return backend;
}

test("Scheitert das Lesen einmal, kommt der echte Stand vor dem Schreiben in Sicherheit", () => {
  const stored = storedWithUnit();
  const backend = failingOnce(memoryBackend({ [STORAGE_KEYS.state]: stored }));
  const store = createStore(backend, { now: clock(LATER) });
  const { state, error } = store.load();
  assert.equal(error.code, "unavailable");
  assert.deepEqual(state.units, {});
  store.save(state);
  assert.equal(backend.items.get(STORAGE_KEYS.broken), stored);
  assert.deepEqual(JSON.parse(backend.items.get(STORAGE_KEYS.broken)).units.a.box, 3);
  assert.deepEqual(JSON.parse(backend.items.get(STORAGE_KEYS.state)), state);
});

test("Der gerettete Stand lässt sich zurückholen, ein unlesbarer verdrängt den vorigen nicht", () => {
  const stored = storedWithUnit();
  const backend = failingOnce(memoryBackend({ [STORAGE_KEYS.state]: stored }));
  const store = createStore(backend, { now: clock(LATER) });
  store.save(store.load().state);
  assert.equal(store.loadPrevious().units.a.box, 3);

  const junk = failingOnce(memoryBackend({ [STORAGE_KEYS.state]: "kaputt", [STORAGE_KEYS.previous]: stored }));
  const junkStore = createStore(junk, { now: clock(LATER) });
  junkStore.save(junkStore.load().state);
  assert.equal(junk.items.get(STORAGE_KEYS.broken), "kaputt");
  assert.equal(junk.items.get(STORAGE_KEYS.previous), stored);
});

test("Der Fehler zum unlesbaren Speicher trägt seine Kennung und nennt den Ausweg", () => {
  const cause = new Error("gesperrt");
  const error = unreadableError(cause);
  assert.equal(error.code, "unavailable");
  assert.equal(error.cause, cause);
  assert.match(error.message, /Lade die App neu/);
});

test("Die Rettung läuft nur einmal, das nächste save legt nichts mehr beiseite", () => {
  const stored = storedWithUnit();
  const backend = failingOnce(memoryBackend({ [STORAGE_KEYS.state]: stored }));
  const store = createStore(backend, { now: clock(LATER) });
  const { state } = store.load();
  store.save(state);
  store.save(state);
  assert.equal(backend.items.get(STORAGE_KEYS.broken), stored);
  assert.equal(backend.items.has(STORAGE_KEYS.broken + ".1"), false);
});

test("Scheitert das Lesen, und es liegt nichts im Speicher, schreibt save einfach", () => {
  const backend = failingOnce(memoryBackend());
  const store = createStore(backend, { now: clock(LATER) });
  const { state } = store.load();
  store.save(state);
  assert.equal(backend.items.has(STORAGE_KEYS.broken), false);
  assert.ok(backend.items.has(STORAGE_KEYS.state));
});

test("Wirft das Lesen weiter, wirft auch save und schreibt nichts", () => {
  const stored = storedWithUnit();
  const backend = memoryBackend({ [STORAGE_KEYS.state]: stored });
  const getItem = backend.getItem;
  backend.getItem = () => {
    throw new Error("gesperrt");
  };
  const store = createStore(backend, { now: clock(LATER) });
  const { state } = store.load();
  assert.throws(() => store.save(state), /gesperrt/);
  assert.equal(backend.items.get(STORAGE_KEYS.state), stored);
  backend.getItem = getItem;
  store.save(state);
  assert.equal(backend.items.get(STORAGE_KEYS.broken), stored);
});

test("Liest ein zweites load wieder, gilt dessen Stand, und nichts kommt beiseite", () => {
  const stored = storedWithUnit();
  const backend = failingOnce(memoryBackend({ [STORAGE_KEYS.state]: stored }));
  const store = createStore(backend, { now: clock(LATER) });
  store.load();
  const { state, error } = store.load();
  assert.equal(error, null);
  assert.equal(state.units.a.box, 3);
  store.save(state);
  assert.equal(backend.items.has(STORAGE_KEYS.broken), false);
});

// ----- Einzelne kaputte Einheiten -----

test("Eine kaputte Einheit reißt die guten nicht mit und bleibt selbst erhalten", () => {
  const stored = createState(NOW);
  stored.units.good = { ...newUnit(), box: 4 };
  stored.units.bad = { ...newUnit(), box: 6, extra: "bleibt" };
  stored.units.nan = { ...newUnit(), box: null };
  const raw = JSON.stringify(stored);
  const backend = memoryBackend({ [STORAGE_KEYS.state]: raw });
  const store = createStore(backend, { now: clock(LATER) });
  const { state, error } = store.load();
  assert.equal(error.code, "quarantined");
  assert.match(error.message, /\(2\)/);
  assert.deepEqual(Object.keys(state.units), ["good"]);
  assert.equal(state.units.good.box, 4);
  assert.deepEqual(state.quarantine.units.bad, stored.units.bad);
  assert.deepEqual(state.quarantine.units.nan, stored.units.nan);
  assert.equal(backend.items.get(STORAGE_KEYS.broken), raw);
  assert.equal(backend.items.get(STORAGE_KEYS.state), raw);
});

test("Nach dem Speichern liest load den Stand ohne Meldung, die Quarantäne bleibt", () => {
  const stored = createState(NOW);
  stored.units.good = { ...newUnit(), box: 4 };
  stored.units.bad = { ...newUnit(), box: 6 };
  const backend = memoryBackend({ [STORAGE_KEYS.state]: JSON.stringify(stored) });
  const store = createStore(backend, { now: clock(LATER) });
  store.save(store.load().state);
  const again = createStore(backend, { now: clock(LATER) }).load();
  assert.equal(again.error, null);
  assert.equal(again.state.quarantine.units.bad.box, 6);
  assert.equal(again.state.units.good.box, 4);
});

test("Ein Mangel außerhalb der Einheiten bleibt ein kaputter Stand", () => {
  const stored = { ...createState(NOW), partner: {} };
  stored.units.bad = { ...newUnit(), box: 6 };
  const backend = memoryBackend({ [STORAGE_KEYS.state]: JSON.stringify(stored) });
  const { state, error } = createStore(backend, { now: clock(LATER) }).load();
  assert.equal(error.code, "broken");
  assert.deepEqual(state.units, {});
});

// ----- save schreibt nur, was load wieder lesen kann -----

test("save verweigert einen Stand, den load nicht lesen könnte", () => {
  const stored = storedWithUnit();
  const backend = memoryBackend({ [STORAGE_KEYS.state]: stored });
  const store = createStore(backend, { now: clock(LATER) });
  const { state } = store.load();
  const updatedAt = state.updatedAt;
  state.units.a.box = NaN;
  assert.throws(() => store.save(state), /nicht gespeichert.*ungültige Box/);
  assert.equal(backend.items.get(STORAGE_KEYS.state), stored);
  assert.equal(state.updatedAt, updatedAt);
});

// ----- Zu neuer Stand: nichts überschreiben -----

test("Ein zu neuer Stand sperrt save, bis ein load ihn lesen kann", () => {
  const raw = JSON.stringify({ ...createState(NOW), formatVersion: FORMAT_VERSION + 1 });
  const backend = memoryBackend({ [STORAGE_KEYS.state]: raw });
  const store = createStore(backend, { now: clock(LATER) });
  const { state, error } = store.load();
  assert.match(error.message, /Aktualisiere die App/);
  assert.throws(() => store.save(state), (thrown) => thrown === error);
  assert.equal(backend.items.get(STORAGE_KEYS.state), raw);

  const updated = createStore(backend, {
    now: clock(LATER),
    target: FORMAT_VERSION + 1,
  });
  const after = updated.load();
  assert.equal(after.error, null);
  updated.save(after.state);
  assert.notEqual(backend.items.get(STORAGE_KEYS.state), raw);
});

// ----- Der Weg zurück zu den aufgehobenen Ständen -----

test("loadPrevious liefert den aufgehobenen Stand, sonst null", () => {
  const backend = memoryBackend();
  const store = createStore(backend, { now: clock(NOW) });
  assert.equal(store.loadPrevious(), null);
  const { state } = store.load();
  state.units.a = { ...newUnit(), box: 2 };
  store.save(state);
  store.keepPrevious();
  state.units.a.box = 5;
  store.save(state);
  assert.equal(store.loadPrevious().units.a.box, 2);
  backend.items.set(STORAGE_KEYS.previous, "kaputt");
  assert.equal(store.loadPrevious(), null);
});

test("loadPrevious liest auch einen Stand aus einem älteren Format", () => {
  const backend = memoryBackend({ [STORAGE_KEYS.previous]: storedWithUnit() });
  const store = createStore(backend, {
    now: clock(NOW),
    target: FORMAT_VERSION + 1,
    migrations: { [FORMAT_VERSION]: (state) => ({ ...state, addedLater: true }) },
  });
  const previous = store.loadPrevious();
  assert.equal(previous.formatVersion, FORMAT_VERSION + 1);
  assert.equal(previous.addedLater, true);
  assert.equal(previous.units.a.box, 3);
});

test("Läufe der Erkennung ohne Text: die letzten 20, unter eigenem Schlüssel, nie im Lernstand", () => {
  const backend = memoryBackend();
  const store = createStore(backend, { now: clock(NOW) });
  assert.deepEqual(store.loadSpeechLog(), []);
  for (let run = 1; run <= 23; run += 1) {
    store.noteSpeechRun({ at: "t" + run, status: "notMeasured", reason: "noSpeech", events: [{ name: "audiostart", ms: run }] });
  }
  const log = createStore(backend).loadSpeechLog();
  assert.equal(log.length, 20);
  assert.equal(log[0].at, "t4");
  assert.equal(log.at(-1).at, "t23");
  assert.equal(backend.items.has(STORAGE_KEYS.state), false, "Der Lernstand bleibt unberührt");
});

test("Läufe der Erkennung: Ein voller Speicher und Unlesbares stören die Übung nicht", () => {
  const backend = memoryBackend();
  const store = createStore(backend);
  backend.setItem = () => {
    throw new DOMException("voll", "QuotaExceededError");
  };
  store.noteSpeechRun({ at: "t", status: "notMeasured", reason: "noSpeech", events: [] });
  assert.deepEqual(store.loadSpeechLog(), []);
  const broken = memoryBackend({ "radiology-english.app.speechLog": "kein JSON" });
  assert.deepEqual(createStore(broken).loadSpeechLog(), []);
});

test("discardForeignSession: Eine Übung aus einer anderen Version wird verworfen und ihre Art genannt", () => {
  const backend = memoryBackend();
  const store = createStore(backend);
  assert.deepEqual(discardForeignSession(store, "2"), { error: null, discardedKind: null });
  store.saveSession({ kind: "placement", appVersion: "2" });
  assert.deepEqual(discardForeignSession(store, "2"), { error: null, discardedKind: null });
  assert.equal(store.loadSession().kind, "placement", "Die eigene Version bleibt");
  assert.deepEqual(discardForeignSession(store, "3"), { error: null, discardedKind: "placement" });
  assert.equal(store.loadSession(), null);
  store.saveSession({ kind: "speech", appVersion: "2" });
  assert.equal(discardForeignSession(store, "3").discardedKind, "speech");
});

test("discardForeignSession: Wirft der Speicher, läuft die App weiter und meldet es", () => {
  const store = {
    loadSession() {
      throw new Error("gesperrt");
    },
  };
  const result = discardForeignSession(store, "1");
  assert.equal(result.error.code, "unavailable");
  assert.equal(result.discardedKind, null);
});

test("loadBroken liefert alle aufgehobenen Rohfassungen", () => {
  const backend = memoryBackend({ [STORAGE_KEYS.state]: "dritte", [STORAGE_KEYS.broken]: "zweite", [STORAGE_KEYS.broken + ".1"]: "erste" });
  const store = createStore(backend, { now: clock(NOW) });
  assert.deepEqual(store.loadBroken(), ["zweite", "erste"]);
  store.load();
  assert.deepEqual(store.loadBroken(), ["dritte", "erste", "zweite"]);
  assert.deepEqual(createStore(memoryBackend()).loadBroken(), []);
});
