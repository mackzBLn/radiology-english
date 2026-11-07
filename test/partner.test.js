import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXAMS, loadContent } from "../js/core/content.js";
import { applyRating, ratingPassed, weakUnitsFromRating } from "../js/core/partner.js";
import { planTrain } from "../js/core/planner.js";
import { isDue, isNew } from "../js/core/srs.js";
import { createState, newUnit, unitState } from "../js/core/state.js";

const CONTENT = await loadContent((name) => JSON.parse(readFileSync(new URL("../daten/" + name + ".json", import.meta.url), "utf8")));
const TODAY = "2026-11-07";
const NOW = new Date("2026-11-07T08:00:00.000Z");
const ALL_YES = { "fa.check.1": "yes", "fa.check.2": "yes", "fa.check.3": "yes", "fa.check.4": "yes", "fa.check.5": "no" };

function rating(changes = {}, exam = "mri") {
  return {
    caseId: "fa." + exam + ".3",
    exam,
    type: "final",
    at: NOW.toISOString(),
    ratings: { ...ALL_YES, ...changes },
    helpNote: "",
  };
}

function sectionIds(id) {
  return CONTENT.sections().find((section) => section.id === id).unitIds;
}

function examUnitIds(exam) {
  return CONTENT.examSections(exam).flatMap((section) => section.unitIds);
}

test("ratingPassed: 1 bis 4 ja und 5 nein", () => {
  assert.equal(ratingPassed(ALL_YES), true);
  for (const check of ["fa.check.1", "fa.check.2", "fa.check.3", "fa.check.4"]) {
    assert.equal(ratingPassed({ ...ALL_YES, [check]: "partly" }), false, check);
    assert.equal(ratingPassed({ ...ALL_YES, [check]: "no" }), false, check);
  }
  assert.equal(ratingPassed({ ...ALL_YES, "fa.check.5": "partly" }), false);
  assert.equal(ratingPassed({ ...ALL_YES, "fa.check.5": "yes" }), false);
});

test("ratingPassed: Fehlende Punkte reichen nicht", () => {
  assert.equal(ratingPassed({}), false);
  assert.equal(ratingPassed(undefined), false);
  const { "fa.check.3": removed, ...withoutThree } = ALL_YES;
  assert.equal(removed, "yes");
  assert.equal(ratingPassed(withoutThree), false);
  const { "fa.check.5": help, ...withoutHelp } = ALL_YES;
  assert.equal(help, "no");
  assert.equal(ratingPassed(withoutHelp), false);
});

test("weakUnitsFromRating: Alles bestanden heißt nichts kommt wieder", () => {
  for (const exam of EXAMS) {
    assert.deepEqual(weakUnitsFromRating(rating({}, exam), CONTENT), [], exam);
  }
});

test("Punkt 1: core-Sätze aus safety und greeting der Untersuchung, über die echten Daten", () => {
  for (const exam of EXAMS) {
    for (const value of ["partly", "no"]) {
      const ids = weakUnitsFromRating(rating({ "fa.check.1": value }, exam), CONTENT);
      const scenarios = CONTENT.examSections(exam).filter((section) => ["safety", "greeting"].includes(section.key));
      assert.equal(scenarios.length, 2, exam);
      const expected = scenarios
        .flatMap((section) => section.unitIds)
        .filter((id) => CONTENT.unit(id).type === "sentence" && CONTENT.unit(id).core);
      assert.ok(expected.length > 0, exam);
      assert.deepEqual([...ids].sort(), [...expected].sort(), exam + " " + value);
      for (const id of ids) {
        assert.equal(CONTENT.unit(id).core, true, id);
        assert.equal(CONTENT.unit(id).type, "sentence", id);
        assert.ok(CONTENT.unit(id).exams.includes(exam), id);
        assert.ok(["safety", "greeting"].includes(CONTENT.unit(id).sectionKey), id);
      }
    }
  }
});

