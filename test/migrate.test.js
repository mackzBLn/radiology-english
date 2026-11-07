import { test } from "node:test";
import assert from "node:assert/strict";
import { BrokenStateError, FormatTooNewError, MIGRATIONS, migrate } from "../js/core/migrate.js";
import { FORMAT_VERSION, createState, newUnit } from "../js/core/state.js";

const NOW = new Date("2026-11-07T08:30:00.000Z");

function currentState() {
  const state = createState(NOW);
  state.units["mr.safety.s01"] = { ...newUnit(), box: 2, due: "2026-11-10", extraUnit: "bleibt" };
  state.units["gibt.es.nicht.mehr"] = { ...newUnit(), box: 4 };
  state.extraTop = { nested: [1, 2, 3] };
  state.settings.extraSetting = true;
  return state;
}

test("Der aktuelle Stand bleibt unverändert und gilt nicht als migriert", () => {
  const raw = currentState();
  const { state, migratedFrom } = migrate(raw);
  assert.equal(migratedFrom, null);
  assert.deepEqual(state, raw);
  assert.notEqual(state, raw);
  assert.equal(raw.formatVersion, FORMAT_VERSION);
});

test("Die Eingabe bleibt bei einer Migration unangetastet", () => {
  const raw = currentState();
  const before = structuredClone(raw);
  migrate(raw, {
    target: FORMAT_VERSION + 1,
    migrations: {
      [FORMAT_VERSION]: (old) => {
        old.units = {};
        return old;
      },
    },
  });
  assert.deepEqual(raw, before);
});

test("Eine untergeschobene Migration liest einen älteren Stand ohne Verlust", () => {
  const raw = currentState();
  const result = migrate(raw, {
    target: FORMAT_VERSION + 1,
    migrations: { [FORMAT_VERSION]: (old) => ({ ...old, addedLater: "neu" }) },
  });
  assert.equal(result.migratedFrom, FORMAT_VERSION);
  assert.equal(result.state.formatVersion, FORMAT_VERSION + 1);
  assert.equal(result.state.addedLater, "neu");
  assert.deepEqual(result.state.units, raw.units);
  assert.deepEqual(result.state.extraTop, raw.extraTop);
  assert.equal(result.state.settings.extraSetting, true);
});

test("Mehrere Migrationen laufen der Reihe nach", () => {
  const order = [];
  const result = migrate(
    { formatVersion: 1, keep: "ja" },
    {
      target: 4,
      migrations: {
        1: (old) => {
          order.push(old.formatVersion);
          return { ...old, one: true };
        },
        2: (old) => {
          order.push(old.formatVersion);
          return { ...old, two: true };
        },
        3: (old) => {
          order.push(old.formatVersion);
          return { ...old, three: true };
        },
      },
    },
  );
  assert.deepEqual(order, [1, 2, 3]);
  assert.equal(result.migratedFrom, 1);
  assert.equal(result.state.formatVersion, 4);
  assert.equal(result.state.keep, "ja");
  assert.equal(result.state.one && result.state.two && result.state.three, true);
});

test("Ein zu neues Format wird mit FormatTooNewError abgelehnt", () => {
  assert.throws(
    () => migrate({ ...currentState(), formatVersion: FORMAT_VERSION + 1 }),
    (error) => {
      assert.ok(error instanceof FormatTooNewError);
      assert.equal(error.found, FORMAT_VERSION + 1);
      assert.equal(error.supported, FORMAT_VERSION);
      return true;
    },
  );
});

test("Fehlt eine Migration, ist der Stand nicht lesbar", () => {
  assert.equal(Object.keys(MIGRATIONS).length, 0);
  assert.throws(() => migrate({ formatVersion: 0 }), BrokenStateError);
  assert.throws(() => migrate({ formatVersion: 1 }, { target: 2, migrations: {} }), BrokenStateError);
});

test("Eine Migration ohne Ergebnis wird nicht übernommen", () => {
  assert.throws(
    () => migrate({ formatVersion: 1 }, { target: 2, migrations: { 1: () => null } }),
    BrokenStateError,
  );
});

test("Kaputte Stände werden abgelehnt", () => {
  for (const raw of [null, undefined, 5, "text", [], {}, { formatVersion: "1" }, { formatVersion: 1.5 }, { formatVersion: -1 }]) {
    assert.throws(() => migrate(raw), BrokenStateError, JSON.stringify(raw));
  }
  assert.throws(() => migrate({ formatVersion: 1, units: "x" }), BrokenStateError);
  assert.throws(() => migrate({ formatVersion: 1, units: { a: { box: 9 } } }), BrokenStateError);
});

test("Fehlende Bereiche werden beim Lesen ergänzt", () => {
  const { state } = migrate({ formatVersion: 1, units: { a: { box: 1 } } });
  assert.deepEqual(state.units, { a: { box: 1 } });
  assert.deepEqual(state.placement, { attempts: [], plan: null });
  assert.deepEqual(state.partner, []);
  assert.equal(state.settings.slowRate, 0.6);
});
