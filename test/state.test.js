import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FORMAT_VERSION,
  createState,
  newUnit,
  quarantineBrokenUnits,
  setUnitState,
  stateProblem,
  unitState,
  withDefaults,
} from "../js/core/state.js";

const NOW = new Date("2026-11-07T08:30:00.000Z");

test("stateProblem: Einträge in Versuchen und Partnerübungen müssen Objekte sein", () => {
  const state = () => createState(NOW);
  const withAttempt = state();
  withAttempt.placement.attempts = [null];
  assert.equal(stateProblem(withAttempt), "Die Einstufung ist beschädigt");
  const withNumber = state();
  withNumber.placement.attempts = [{ form: "A" }, 3];
  assert.equal(stateProblem(withNumber), "Die Einstufung ist beschädigt");
  const withPartner = state();
  withPartner.partner = [null];
  assert.equal(stateProblem(withPartner), "Die Partnerübungen sind beschädigt");
  const fine = state();
  fine.placement.attempts = [{ form: "A", unbekannt: 1 }];
  fine.partner = [{ caseId: "fa.mri.1" }];
  assert.equal(stateProblem(fine), null);
});

test("createState liefert den vereinbarten Aufbau", () => {
  assert.equal(FORMAT_VERSION, 1);
  assert.deepEqual(createState(NOW), {
    formatVersion: 1,
    createdAt: "2026-11-07T08:30:00.000Z",
    updatedAt: "2026-11-07T08:30:00.000Z",
    units: {},
    placement: { attempts: [], plan: null },
    partner: [],
    settings: { voiceURI: null, lang: "en-GB", slowRate: 0.6 },
    backup: { lastAt: null },
    stats: { days: {} },
  });
});

test("Jeder neue Stand hat eigene Bereiche", () => {
  const first = createState(NOW);
  const second = createState(NOW);
  first.units.a = newUnit();
  first.settings.lang = "en-US";
  assert.deepEqual(second.units, {});
  assert.equal(second.settings.lang, "en-GB");
});

test("unitState liefert eine neue Einheit, ohne den Stand zu ändern", () => {
  const state = createState(NOW);
  const unit = unitState(state, "mr.safety.s01");
  assert.deepEqual(unit, {
    box: 0,
    due: null,
    seen: 0,
    correct: 0,
    wrong: 0,
    lastResult: null,
    lastAt: null,
    spokenA: false,
    spokenB: false,
  });
  assert.deepEqual(state.units, {});
});

test("unitState liefert die vorhandene Einheit samt unbekannten Feldern als Kopie", () => {
  const state = createState(NOW);
  const stored = { ...newUnit(), box: 3, due: "2026-11-10", extra: "bleibt" };
  setUnitState(state, "mr.safety.s01", stored);
  const unit = unitState(state, "mr.safety.s01");
  assert.deepEqual(unit, stored);
  unit.box = 0;
  assert.equal(state.units["mr.safety.s01"].box, 3);
});

test("unitState ergänzt fehlende Felder einer alten Einheit", () => {
  const state = createState(NOW);
  state.units.a = { box: 2 };
  assert.deepEqual(unitState(state, "a"), { ...newUnit(), box: 2 });
});

test("unitState fällt nicht auf geerbte Namen herein", () => {
  const state = createState(NOW);
  assert.deepEqual(unitState(state, "constructor"), newUnit());
});

test("setUnitState speichert auch unbekannte IDs", () => {
  const state = createState(NOW);
  setUnitState(state, "gibt.es.nicht.mehr", newUnit());
  assert.deepEqual(Object.keys(state.units), ["gibt.es.nicht.mehr"]);
});

