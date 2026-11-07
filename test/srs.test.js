import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays } from "../js/core/dates.js";
import { createState, newUnit, setUnitState, unitState } from "../js/core/state.js";
import { INTERVALS, applyResult, isDue, isLearned, isNew, isWeak, recordExercise } from "../js/core/srs.js";

const TODAY = "2026-11-07";
const NOW = new Date("2026-11-07T08:30:00.000Z");

test("INTERVALS", () => {
  assert.deepEqual(INTERVALS, [1, 3, 7, 14, 30]);
});

test("ok: eine Box höher, Abstand passend zur neuen Box, Zähler und Zeit", () => {
  const unit = applyResult(newUnit(), "ok", TODAY, NOW);
  assert.deepEqual(unit, {
    box: 1,
    due: "2026-11-08",
    seen: 1,
    correct: 1,
    wrong: 0,
    lastResult: "ok",
    lastAt: "2026-11-07T08:30:00.000Z",
    spokenA: false,
    spokenB: false,
  });
});

test("Jeder Abstand: fünfmal richtig, immer am fälligen Tag, ohne echtes Warten", () => {
  let unit = newUnit();
  let day = TODAY;
  const dues = [];
  for (let round = 0; round < 7; round += 1) {
    unit = applyResult(unit, "ok", day, new Date(day + "T10:00:00.000Z"));
    dues.push([unit.box, unit.due]);
    assert.equal(isDue(unit, day), false);
    assert.equal(isDue(unit, addDays(unit.due, -1)), false);
    assert.equal(isDue(unit, unit.due), true);
    day = unit.due;
  }
  assert.deepEqual(dues, [
    [1, "2026-11-08"],
    [2, "2026-11-11"],
    [3, "2026-11-18"],
    [4, "2026-12-02"],
    [5, "2027-01-01"],
    [5, "2027-01-31"],
    [5, "2027-03-02"],
  ]);
  assert.equal(unit.seen, 7);
  assert.equal(unit.correct, 7);
});

test("Rückfall: hint, wrong und notUnderstood setzen auf Box 0 und morgen", () => {
  const advanced = { ...newUnit(), box: 4, due: "2026-11-20", seen: 9, correct: 7, wrong: 2, lastResult: "ok", lastAt: "2026-11-01T00:00:00.000Z" };
  for (const result of ["hint", "wrong", "notUnderstood"]) {
    const unit = applyResult(advanced, result, TODAY, NOW);
    assert.equal(unit.box, 0, result);
    assert.equal(unit.due, "2026-11-08", result);
    assert.equal(unit.seen, 10, result);
    assert.equal(unit.correct, 7, result);
    assert.equal(unit.lastResult, result);
    assert.equal(unit.lastAt, "2026-11-07T08:30:00.000Z");
    assert.equal(isWeak(unit), true);
  }
  assert.equal(applyResult(advanced, "wrong", TODAY, NOW).wrong, 3);
  assert.equal(applyResult(advanced, "notUnderstood", TODAY, NOW).wrong, 3);
  assert.equal(applyResult(advanced, "hint", TODAY, NOW).wrong, 2);
});

test("Nach einem Rückfall geht es von vorn los", () => {
  let unit = { ...newUnit(), box: 3, due: TODAY };
  unit = applyResult(unit, "wrong", TODAY, NOW);
  unit = applyResult(unit, "ok", "2026-11-08", NOW);
  assert.equal(unit.box, 1);
  assert.equal(unit.due, "2026-11-09");
  assert.equal(isWeak(unit), false);
});

test("notMeasured ändert nichts außer seen", () => {
  const before = {
    ...newUnit(),
    box: 3,
    due: "2026-11-20",
    seen: 4,
    correct: 3,
    wrong: 1,
    lastResult: "hint",
    lastAt: "2026-11-01T00:00:00.000Z",
    spokenA: true,
    spokenB: false,
  };
  assert.deepEqual(applyResult(before, "notMeasured", TODAY, NOW), { ...before, seen: 5 });
  const fresh = applyResult(newUnit(), "notMeasured", TODAY, NOW);
  assert.deepEqual(fresh, { ...newUnit(), seen: 1 });
  assert.equal(isNew(fresh), true);
});

