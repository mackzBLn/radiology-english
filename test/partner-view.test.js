// Was sich an den Ansichten Partner und Fortschritt ohne DOM prüfen lässt. Das Zeichnen prüft der Lauf im Browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXAMS, loadContent } from "../js/core/content.js";
import { weakUnitsFromRating } from "../js/core/partner.js";
import { createState, unitState } from "../js/core/state.js";
import {
  buildRating,
  caseLabel,
  caseName,
  casesOfExam,
  comesBackTitle,
  comesBackWhen,
  createRatingSaver,
  finalStatus,
  isPatientOnly,
  missedChecks,
  openChecks,
  partnerAddress,
  shortRating,
  statusOfCase,
  whatComesBack,
} from "../js/ui/views/partner.js";
import { areaProgress, barPercent, clipNote, dayLabel, dueFromRatings, lastDays, placementOverview, weakCount } from "../js/ui/views/progress.js";
import { parseRoute, routeHash } from "../js/ui/router.js";

const CONTENT = await loadContent((name) => JSON.parse(readFileSync(new URL("../daten/" + name + ".json", import.meta.url), "utf8")));
const TODAY = "2026-11-07";
const NOON = "2026-11-07T12:00:00.000Z";
const NOW = new Date(NOON);
const ALL_GOOD = { "fa.check.1": "yes", "fa.check.2": "yes", "fa.check.3": "yes", "fa.check.4": "yes", "fa.check.5": "no" };

function caseById(id) {
  return CONTENT.cases.find((item) => item.id === id);
}

function entry(caseId, exam, type, at, passed, ratings = ALL_GOOD, helpNote = "") {
  return { caseId, exam, type, at, ratings, helpNote, passed };
}

function fakeCtx(state, failingSaves = 0) {
  const ctx = {
    state,
    saves: 0,
    today: () => TODAY,
    save() {
      ctx.saves += 1;
      if (ctx.saves <= failingSaves) {
        throw new Error("Speicher voll");
      }
    },
  };
  return ctx;
}

// ---------- Partner ----------

test("Je Untersuchung zwei Übungen und ein Abschluss, klar benannt", () => {
  for (const exam of EXAMS) {
    const cases = casesOfExam(CONTENT, exam);
    assert.deepEqual(cases.map(caseLabel), ["Fall 1: Übung", "Fall 2: Übung", "Fall 3: Abschluss"], exam);
  }
  assert.equal(caseName(caseById("fa.xray.3")), "Röntgen, Fall 3: Abschluss");
});

test("Die Namen in der Liste verraten nichts vom Fall", () => {
  for (const item of CONTENT.cases) {
    assert.ok(!caseName(item).includes(item.titleDe), item.id);
    assert.ok(!caseName(item).includes(item.patientProfileDe), item.id);
  }
});

test("Jeder Satz der Rollenkarten hat eine Quelle für den Info-Knopf", () => {
  for (const item of CONTENT.cases) {
    for (const sentence of [...item.answers, ...item.twists]) {
      assert.notEqual(CONTENT.source(sentence.source), null, sentence.id);
      assert.ok(sentence.whenDe && sentence.en && sentence.meaningDe, sentence.id);
    }
    for (const twist of item.twists) {
      assert.ok(twist.expectedDe, twist.id);
    }
  }
});

test("Stand einer Übung aus state.partner", () => {
  const item = caseById("fa.mri.1");
  assert.deepEqual(statusOfCase([], item), { tone: "open", textDe: "Noch nicht geübt" });
  const entries = [entry("fa.mri.2", "mri", "practice", NOON, true), entry("fa.mri.1", "mri", "practice", NOON, false)];
  assert.deepEqual(statusOfCase(entries, item), { tone: "done", textDe: "Zuletzt geübt am 07.11.2026" });
});

test("Stand eines Abschlusses: offen, nicht bestanden, bestanden", () => {
  const item = caseById("fa.ct.3");
  assert.equal(statusOfCase([], item).textDe, "Noch offen");
  const failed = entry("fa.ct.3", "ct", "final", NOON, false);
  assert.deepEqual(statusOfCase([failed], item), { tone: "open", textDe: "Noch nicht bestanden, zuletzt am 07.11.2026" });
  const passed = entry("fa.ct.3", "ct", "final", "2026-11-05T12:00:00.000Z", true);
  assert.deepEqual(statusOfCase([passed, failed], item), { tone: "ok", textDe: "Bestanden am 05.11.2026" });
});