test("withDefaults ergänzt Fehlendes und behält Unbekanntes", () => {
  const complete = withDefaults({
    formatVersion: 1,
    extraTop: { a: 1 },
    units: { x: { box: 1, extraUnit: true } },
    settings: { lang: "en-US", extraSetting: 5 },
    placement: { attempts: [{ form: "A" }], extraPlacement: "z" },
    stats: { extraStats: [1, 2] },
  });
  assert.deepEqual(complete.extraTop, { a: 1 });
  assert.deepEqual(complete.units, { x: { box: 1, extraUnit: true } });
  assert.deepEqual(complete.settings, { voiceURI: null, lang: "en-US", slowRate: 0.6, extraSetting: 5 });
  assert.deepEqual(complete.placement, { attempts: [{ form: "A" }], plan: null, extraPlacement: "z" });
  assert.deepEqual(complete.stats, { days: {}, extraStats: [1, 2] });
  assert.deepEqual(complete.backup, { lastAt: null });
  assert.deepEqual(complete.partner, []);
  assert.equal(stateProblem(complete), null);
});

test("stateProblem nimmt einen neuen Stand an", () => {
  assert.equal(stateProblem(createState(NOW)), null);
});

test("stateProblem benennt beschädigte Bereiche", () => {
  const broken = [
    ["kein Objekt", []],
    ["keine Formatversion", { ...createState(NOW), formatVersion: "1" }],
    ["Zeit kein Text", { ...createState(NOW), createdAt: 5 }],
    ["Einheiten als Liste", { ...createState(NOW), units: [] }],
    ["Einheit kein Objekt", { ...createState(NOW), units: { a: 5 } }],
    ["Box zu hoch", { ...createState(NOW), units: { a: { box: 6 } } }],
    ["Box keine Zahl", { ...createState(NOW), units: { a: { box: "2" } } }],
    ["Datum falsch", { ...createState(NOW), units: { a: { due: "morgen" } } }],
    ["Zähler negativ", { ...createState(NOW), units: { a: { seen: -1 } } }],
    ["Einstufung falsch", { ...createState(NOW), placement: { attempts: {}, plan: null } }],
    ["Plan falsch", { ...createState(NOW), placement: { attempts: [], plan: "x" } }],
    ["Partner falsch", { ...createState(NOW), partner: {} }],
    ["Einstellungen falsch", { ...createState(NOW), settings: 1 }],
    ["Sicherung falsch", { ...createState(NOW), backup: null }],
    ["Statistik falsch", { ...createState(NOW), stats: { days: [] } }],
  ];
  for (const [label, state] of broken) {
    assert.equal(typeof stateProblem(state), "string", label);
  }
});

test("stateProblem lässt gültige Einheiten durch", () => {
  const state = createState(NOW);
  state.units.a = { ...newUnit(), box: 5, due: "2026-11-08", seen: 3, correct: 2, wrong: 1, extra: {} };
  state.units.b = { ...newUnit(), box: 0, due: null };
  assert.equal(stateProblem(state), null);
});

test("quarantineBrokenUnits legt nur kaputte Einheiten beiseite und ergänzt Vorhandenes", () => {
  const state = createState(NOW);
  state.units.good = { ...newUnit(), box: 2 };
  state.units.bad = { box: 6 };
  state.units.noObject = 5;
  state.quarantine = { units: { older: { box: 9 } }, extra: "bleibt" };
  assert.equal(quarantineBrokenUnits(state), 2);
  assert.deepEqual(Object.keys(state.units), ["good"]);
  assert.deepEqual(state.quarantine, { units: { older: { box: 9 }, bad: { box: 6 }, noObject: 5 }, extra: "bleibt" });
  assert.equal(stateProblem(state), null);
});

test("quarantineBrokenUnits ändert nichts, wenn es nichts beiseitezulegen gibt", () => {
  const state = createState(NOW);
  state.units.good = newUnit();
  const before = structuredClone(state);
  assert.equal(quarantineBrokenUnits(state), 0);
  assert.deepEqual(state, before);
  assert.equal(quarantineBrokenUnits(null), 0);
  assert.equal(quarantineBrokenUnits({ units: "falsch" }), 0);
});