test("applyResult ändert die übergebene Einheit nicht und erhält unbekannte Felder", () => {
  const before = Object.freeze({ ...newUnit(), box: 1, future: { a: 1 } });
  for (const result of ["ok", "hint", "wrong", "notUnderstood", "notMeasured"]) {
    const after = applyResult(before, result, TODAY, NOW);
    assert.deepEqual(after.future, { a: 1 }, result);
    assert.notEqual(after, before);
  }
  assert.equal(before.seen, 0);
});

test("applyResult ergänzt fehlende Felder und spoken bleibt unberührt", () => {
  const unit = applyResult({ box: 1, spokenA: true }, "ok", TODAY, NOW);
  assert.equal(unit.box, 2);
  assert.equal(unit.seen, 1);
  assert.equal(unit.correct, 1);
  assert.equal(unit.wrong, 0);
  assert.equal(unit.spokenA, true);
  assert.equal(unit.spokenB, false);
});

test("Ein unbekanntes Ergebnis wirft", () => {
  assert.throws(() => applyResult(newUnit(), "gut", TODAY, NOW), RangeError);
});

test("isDue und isNew", () => {
  assert.equal(isDue(newUnit(), TODAY), false);
  assert.equal(isNew(newUnit()), true);
  const due = { ...newUnit(), due: TODAY, seen: 1 };
  assert.equal(isDue(due, TODAY), true);
  assert.equal(isNew(due), false);
  assert.equal(isDue({ ...due, due: "2026-11-06" }, TODAY), true);
  assert.equal(isDue({ ...due, due: "2026-11-08" }, TODAY), false);
  assert.equal(isDue({ ...due, due: "2026-12-31" }, "2027-01-01"), true);
  assert.equal(isNew({ box: 0 }), true);
});

test("isWeak", () => {
  assert.equal(isWeak(newUnit()), false);
  assert.equal(isWeak({ lastResult: "ok" }), false);
  assert.equal(isWeak({ lastResult: "hint" }), true);
  assert.equal(isWeak({ lastResult: "wrong" }), true);
  assert.equal(isWeak({ lastResult: "notUnderstood" }), true);
});

test("isLearned: Satz nur mit spokenB, Äußerung und Wort ab Box 2", () => {
  const sentence = { type: "sentence" };
  assert.equal(isLearned(sentence, { ...newUnit(), box: 5 }), false);
  assert.equal(isLearned(sentence, { ...newUnit(), box: 5, spokenA: true }), false);
  assert.equal(isLearned(sentence, { ...newUnit(), spokenB: true }), true);
  for (const type of ["patient", "word"]) {
    assert.equal(isLearned({ type }, { ...newUnit(), box: 1 }), false, type);
    assert.equal(isLearned({ type }, { ...newUnit(), box: 2 }), true, type);
    assert.equal(isLearned({ type }, { ...newUnit(), box: 5 }), true, type);
    assert.equal(isLearned({ type }, { ...newUnit(), box: 0, spokenB: true }), false, type);
  }
});

test("recordExercise zählt je Tag und erhält den Rest", () => {
  const state = createState(NOW);
  recordExercise(state, TODAY);
  recordExercise(state, TODAY);
  recordExercise(state, "2026-11-08");
  assert.deepEqual(state.stats.days, { [TODAY]: { exercises: 2 }, "2026-11-08": { exercises: 1 } });
  state.stats.days[TODAY].future = true;
  recordExercise(state, TODAY);
  assert.deepEqual(state.stats.days[TODAY], { exercises: 3, future: true });
  state.stats.days["2026-11-09"] = {};
  recordExercise(state, "2026-11-09");
  assert.equal(state.stats.days["2026-11-09"].exercises, 1);
});

test("Zusammenspiel mit state: ein Ablauf über mehrere Tage", () => {
  const state = createState(NOW);
  const id = "ge.safety.s01";
  setUnitState(state, id, applyResult(unitState(state, id), "ok", TODAY, NOW));
  recordExercise(state, TODAY);
  assert.equal(isDue(unitState(state, id), TODAY), false);
  assert.equal(isDue(unitState(state, id), "2026-11-08"), true);
  setUnitState(state, id, applyResult(unitState(state, id), "wrong", "2026-11-08", NOW));
  assert.deepEqual(
    [unitState(state, id).box, unitState(state, id).due, unitState(state, id).seen, unitState(state, id).correct, unitState(state, id).wrong],
    [0, "2026-11-09", 2, 1, 1],
  );
});