test("finalStatus: nur ein bestandener Abschluss derselben Untersuchung zählt", () => {
  const practice = entry("fa.mri.1", "mri", "practice", NOON, true);
  const otherExam = entry("fa.ct.3", "ct", "final", NOON, true);
  assert.deepEqual(finalStatus([practice, otherExam], "mri"), { passedAt: null, last: practice });
  assert.deepEqual(finalStatus([], "xray"), { passedAt: null, last: null });
  const passed = entry("fa.mri.3", "mri", "final", "2026-11-05T12:00:00.000Z", true);
  assert.deepEqual(finalStatus([passed, practice], "mri"), { passedAt: passed.at, last: practice });
});

test("shortRating fasst eine Bewertung kurz zusammen", () => {
  assert.equal(shortRating(entry("fa.mri.3", "mri", "final", NOON, true)), "Fall 3 (Abschluss) am 07.11.2026, 4 von 4 Punkten, ohne Hilfe");
  const weak = { ...ALL_GOOD, "fa.check.2": "partly", "fa.check.5": "yes" };
  assert.equal(shortRating(entry("fa.ct.1", "ct", "practice", NOON, false, weak)), "Fall 1 (Übung) am 07.11.2026, 3 von 4 Punkten, mit Hilfe");
});

test("partnerAddress führt in die Liste der Fälle, egal wo man gerade steht", () => {
  const folder = "app:/radiology-english/";
  assert.equal(partnerAddress(folder), folder + "#/partner");
  assert.equal(partnerAddress(folder + "#/partner/fa.mri.1/mtr"), folder + "#/partner");
  assert.equal(partnerAddress(folder + "index.html#/"), folder + "index.html#/partner");
});

test("openChecks nennt, was noch fehlt", () => {
  assert.equal(openChecks(CONTENT.checklist, {}).length, 5);
  assert.deepEqual(
    openChecks(CONTENT.checklist, { ...ALL_GOOD, "fa.check.3": undefined }).map((check) => check.id),
    ["fa.check.3"],
  );
  assert.deepEqual(openChecks(CONTENT.checklist, ALL_GOOD), []);
});

test("missedChecks: Beim fünften Punkt ist nein das gute Ergebnis", () => {
  assert.deepEqual(missedChecks(CONTENT.checklist, ALL_GOOD), []);
  assert.deepEqual(missedChecks(CONTENT.checklist, { ...ALL_GOOD, "fa.check.2": "no", "fa.check.5": "partly" }), [
    "Antworten verstanden: nein",
    "Hilfe gebraucht und wobei: teilweise",
  ]);
});

test("buildRating übernimmt den Fall und kürzt die Notiz", () => {
  const draft = { ...ALL_GOOD };
  const rating = buildRating(caseById("fa.mri.3"), draft, "  bei den Zahlen ", NOW);
  assert.deepEqual(rating, { caseId: "fa.mri.3", exam: "mri", type: "final", at: NOON, ratings: ALL_GOOD, helpNote: "bei den Zahlen" });
  draft["fa.check.1"] = "no";
  assert.equal(rating.ratings["fa.check.1"], "yes");
});

test("Zwei Tipps speichern nur einmal", () => {
  const state = createState(NOW);
  const ctx = fakeCtx(state);
  const saveRating = createRatingSaver(ctx, CONTENT);
  const rating = buildRating(caseById("fa.mri.3"), { ...ALL_GOOD, "fa.check.4": "no" }, "", NOW);
  const first = saveRating(rating);
  const second = saveRating(rating);
  assert.equal(state.partner.length, 1);
  assert.equal(ctx.saves, 1);
  assert.equal(second, first);
  assert.equal(first.entry.passed, false);
  assert.equal(first.error, null);
});

test("Scheitert das Schreiben, kommt die Bewertung trotzdem nur einmal in den Lernstand", () => {
  const state = createState(NOW);
  const ctx = fakeCtx(state, 1);
  const saveRating = createRatingSaver(ctx, CONTENT);
  const rating = buildRating(caseById("fa.ct.1"), ALL_GOOD, "", NOW);
  const outcome = saveRating(rating);
  assert.equal(outcome.error.message, "Speicher voll");
  assert.equal(saveRating(rating), outcome);
  assert.equal(state.partner.length, 1);
  assert.equal(ctx.saves, 1);
});

