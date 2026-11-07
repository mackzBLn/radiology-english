import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { backupFileName, createBackup, createRawExport, parseBackup, rawExportFileName } from "../js/core/backup.js";
import { FORMAT_VERSION, createState, newUnit } from "../js/core/state.js";

const NOW = new Date("2026-11-07T08:30:00.000Z");
const FIXTURE = readFileSync(new URL("./fixtures/backup-v1.json", import.meta.url), "utf8");

function fixture() {
  return JSON.parse(FIXTURE);
}

function assertRejected(result, pattern) {
  assert.equal(result.ok, false);
  assert.equal(typeof result.reasonDe, "string");
  assert.ok(result.reasonDe.length > 0);
  assert.match(result.reasonDe, pattern);
  assert.equal(result.state, undefined);
}

test("createBackup liefert die vereinbarten Felder und eine eigene Kopie", () => {
  const state = createState(NOW);
  const backup = createBackup(state, { appVersion: "0.9.0", now: NOW });
  assert.deepEqual(backup, {
    app: "radiology-english",
    kind: "backup",
    formatVersion: FORMAT_VERSION,
    createdAt: "2026-11-07T08:30:00.000Z",
    appVersion: "0.9.0",
    state,
  });
  assert.notEqual(backup.state, state);
});

test("backupFileName nimmt den lokalen Tag", () => {
  assert.equal(backupFileName(new Date(2026, 10, 7, 23, 30)), "radiology-english-lernstand-2026-11-07.json");
  assert.equal(backupFileName(new Date(2027, 0, 3, 0, 5)), "radiology-english-lernstand-2027-01-03.json");
});

test("Sichern und Einlesen geht ohne Verlust", () => {
  const state = createState(NOW);
  state.units["mr.safety.s01"] = { ...newUnit(), box: 2, due: "2026-11-10", seen: 4, correct: 3, wrong: 1 };
  state.placement.attempts.push({ form: "A", at: NOW.toISOString(), parts: {}, overall: "A2", gaps: [], strengths: [] });
  state.placement.plan = { order: ["sb.questions"], noteDe: "Erst der Satzbau." };
  state.partner.push({ caseId: "fa.ct.1", exam: "ct", type: "practice", at: NOW.toISOString(), ratings: {}, helpNote: "", passed: false });
  state.settings.lang = "en-US";
  state.backup.lastAt = NOW.toISOString();
  state.stats.days["2026-11-07"] = { exercises: 12 };

  const text = JSON.stringify(createBackup(state, { appVersion: "0.9.0", now: NOW }));
  const result = parseBackup(text);
  assert.equal(result.ok, true);
  assert.deepEqual(result.state, state);
  assert.deepEqual(result.info, {
    createdAt: "2026-11-07T08:30:00.000Z",
    appVersion: "0.9.0",
    formatVersion: FORMAT_VERSION,
    units: 1,
    attempts: 1,
  });
});

test("Unbekannte Felder und IDs bleiben beim Einlesen erhalten", () => {
  const result = parseBackup(FIXTURE);
  assert.equal(result.ok, true);
  assert.deepEqual(result.state, fixture().state);
  assert.equal(result.state.extraTop.nested[2].deep, true);
  assert.equal(result.state.units["mr.safety.s01"].extraUnit, "bleibt");
  assert.equal(result.state.units["gibt.es.nicht.mehr"].box, 5);
  assert.equal(result.state.placement.extraPlacement, 42);
  assert.equal(result.state.settings.extraSetting, "bleibt");
  assert.equal(result.state.stats.days["2026-11-07"].extraDay, 1);
  assert.deepEqual(result.info, {
    createdAt: "2026-11-07T08:30:00.000Z",
    appVersion: "0.9.0",
    formatVersion: 1,
    units: 2,
    attempts: 1,
  });
});

test("Eine Sicherung übersteht einen zweiten Durchgang unverändert", () => {
  const first = parseBackup(FIXTURE);
  const second = parseBackup(JSON.stringify(createBackup(first.state, { appVersion: "0.9.0", now: NOW })));
  assert.equal(second.ok, true);
  assert.deepEqual(second.state, first.state);
});

test("Eine Byte-Reihenfolge-Marke am Anfang stört nicht", () => {
  assert.throws(() => JSON.parse("﻿" + FIXTURE), SyntaxError);
  assert.equal(parseBackup("﻿" + FIXTURE).ok, true);
});