test("Punkt 2: Patientenäußerungen der Untersuchung, über die echten Daten", () => {
  for (const exam of EXAMS) {
    const ids = weakUnitsFromRating(rating({ "fa.check.2": "no" }, exam), CONTENT);
    const expected = examUnitIds(exam).filter((id) => CONTENT.unit(id).type === "patient");
    assert.ok(expected.length > 0, exam);
    assert.deepEqual(ids, expected, exam);
    assert.ok(ids.every((id) => CONTENT.unit(id).exams.includes(exam)), exam);
  }
});

test("Punkt 3, 4 und 5: die Abschnitte zum Klären, für jede Untersuchung gleich", () => {
  for (const exam of EXAMS) {
    assert.deepEqual(weakUnitsFromRating(rating({ "fa.check.3": "partly" }, exam), CONTENT), [...sectionIds("kl.repeat"), ...sectionIds("kl.confirm")], exam);
    assert.deepEqual(weakUnitsFromRating(rating({ "fa.check.4": "no" }, exam), CONTENT), sectionIds("kl.teachback"), exam);
    assert.deepEqual(weakUnitsFromRating(rating({ "fa.check.5": "yes" }, exam), CONTENT), sectionIds("kl.rescue"), exam);
    assert.deepEqual(weakUnitsFromRating(rating({ "fa.check.5": "partly" }, exam), CONTENT), sectionIds("kl.rescue"), exam);
  }
  for (const id of ["kl.repeat", "kl.confirm", "kl.teachback", "kl.rescue"]) {
    assert.ok(sectionIds(id).length > 0, id);
  }
});

test("Alle Punkte zugleich: keine Dubletten, jede ID gibt es", () => {
  for (const exam of EXAMS) {
    const ids = weakUnitsFromRating(
      rating({ "fa.check.1": "no", "fa.check.2": "no", "fa.check.3": "no", "fa.check.4": "no", "fa.check.5": "yes" }, exam),
      CONTENT,
    );
    assert.equal(new Set(ids).size, ids.length, exam);
    assert.ok(ids.every((id) => CONTENT.unit(id) !== null), exam);
  }
});

test("Die Untersuchung kann auch aus dem Fall kommen", () => {
  const { exam, ...withoutExam } = rating({ "fa.check.2": "no" }, "ct");
  assert.equal(exam, "ct");
  assert.deepEqual(weakUnitsFromRating(withoutExam, CONTENT), weakUnitsFromRating(rating({ "fa.check.2": "no" }, "ct"), CONTENT));
});

test("Ein Punkt ohne Bewertung holt nichts zurück", () => {
  assert.deepEqual(weakUnitsFromRating({ ...rating(), ratings: {} }, CONTENT), []);
  assert.deepEqual(weakUnitsFromRating({ ...rating(), ratings: { "fa.check.4": "no" } }, CONTENT), sectionIds("kl.teachback"));
});

test("applyRating speichert, rechnet passed und plant alles ein", () => {
  const state = createState(NOW);
  const item = rating({ "fa.check.4": "no", "fa.check.5": "yes" });
  const entry = applyRating(state, { ...item, helpNote: "beim Namen" }, CONTENT, TODAY);
  assert.equal(state.partner.length, 1);
  assert.equal(state.partner[0], entry);
  assert.deepEqual(entry, { ...item, helpNote: "beim Namen", passed: false });
  const ids = [...sectionIds("kl.teachback"), ...sectionIds("kl.rescue")];
  for (const id of ids) {
    assert.equal(typeof state.units[id].due === "string" && state.units[id].due >= TODAY, true, id);
    assert.equal(isNew(state.units[id]), false, id);
  }
  assert.equal(ids.filter((id) => isDue(state.units[id], TODAY)).length, Math.min(ids.length, 15));
  assert.equal(Object.keys(state.units).length, ids.length);
});

test("applyRating bestanden: nur gespeichert, keine Einheit berührt", () => {
  const state = createState(NOW);
  const entry = applyRating(state, rating(), CONTENT, TODAY);
  assert.equal(entry.passed, true);
  assert.deepEqual(state.units, {});
});