test("whatComesBack: Die Zahl stimmt mit dem überein, was eingeplant wird, heute höchstens 15", () => {
  const weak = { "fa.check.1": "no", "fa.check.2": "partly", "fa.check.3": "partly", "fa.check.4": "no", "fa.check.5": "yes" };
  for (const exam of EXAMS) {
    const state = createState(NOW);
    const rating = buildRating(casesOfExam(CONTENT, exam)[0], weak, "", NOW);
    const comesBack = whatComesBack(rating, CONTENT);
    createRatingSaver(fakeCtx(state), CONTENT)(rating);
    const planned = Object.keys(state.units).filter((id) => typeof unitState(state, id).due === "string");
    const dueToday = planned.filter((id) => unitState(state, id).due === TODAY);
    assert.equal(comesBack.total, planned.length, exam);
    assert.deepEqual([...planned].sort(), [...weakUnitsFromRating(rating, CONTENT)].sort(), exam);
    assert.equal(dueToday.length, 15, exam);
    assert.equal(comesBack.items.length, 5, exam);
    assert.equal(comesBack.items.reduce((sum, part) => sum + part.count, 0), comesBack.total, exam);
    assert.ok(comesBack.items.every((part) => part.count > 0), exam);
  }
});

test("whatComesBack: Alles gut heißt nichts kommt wieder", () => {
  const rating = buildRating(caseById("fa.xray.3"), ALL_GOOD, "", NOW);
  assert.deepEqual(whatComesBack(rating, CONTENT), { total: 0, items: [] });
});

test("comesBackTitle: Einzahl, Mehrzahl, nichts", () => {
  assert.equal(comesBackTitle(0), "Es kommt nichts extra wieder dran");
  assert.equal(comesBackTitle(1), "1 Satz oder Wort kommt wieder dran");
  assert.equal(comesBackTitle(12), "12 Sätze und Wörter kommen wieder dran");
});

test("comesBackWhen: bis 15 heute, darüber verteilt, ohne Zahl kein Satz", () => {
  assert.equal(comesBackWhen(0), null);
  assert.equal(comesBackWhen(15), "Das ist heute in der Bahn fällig.");
  assert.equal(comesBackWhen(16), "Heute sind die wichtigsten 15 in der Bahn fällig, der Rest verteilt sich auf die nächsten Tage.");
});

test("isPatientOnly: nur die eigene Route für den Partner, ein echter Fall nicht", () => {
  assert.equal(isPatientOnly({ caseId: "alle", role: "patient" }), true);
  assert.equal(isPatientOnly(parseRoute(routeHash("partner", "alle", "patient")).params), true);
  assert.equal(isPatientOnly({ caseId: "alle", role: "mtr" }), false);
  assert.equal(isPatientOnly({ caseId: "fa.mri.1", role: "patient" }), false);
  assert.equal(isPatientOnly({}), false);
  assert.equal(isPatientOnly(undefined), false);
  assert.equal(CONTENT.cases.some((item) => item.id === "alle"), false);
});

// ---------- Fortschritt ----------

test("lastDays: sieben Tage bis heute, auch über den Monatswechsel", () => {
  const state = createState(NOW);
  state.stats.days = { "2026-11-02": { exercises: 3 }, "2026-10-30": { exercises: 9 }, "2026-11-07": { exercises: 1 }, "2026-11-01": { exercises: 2 } };
  assert.deepEqual(lastDays(state, TODAY), [
    { date: "2026-11-01", exercises: 2 },
    { date: "2026-11-02", exercises: 3 },
    { date: "2026-11-03", exercises: 0 },
    { date: "2026-11-04", exercises: 0 },
    { date: "2026-11-05", exercises: 0 },
    { date: "2026-11-06", exercises: 0 },
    { date: "2026-11-07", exercises: 1 },
  ]);
  assert.equal(lastDays(createState(NOW), "2026-11-03")[0].date, "2026-10-28");
});

test("dayLabel: heute, sonst Wochentag und Datum", () => {
  assert.equal(dayLabel(TODAY, TODAY), "Heute");
  assert.equal(dayLabel("2026-11-06", TODAY), "Fr 06.11.");
  assert.equal(dayLabel("2026-11-01", TODAY), "So 01.11.");
});

test("barPercent: Der stärkste Tag füllt die Breite, ohne Übung bleibt alles leer", () => {
  assert.equal(barPercent(5, 5), 100);
  assert.equal(barPercent(1, 3), 33);
  assert.equal(barPercent(0, 4), 0);
  assert.equal(barPercent(0, 0), 0);
});

test("areaProgress: fünf Bereiche, gesamt aus den Abschnitten und examSections", () => {
  const areas = areaProgress(CONTENT, createState(NOW));
  assert.deepEqual(areas.map((area) => area.labelDe), ["Satzbau", "Klären", "MRT", "CT", "Röntgen"]);
  assert.ok(areas.every((area) => area.learned === 0 && area.total > 0));
  const examIds = new Set(CONTENT.examSections("ct").flatMap((section) => section.unitIds));
  assert.equal(areas[3].total, examIds.size);
  const clarifyIds = CONTENT.sections().filter((section) => section.file === "klaeren").flatMap((section) => section.unitIds);
  assert.equal(areas[1].total, new Set(clarifyIds).size);
});