test("Kaputte Dateien werden mit Grund abgelehnt", () => {
  assertRejected(parseBackup(""), /beschädigt/);
  assertRejected(parseBackup("kein JSON"), /beschädigt/);
  assertRejected(parseBackup(FIXTURE.slice(0, FIXTURE.length / 2)), /beschädigt/);
  assertRejected(parseBackup(undefined), /nicht lesen/);
  assertRejected(parseBackup(null), /nicht lesen/);
});

test("Fremde Dateien werden mit Grund abgelehnt", () => {
  const foreign = [
    "null",
    "5",
    "[]",
    "{}",
    JSON.stringify({ name: "anderes Programm", version: 3 }),
    JSON.stringify({ ...fixture(), app: "andere-app" }),
    JSON.stringify({ ...fixture(), kind: "export" }),
    JSON.stringify(fixture().state),
  ];
  for (const text of foreign) {
    assertRejected(parseBackup(text), /keine Sicherung/);
  }
});

test("Unvollständige und beschädigte Sicherungen werden mit Grund abgelehnt", () => {
  const withoutState = fixture();
  delete withoutState.state;
  assertRejected(parseBackup(JSON.stringify(withoutState)), /keinen Lernstand/);

  const withoutFormat = fixture();
  delete withoutFormat.formatVersion;
  assertRejected(parseBackup(JSON.stringify(withoutFormat)), /Formatversion/);

  const mismatch = fixture();
  mismatch.state.formatVersion = mismatch.formatVersion + 1;
  assertRejected(parseBackup(JSON.stringify(mismatch)), /passt nicht/);

  const badUnit = fixture();
  badUnit.state.units["mr.safety.s01"].box = 99;
  assertRejected(parseBackup(JSON.stringify(badUnit)), /beschädigt.*mr\.safety\.s01/);

  const badUnits = fixture();
  badUnits.state.units = "falsch";
  assertRejected(parseBackup(JSON.stringify(badUnits)), /beschädigt/);

  const badPartner = fixture();
  badPartner.state.partner = {};
  assertRejected(parseBackup(JSON.stringify(badPartner)), /beschädigt/);
});

test("Eine zu neue Formatversion wird mit Grund abgelehnt", () => {
  const newer = fixture();
  newer.formatVersion = FORMAT_VERSION + 1;
  newer.state.formatVersion = FORMAT_VERSION + 1;
  const result = parseBackup(JSON.stringify(newer));
  assertRejected(result, /neueren Version/);
  assert.match(result.reasonDe, /Aktualisiere/);
});

test("Eine ältere Sicherung wird über die Migration gelesen, ohne Verlust", () => {
  const original = fixture();
  const result = parseBackup(FIXTURE, {
    target: FORMAT_VERSION + 1,
    migrations: { [FORMAT_VERSION]: (state) => ({ ...state, addedLater: "neu" }) },
  });
  assert.equal(result.ok, true);
  assert.equal(result.state.formatVersion, FORMAT_VERSION + 1);
  assert.equal(result.state.addedLater, "neu");
  assert.deepEqual(result.state.units, original.state.units);
  assert.deepEqual(result.state.extraTop, original.state.extraTop);
  assert.deepEqual(result.state.placement, original.state.placement);
  assert.equal(result.info.formatVersion, FORMAT_VERSION);
});

test("Die Meldung zu einer unlesbaren Datei nennt keine Technik und die richtige Datei", () => {
  const result = parseBackup("kein JSON");
  assert.doesNotMatch(result.reasonDe, /JSON/);
  assert.match(result.reasonDe, /radiology-english-lernstand-/);
});

test("Rohdaten lassen sich als Datei ablegen, sind aber keine Sicherung", () => {
  const items = ["{ kaputt", "ältere Fassung"];
  const raw = createRawExport(items, { appVersion: "0.9.0", now: NOW });
  assert.deepEqual(raw, {
    app: "radiology-english",
    kind: "raw",
    createdAt: "2026-11-07T08:30:00.000Z",
    appVersion: "0.9.0",
    items,
  });
  assert.equal(rawExportFileName(new Date(2026, 10, 7, 23, 30)), "radiology-english-rohdaten-2026-11-07.json");
  assertRejected(parseBackup(JSON.stringify(raw)), /keine Sicherung/);
});

test("Eine ältere Sicherung ohne passende Migration wird mit Grund abgelehnt", () => {
  const older = fixture();
  older.formatVersion = 0;
  older.state.formatVersion = 0;
  assertRejected(parseBackup(JSON.stringify(older)), /beschädigt.*keine Migration/);
});