test("applyRating erhält unbekannte Felder und alles andere an den Einheiten", () => {
  const id = sectionIds("kl.teachback")[0];
  const state = createState(NOW);
  state.zusatz = { bleibt: true };
  state.partner.push({ caseId: "alt", future: 1 });
  state.units["unbekannte.id"] = { box: 2, future: "x" };
  state.units[id] = { ...newUnit(), box: 4, due: "2026-12-24", seen: 8, correct: 7, wrong: 1, lastResult: "ok", spokenB: true, future: { a: 1 } };
  applyRating(state, rating({ "fa.check.4": "partly" }), CONTENT, TODAY);
  assert.deepEqual(state.units[id], {
    ...newUnit(),
    box: 4,
    due: TODAY,
    seen: 8,
    correct: 7,
    wrong: 1,
    lastResult: "ok",
    spokenB: true,
    future: { a: 1 },
  });
  assert.deepEqual(state.units["unbekannte.id"], { box: 2, future: "x" });
  assert.deepEqual(state.zusatz, { bleibt: true });
  assert.deepEqual(state.partner[0], { caseId: "alt", future: 1 });
  assert.equal(state.partner.length, 2);
});

test("applyRating holt auch überfällige Einheiten auf heute und übersteht JSON", () => {
  const id = sectionIds("kl.rescue")[0];
  const state = createState(NOW);
  state.units[id] = { ...newUnit(), due: "2026-10-01" };
  applyRating(state, rating({ "fa.check.5": "yes" }), CONTENT, TODAY);
  assert.equal(unitState(state, id).due, TODAY);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test("applyRating verteilt: heute höchstens 15, Kernsätze zuerst, nichts rückt nach hinten", () => {
  const state = createState(NOW);
  const weak = rating({ "fa.check.2": "no", "fa.check.3": "no", "fa.check.4": "no", "fa.check.5": "yes" });
  const ids = weakUnitsFromRating(weak, CONTENT);
  assert.ok(ids.length > 30, "Der Test braucht mehr als zwei Tage");
  const early = ids.at(-1);
  state.units[early] = { ...newUnit(), due: TODAY };
  applyRating(state, weak, CONTENT, TODAY);
  const due = (id) => unitState(state, id).due;
  assert.equal(due(early), TODAY, "Schon heute fällig bleibt heute");
  const today = ids.filter((id) => due(id) === TODAY);
  assert.ok(today.length <= 16, "15 und die eine, die schon fällig war");
  assert.equal(ids.every((id) => typeof due(id) === "string" && due(id) >= TODAY), true);
  const byDay = new Map();
  for (const id of ids) {
    byDay.set(due(id), (byDay.get(due(id)) ?? 0) + 1);
  }
  assert.ok([...byDay.values()].every((count) => count <= 16));
  const firstCore = ids.filter((id) => CONTENT.unit(id)?.core === true).slice(0, 15);
  assert.ok(firstCore.length > 0);
  assert.ok(firstCore.every((id) => due(id) === TODAY), "Kernsätze kommen zuerst");
});

test("applyRating zieht eine spätere Einheit nur auf ihren Tag vor", () => {
  const state = createState(NOW);
  const id = sectionIds("kl.teachback")[0];
  state.units[id] = { ...newUnit(), box: 4, due: "2026-12-24" };
  applyRating(state, rating({ "fa.check.4": "no" }), CONTENT, TODAY);
  assert.equal(unitState(state, id).due < "2026-12-24", true);
});

test("Zusammenspiel: Die Einheiten kommen heute im Plan, in der Bahn zuerst", () => {
  const state = createState(NOW);
  applyRating(state, rating({ "fa.check.4": "no" }), CONTENT, TODAY);
  const plan = planTrain({ content: CONTENT, state, today: TODAY, rng: () => 0.5 });
  const count = sectionIds("kl.teachback").length;
  assert.deepEqual(plan.slice(0, count).map((exercise) => exercise.unitId).sort(), [...sectionIds("kl.teachback")].sort());
});