test("areaProgress zählt nach isLearned: Satz nur mit spokenB, Patientenäußerung ab Box 2", () => {
  const scenario = CONTENT.examSections("mri").flatMap((section) => section.unitIds);
  const sentence = scenario.find((id) => CONTENT.unit(id).type === "sentence");
  const patient = scenario.find((id) => CONTENT.unit(id).type === "patient");
  const state = createState(NOW);
  state.units[sentence] = { box: 5 };
  state.units[patient] = { box: 1 };
  assert.equal(areaProgress(CONTENT, state)[2].learned, 0);
  state.units[sentence] = { box: 0, spokenB: true };
  state.units[patient] = { box: 2 };
  assert.equal(areaProgress(CONTENT, state)[2].learned, 2);
});

test("weakCount zählt hint, wrong und notUnderstood", () => {
  const state = createState(NOW);
  state.units = {
    a: { lastResult: "hint" },
    b: { lastResult: "wrong" },
    c: { lastResult: "notUnderstood" },
    d: { lastResult: "ok" },
    e: { lastResult: null },
  };
  assert.equal(weakCount(state), 3);
  assert.equal(weakCount(createState(NOW)), 0);
});

test("dueFromRatings zählt die heute fälligen Einheiten aus Bewertungen, Geübtes nicht mehr", () => {
  const state = createState(NOW);
  assert.equal(dueFromRatings(state, CONTENT, TODAY), 0);
  const rating = buildRating(caseById("fa.mri.1"), { ...ALL_GOOD, "fa.check.4": "no" }, "", NOW);
  createRatingSaver(fakeCtx(state), CONTENT)(rating);
  const ids = weakUnitsFromRating(rating, CONTENT);
  assert.ok(ids.length > 0);
  assert.equal(dueFromRatings(state, CONTENT, TODAY), ids.length);
  state.units[ids[0]] = { ...state.units[ids[0]], due: "2026-11-20" };
  assert.equal(dueFromRatings(state, CONTENT, TODAY), ids.length - 1);
  assert.equal(weakCount(state), 0, "Fällig aus der Bewertung heißt nicht schwach");
});

test("areaProgress nennt auch, was schon geübt ist", () => {
  const scenario = CONTENT.examSections("mri").flatMap((section) => section.unitIds);
  const state = createState(NOW);
  state.units[scenario[0]] = { box: 1, seen: 2 };
  state.units[scenario[1]] = { box: 0, seen: 0, due: TODAY };
  const area = areaProgress(CONTENT, state)[2];
  assert.equal(area.learned, 0);
  assert.equal(area.practiced, 1, "Fällig aus einer Bewertung, aber noch nie geübt, zählt nicht");
});

test("placementOverview: Ohne Versuch nichts, sonst erster und letzter Versuch je Teil", () => {
  assert.equal(placementOverview([]), null);
  const part = (level, extra = {}) => ({ measured: true, level, belowA1: false, ...extra });
  const first = {
    form: "A",
    at: "2026-11-01T12:00:00.000Z",
    overall: "A1",
    parts: { speaking: part("A1", { belowA1: true }), listening: part("A2"), writing: { measured: false, level: null, belowA1: false } },
  };
  const middle = { ...first, form: "B", at: "2026-11-03T12:00:00.000Z" };
  const latest = { form: "A", at: NOON, overall: "B1", parts: { speaking: part("B1"), listening: part("B1"), writing: part("A2") } };

  const single = placementOverview([first]);
  assert.equal(single.count, 1);
  assert.deepEqual(single.rows[0], { labelDe: "Sprechen", first: "unter A1", latest: "unter A1" });

  const overview = placementOverview([first, middle, latest]);
  assert.equal(overview.count, 3);
  assert.equal(overview.firstAt, first.at);
  assert.equal(overview.latestAt, latest.at);
  assert.deepEqual(overview.rows, [
    { labelDe: "Sprechen", first: "unter A1", latest: "B1" },
    { labelDe: "Hören", first: "A2", latest: "B1" },
    { labelDe: "Schreiben", first: "nicht gemessen", latest: "A2" },
    { labelDe: "Gesamt", first: "A1", latest: "B1" },
  ]);
});

test("clipNote kürzt nur lange Notizen", () => {
  assert.equal(clipNote("bei den Zahlen"), "bei den Zahlen");
  const clipped = clipNote("x".repeat(200));
  assert.equal(clipped.length, 80);
  assert.ok(clipped.endsWith("…"));
});
