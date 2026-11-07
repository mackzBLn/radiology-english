import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXAMS, loadContent } from "../js/core/content.js";
import { deriveKeywords, matchSpoken, matchTyped } from "../js/core/matcher.js";
import { normalizeText, surfaceWords } from "../js/core/normalize.js";
import { buildExercise, canAlsoBeRight, focusUnits, kindsFor, planSpeech, planTrain } from "../js/core/planner.js";
import { addDays } from "../js/core/dates.js";
import { applyResult, recordExercise } from "../js/core/srs.js";
import { createState, newUnit, setUnitState, stateProblem, unitState } from "../js/core/state.js";

const CONTENT = await loadContent((name) => JSON.parse(readFileSync(new URL("../daten/" + name + ".json", import.meta.url), "utf8")));
const TODAY = "2026-11-07";
const NOW = new Date("2026-11-07T08:00:00.000Z");
const UNITS = CONTENT.allUnits();
const CHOICE_KINDS = ["pickEnglish", "hearMeaning", "wordHear", "wordPick", "hearReact"];

function seeded(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function stateOf(units = {}, order = null) {
  const state = createState(NOW);
  state.units = units;
  state.placement.plan = order ? { order, noteDe: "Testplan" } : null;
  return state;
}

function dueProgress(box, extra = {}) {
  return { ...newUnit(), box, due: "2026-11-06", seen: 3, correct: 2, wrong: 1, lastResult: "ok", ...extra };
}

function laterProgress(box = 2) {
  return { ...newUnit(), box, due: "2026-12-24", seen: 3, correct: 3, lastResult: "ok" };
}

function train(state, extra = {}) {
  return planTrain({ content: CONTENT, state, today: TODAY, rng: seeded(7), ...extra });
}

function speech(state, extra = {}) {
  return planSpeech({ content: CONTENT, state, today: TODAY, rng: seeded(7), ...extra });
}

function typeCounts(unitIds) {
  const counts = { sentence: 0, patient: 0, word: 0 };
  for (const id of new Set(unitIds)) {
    counts[CONTENT.unit(id).type] += 1;
  }
  return counts;
}

// ----- Jede Einheit, jede Art -----

function assertFairOptions(unit, exercise, label) {
  assert.equal(exercise.unitId, unit.id, label);
  assert.equal("answer" in exercise, exercise.kind === "buildSentence", label);
  if (!CHOICE_KINDS.includes(exercise.kind)) {
    return;
  }
  const texts = exercise.options.map((option) => normalizeText(option.text));
  assert.equal(new Set(texts).size, texts.length, label + " doppelt: " + texts.join(" / "));
  const right = exercise.options.filter((option) => option.correct === true);
  const wrong = exercise.options.filter((option) => option.correct === false);
  assert.equal(right.length, 1, label);
  assert.equal(wrong.length + 1, exercise.options.length, label);
  assert.ok(wrong.length >= (exercise.kind === "hearReact" ? 2 : 3), label + " hat zu wenig falsche Antworten");

  const forbidden = new Set();
  if (exercise.kind === "pickEnglish" || exercise.kind === "wordPick") {
    assert.equal(right[0].text, unit.en, label);
    for (const text of [unit.en, ...unit.variants]) {
      forbidden.add(normalizeText(text));
    }
  } else if (exercise.kind === "hearReact") {
    forbidden.add(normalizeText(right[0].text));
  } else {
    assert.equal(right[0].text, unit.meaningDe, label);
    forbidden.add(normalizeText(unit.meaningDe));
  }
  for (const option of wrong) {
    assert.equal(forbidden.has(normalizeText(option.text)), false, label + ": " + option.text);
    assert.notEqual(option.text, right[0].text, label);
  }
}

test("Echte Daten: Für jede der 540 Einheiten lässt sich jede vorgesehene Art bauen, falsche Antworten sind fair", () => {
  assert.equal(UNITS.length, 540);
  for (const seed of [1, 2]) {
    const rng = seeded(seed);
    for (const unit of UNITS) {
      const kinds = kindsFor(unit);
      assert.ok(kinds.length > 0, unit.id);
      for (const kind of kinds) {
        const exercise = buildExercise({ content: CONTENT, unit, kind, rng });
        assert.equal(exercise.kind, kind);
        assertFairOptions(unit, exercise, unit.id + " " + kind);
        assert.deepEqual(JSON.parse(JSON.stringify(exercise)), exercise, unit.id + " " + kind);
      }
    }
  }
});

test("Echte Daten: Falsche Antworten stammen aus demselben Abschnitt oder derselben Datei", () => {
  const rng = seeded(3);
  const byEnglish = new Map(UNITS.map((unit) => [unit.type + ":" + unit.en, unit]));
  for (const unit of UNITS.filter((item) => item.type !== "patient")) {
    const kind = unit.type === "word" ? "wordPick" : "pickEnglish";
    const exercise = buildExercise({ content: CONTENT, unit, kind, rng });
    for (const option of exercise.options.filter((item) => !item.correct)) {
      const origin = byEnglish.get(unit.type + ":" + option.text);
      assert.ok(origin, option.text);
      assert.equal(origin.file, unit.file, unit.id + ": " + option.text);
      assert.notEqual(origin.id, unit.id);
      for (const form of [origin.en, ...origin.variants]) {
        assert.equal([unit.en, ...unit.variants].map(normalizeText).includes(normalizeText(form)), false, unit.id + ": " + form);
      }
    }
  }
});

test("Falsche Antworten kommen zuerst aus dem eigenen Abschnitt", () => {
  const rng = seeded(4);
  const section = CONTENT.sections().find((item) => item.id === "kl.numbers");
  const unit = CONTENT.unit(section.unitIds.find((id) => CONTENT.unit(id).type === "sentence"));
  const sameSection = section.unitIds.map((id) => CONTENT.unit(id).en);
  const exercise = buildExercise({ content: CONTENT, unit, kind: "pickEnglish", rng });
  const inSection = exercise.options.filter((option) => !option.correct && sameSection.includes(option.text));
  assert.ok(inSection.length >= 1);
});

test("Echte Daten: Eine falsche Antwort kann nie auch richtig sein", () => {
  // Paare, die im Lauf als falsche Antwort neben der richtigen standen und inhaltlich gleich sein können.
  const SIMILAR = [
    ["sb.wellbeing.s01", "sb.wellbeing.s06"],
    ["sb.wellbeing.s06", "sb.wellbeing.s07"],
    ["mr.safety.s11", "mr.safety.s12"],
    ["ct.contrast.s02", "ct.contrast.s04"],
    ["mr.w.implant", "mr.w.cochlear-implant"],
    ["kl.spell.s05", "kl.spell.s06"],
    ["kl.rescue.s01", "kl.rescue.s02"],
  ];
  for (const [first, second] of SIMILAR) {
    assert.equal(canAlsoBeRight(CONTENT.unit(first), CONTENT.unit(second)), true, first + " " + second);
    assert.equal(canAlsoBeRight(CONTENT.unit(second), CONTENT.unit(first)), true, second + " " + first);
  }
  const byEnglish = new Map(UNITS.map((unit) => [unit.type + ":" + unit.en, unit]));
  for (const seed of [11, 12, 13]) {
    const rng = seeded(seed);
    for (const unit of UNITS.filter((item) => item.type !== "patient")) {
      const kind = unit.type === "word" ? "wordPick" : "pickEnglish";
      const exercise = buildExercise({ content: CONTENT, unit, kind, rng });
      for (const option of exercise.options.filter((item) => !item.correct)) {
        assert.equal(matchTyped(unit, option.text).outcome, "wrong", unit.id + " nimmt " + option.text + " an");
        const origin = byEnglish.get(unit.type + ":" + option.text);
        assert.equal(matchTyped(origin, unit.en).outcome, "wrong", origin.id + " nimmt " + unit.en + " an");
        assert.equal(canAlsoBeRight(origin, unit), false, unit.id + ": " + option.text);
      }
    }
  }
});

test("Falsche Antworten bleiben auch mit der strengeren Auswahl möglichst im eigenen Abschnitt", () => {
  const rng = seeded(21);
  const own = UNITS.filter((unit) => unit.type === "sentence" && CONTENT.sections().find((section) => section.id === unit.sectionId).unitIds.length >= 12);
  let inSection = 0;
  let total = 0;
  for (const unit of own) {
    const exercise = buildExercise({ content: CONTENT, unit, kind: "pickEnglish", rng });
    for (const option of exercise.options.filter((item) => !item.correct)) {
      total += 1;
      inSection += UNITS.find((item) => item.en === option.text && item.type === "sentence").sectionId === unit.sectionId ? 1 : 0;
    }
  }
  assert.ok(inSection / total > 0.9, inSection + " von " + total);
});

test("Reaktionen behalten alle ihre Felder", () => {
  const rng = seeded(5);
  let clinic = 0;
  for (const unit of UNITS.filter((item) => item.type === "patient")) {
    const exercise = buildExercise({ content: CONTENT, unit, kind: "hearReact", rng });
    assert.equal(exercise.options.length, unit.reactions.length, unit.id);
    for (const reaction of unit.reactions) {
      const option = exercise.options.find((item) => item.text === reaction.en);
      assert.ok(option, unit.id);
      assert.equal(option.correct, reaction.fits === true, unit.id);
      assert.equal(option.meaningDe, reaction.meaningDe, unit.id);
      assert.deepEqual(option.source, reaction.source, unit.id);
      assert.equal(option.whyDe, reaction.whyDe, unit.id);
      assert.equal(option.clinicDependent, reaction.clinicDependent === true ? true : undefined, unit.id);
      clinic += option.clinicDependent ? 1 : 0;
    }
  }
  assert.ok(clinic > 0);
});

test("buildSentence: gemischte Wörter als text, richtige Folge in answer", () => {
  const unit = UNITS.find((item) => item.id === "sb.questions.s01");
  for (const rng of [seeded(6), () => 0, () => 0.999999, () => 0.5]) {
    const exercise = buildExercise({ content: CONTENT, unit, kind: "buildSentence", rng });
    assert.deepEqual(exercise.answer, surfaceWords(unit.en));
    assert.deepEqual(exercise.options.map((option) => option.text).sort(), [...exercise.answer].sort());
    assert.ok(exercise.options.every((option) => Object.keys(option).join() === "text"));
    assert.notDeepEqual(exercise.options.map((option) => option.text), exercise.answer);
  }
  for (const item of UNITS.filter((other) => other.type === "sentence")) {
    const exercise = buildExercise({ content: CONTENT, unit: item, kind: "buildSentence", rng: seeded(8) });
    assert.equal(matchTyped(item, exercise.answer.join(" ")).outcome, "correct", item.id);
    assert.notDeepEqual(exercise.options.map((option) => option.text), exercise.answer, item.id);
  }
});

test("present und typeSentence haben keine Auswahl", () => {
  const unit = UNITS.find((item) => item.type === "sentence");
  for (const kind of ["present", "typeSentence"]) {
    assert.deepEqual(buildExercise({ content: CONTENT, unit, kind, rng: seeded(1) }), { unitId: unit.id, kind, options: [] });
  }
});

test("Eine unpassende Art wirft", () => {
  const word = UNITS.find((item) => item.type === "word");
  assert.throws(() => buildExercise({ content: CONTENT, unit: word, kind: "pickEnglish", rng: seeded(1) }), RangeError);
});

// ----- Stufen -----

function kindOf(id, progress, seed = 7) {
  const plan = planTrain({ content: CONTENT, state: stateOf({ [id]: progress }), today: TODAY, rng: seeded(seed), focus: CONTENT.unit(id).sectionId ?? "mri" });
  return plan.find((exercise) => exercise.unitId === id).kind;
}

test("Stufe je Einheit: Sätze nach Box, Äußerungen immer hearReact, Wörter nach Box", () => {
  const sentence = "mr.safety.s01";
  const patient = "mr.safety.p01";
  const word = CONTENT.words("mri").at(-1).id;
  assert.equal(kindOf(sentence, dueProgress(0)), "pickEnglish");
  assert.equal(kindOf(sentence, dueProgress(2)), "buildSentence");
  for (const box of [3, 4, 5]) {
    assert.equal(kindOf(sentence, dueProgress(box)), "typeSentence", "Box " + box);
  }
  for (const box of [0, 1, 2, 3, 5]) {
    assert.equal(kindOf(patient, dueProgress(box)), "hearReact", "Box " + box);
  }
  assert.equal(kindOf(word, dueProgress(0)), "wordHear");
  assert.equal(kindOf(word, dueProgress(1)), "wordHear");
  assert.equal(kindOf(word, dueProgress(2)), "wordPick");
  assert.equal(kindOf(word, dueProgress(5)), "wordPick");
});

test("Box 1 wechselt über rng zwischen pickEnglish und hearMeaning", () => {
  const id = "mr.safety.s01";
  const state = stateOf({ [id]: dueProgress(1) });
  const low = planTrain({ content: CONTENT, state, today: TODAY, rng: () => 0.1, focus: "mr.safety" });
  const high = planTrain({ content: CONTENT, state, today: TODAY, rng: () => 0.9, focus: "mr.safety" });
  assert.equal(low.find((exercise) => exercise.unitId === id).kind, "pickEnglish");
  assert.equal(high.find((exercise) => exercise.unitId === id).kind, "hearMeaning");
});

test("Neue Sätze: erst present, gleich danach pickEnglish. Neue Äußerungen und Wörter ohne present", () => {
  const plan = train(stateOf());
  plan.forEach((exercise, index) => {
    const unit = CONTENT.unit(exercise.unitId);
    if (exercise.kind === "present") {
      assert.equal(unit.type, "sentence");
      assert.equal(plan[index + 1].kind, "pickEnglish");
      assert.equal(plan[index + 1].unitId, exercise.unitId);
    }
    if (exercise.kind === "pickEnglish") {
      assert.equal(plan[index - 1].kind, "present");
    }
    if (unit.type === "patient") {
      assert.equal(exercise.kind, "hearReact");
    }
    if (unit.type === "word") {
      assert.equal(exercise.kind, "wordHear");
    }
  });
});

// ----- Bestand -----

test("Leerer Stand: 15 neue Einheiten, core zuerst, im Verhältnis 3 : 2 : 1", () => {
  const plan = train(stateOf());
  const ids = [...new Set(plan.map((exercise) => exercise.unitId))];
  assert.equal(ids.length, 15);
  assert.ok(plan.length <= 30);
  assert.deepEqual(typeCounts(ids), { sentence: 7, patient: 5, word: 3 });
  for (const id of ids.filter((item) => CONTENT.unit(item).type === "sentence")) {
    assert.equal(CONTENT.unit(id).core, true, id);
  }
  const positions = ids.filter((item) => CONTENT.unit(item).type === "sentence").map((id) => UNITS.findIndex((unit) => unit.id === id));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.equal(CONTENT.unit(ids[0]).type, "sentence");
  assert.equal(new Set(ids.slice(0, 6).map((id) => CONTENT.unit(id).type)).size, 3, "Die Arten wechseln sich ab");
});

test("Viele fällige: höchstens 70 Prozent, schwächste zuerst, der Rest neu im Verhältnis 3 : 2 : 1", () => {
  const units = {};
  const dueUnits = UNITS.filter((unit) => unit.file === "gemeinsam");
  dueUnits.forEach((unit, index) => {
    units[unit.id] = dueProgress(index % 6);
  });
  const state = stateOf(units);
  const plan = train(state);
  assert.equal(plan.length, 30);
  const due = plan.filter((exercise) => units[exercise.unitId]);
  assert.equal(due.length, 21);
  assert.deepEqual(plan.slice(0, 21), due, "Fällige stehen vorn");
  const boxes = due.map((exercise) => units[exercise.unitId].box);
  assert.deepEqual(boxes, [...boxes].sort((a, b) => a - b));
  assert.equal(boxes[0], 0);
  const fresh = plan.slice(21).map((exercise) => exercise.unitId);
  assert.ok(fresh.every((id) => !units[id]));
  assert.deepEqual(typeCounts(fresh), { sentence: 3, patient: 2, word: 1 });
});

test("Viele fällige bei anderer Größe: 70 Prozent von size", () => {
  const units = Object.fromEntries(UNITS.filter((unit) => unit.file === "gemeinsam").map((unit) => [unit.id, dueProgress(1)]));
  for (const [size, limit] of [[10, 7], [20, 14], [15, 10], [1, 0]]) {
    const plan = train(stateOf(units), { size });
    assert.equal(plan.filter((exercise) => units[exercise.unitId]).length, limit, "size " + size);
    assert.ok(plan.length <= size, "size " + size);
  }
});

test("Alles fällig, nichts neu: bleibt bei 70 Prozent", () => {
  const units = Object.fromEntries(UNITS.map((unit) => [unit.id, dueProgress(1)]));
  assert.equal(train(stateOf(units)).length, 21);
});

test("Schwächste zuerst: erst die Box, dann schwaches Ergebnis, dann das älteste Datum", () => {
  const ids = UNITS.filter((unit) => unit.sectionId === "mr.safety").map((unit) => unit.id);
  const units = {
    [ids[0]]: dueProgress(2),
    [ids[1]]: dueProgress(0, { due: "2026-11-05" }),
    [ids[2]]: dueProgress(0, { lastResult: "wrong" }),
    [ids[3]]: dueProgress(0, { due: "2026-11-01" }),
    [ids[4]]: dueProgress(1),
  };
  const plan = train(stateOf(units), { focus: "mr.safety" });
  assert.deepEqual(plan.slice(0, 5).map((exercise) => exercise.unitId), [ids[2], ids[3], ids[1], ids[4], ids[0]]);
});

test("Keine fälligen, aber Bekanntes: mehr neue, höchstens 15. Noch nicht fällig bleibt draußen", () => {
  const units = Object.fromEntries(UNITS.filter((unit) => unit.file === "gemeinsam").map((unit) => [unit.id, laterProgress()]));
  const plan = train(stateOf(units));
  const ids = [...new Set(plan.map((exercise) => exercise.unitId))];
  assert.equal(ids.length, 15);
  assert.ok(ids.every((id) => !units[id]));
});

test("Wenige fällige: Die neuen füllen auf, höchstens 15", () => {
  const dueIds = UNITS.slice(0, 4).map((unit) => unit.id);
  const units = Object.fromEntries(dueIds.map((id) => [id, dueProgress(1)]));
  const plan = train(stateOf(units));
  const fresh = [...new Set(plan.map((exercise) => exercise.unitId))].filter((id) => !units[id]);
  assert.equal(fresh.length, 15);
  assert.ok(plan.length <= 30);
  assert.deepEqual(plan.slice(0, 4).map((exercise) => exercise.unitId).sort(), [...dueIds].sort());
});

test("Fällige mit knappem Platz: 20 fällige lassen 10 Plätze", () => {
  const dueIds = UNITS.filter((unit) => unit.file === "gemeinsam").slice(0, 20).map((unit) => unit.id);
  const units = Object.fromEntries(dueIds.map((id) => [id, dueProgress(1)]));
  const plan = train(stateOf(units));
  assert.ok(plan.length <= 30 && plan.length >= 29);
  assert.equal(plan.filter((exercise) => units[exercise.unitId]).length, 20);
});

test("Alles bekannt und nichts fällig: leerer Plan", () => {
  const units = Object.fromEntries(UNITS.map((unit) => [unit.id, laterProgress()]));
  assert.deepEqual(train(stateOf(units)), []);
});

// ----- Lernplan -----

test("Reihenfolge nach state.placement.plan.order", () => {
  const sections = CONTENT.sections();
  const order = [...sections].reverse().map((section) => section.id);
  const plan = train(stateOf({}, order));
  const sentenceIds = [...new Set(plan.map((exercise) => exercise.unitId))].filter((id) => CONTENT.unit(id).type === "sentence");
  const ranks = sentenceIds.map((id) => order.indexOf(CONTENT.unit(id).sectionId));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  const firstWithCore = order.find((id) => sections.find((section) => section.id === id).unitIds.some((unitId) => CONTENT.unit(unitId).core));
  assert.equal(CONTENT.unit(sentenceIds[0]).sectionId, firstWithCore);
  assert.ok(sentenceIds.every((id) => CONTENT.unit(id).core));
});

test("Der Lernplan zieht Äußerungen und Wörter aus den Abschnitten, die gerade dran sind", () => {
  const order = ["mr.safety", "mr.anxiety", ...CONTENT.sections().map((section) => section.id).filter((id) => !["mr.safety", "mr.anxiety"].includes(id))];
  const plan = train(stateOf({}, order));
  const ids = [...new Set(plan.map((exercise) => exercise.unitId))];
  const sentences = ids.filter((id) => CONTENT.unit(id).type === "sentence");
  const coreInPlan = UNITS.filter((unit) => unit.core && ["mr.safety", "mr.anxiety"].includes(unit.sectionId)).length;
  assert.ok(coreInPlan >= 2);
  const firstSentences = sentences.slice(0, coreInPlan);
  assert.ok(firstSentences.every((id) => ["mr.safety", "mr.anxiety"].includes(CONTENT.unit(id).sectionId)), sentences.join());
  const activeSections = new Set(sentences.map((id) => CONTENT.unit(id).sectionId));
  const patients = ids.filter((id) => CONTENT.unit(id).type === "patient");
  const activePatients = UNITS.filter((unit) => unit.type === "patient" && activeSections.has(unit.sectionId)).length;
  const fromActive = patients.filter((id) => activeSections.has(CONTENT.unit(id).sectionId)).length;
  assert.equal(fromActive, Math.min(activePatients, patients.length));
  assert.ok(patients.length > 0);
  for (const id of ids.filter((item) => CONTENT.unit(item).type === "word")) {
    assert.equal(CONTENT.unit(id).file, "mrt", id);
  }
});

test("Ein Lernplan, der nicht alle Abschnitte nennt, und einer mit unbekannter ID", () => {
  const plan = train(stateOf({}, ["gibt.es.nicht", "mr.safety"]));
  const first = plan.find((exercise) => CONTENT.unit(exercise.unitId).type === "sentence");
  assert.equal(CONTENT.unit(first.unitId).sectionId, "mr.safety");
  assert.ok(plan.length > 0);
  const broken = stateOf();
  broken.placement.plan = { order: "kaputt" };
  assert.ok(train(broken).length > 0);
});

// ----- Fokus -----

test("Jeder Fokus aus content.sections()", () => {
  for (const section of CONTENT.sections()) {
    const plan = train(stateOf(), { focus: section.id });
    assert.ok(plan.length > 0, section.id);
    const ids = new Set(plan.map((exercise) => exercise.unitId));
    assert.ok(ids.size <= 15, section.id);
    assert.ok([...ids].every((id) => section.unitIds.includes(id)), section.id);
    assert.ok(plan.length <= 30, section.id);
    for (const exercise of plan) {
      assertFairOptions(CONTENT.unit(exercise.unitId), exercise, section.id);
    }
    const spokenPlan = speech(stateOf(), { focus: section.id });
    assert.ok(spokenPlan.length > 0, section.id);
    assert.ok(spokenPlan.every((item) => section.unitIds.includes(item.unitId)), section.id);
  }
});

test("Fokus mit vielen fälligen Einheiten bleibt im Abschnitt und bei 70 Prozent von size", () => {
  const section = CONTENT.sections().find((item) => item.id === "kl.patientquestions");
  const units = Object.fromEntries(section.unitIds.map((id) => [id, dueProgress(0)]));
  const plan = train(stateOf(units), { focus: section.id, size: 10 });
  assert.equal(plan.length, 7);
  assert.ok(plan.every((exercise) => section.unitIds.includes(exercise.unitId)));
});

test("Jede Untersuchung: nur ihre Einheiten und Wörter", () => {
  for (const exam of EXAMS) {
    const plan = train(stateOf(), { focus: exam });
    assert.ok(plan.length > 0, exam);
    const ids = new Set(plan.map((exercise) => exercise.unitId));
    assert.ok([...ids].every((id) => CONTENT.unit(id).exams.includes(exam)), exam);
    assert.ok([...ids].some((id) => CONTENT.unit(id).type === "word"), exam);
    assert.deepEqual(typeCounts([...ids]), { sentence: 7, patient: 5, word: 3 }, exam);
    assert.ok(speech(stateOf(), { focus: exam }).every((item) => CONTENT.unit(item.unitId).exams.includes(exam)), exam);
  }
  const fromScope = focusUnits(CONTENT, "xray");
  assert.ok(fromScope.some((unit) => unit.file === "roentgen"));
  assert.ok(fromScope.some((unit) => unit.file === "gemeinsam"));
  assert.ok(!fromScope.some((unit) => unit.file === "mrt"));
});

test("Jedes Szenario jeder Untersuchung", () => {
  let scenarios = 0;
  for (const exam of EXAMS) {
    for (const scenario of CONTENT.examSections(exam)) {
      scenarios += 1;
      const focus = exam + ":" + scenario.key;
      const plan = train(stateOf(), { focus });
      assert.ok(plan.length > 0, focus);
      assert.ok(plan.every((exercise) => scenario.unitIds.includes(exercise.unitId)), focus);
      assert.deepEqual(focusUnits(CONTENT, focus).map((unit) => unit.id), scenario.unitIds, focus);
      const spokenPlan = speech(stateOf(), { focus });
      assert.ok(spokenPlan.length > 0, focus);
      assert.ok(spokenPlan.every((item) => scenario.unitIds.includes(item.unitId)), focus);
    }
  }
  assert.ok(scenarios >= 20);
});

test("Ein unbekannter Fokus liefert eine leere Liste", () => {
  for (const focus of ["gibt.es.nicht", "mri:gibt-es-nicht", "abc:safety", "", ":", "mri:"]) {
    assert.deepEqual(train(stateOf(), { focus }), [], focus);
    assert.deepEqual(speech(stateOf(), { focus }), [], focus);
  }
});

// ----- Keine Nebenwirkung, gleicher Zufall -----

function mixedState() {
  const units = { "unbekannte.id": { box: 9, zusatz: true } };
  UNITS.forEach((unit, index) => {
    if (index % 3 === 0) {
      units[unit.id] = dueProgress(index % 6, { spokenA: index % 2 === 0 });
    } else if (index % 7 === 0) {
      units[unit.id] = laterProgress();
    }
  });
  const state = stateOf(units, CONTENT.sections().map((section) => section.id));
  state.zusatz = { bleibt: true };
  return state;
}

test("planTrain und planSpeech ändern den Stand nicht und liefern mit gleichem rng dasselbe", () => {
  for (const make of [() => stateOf(), mixedState]) {
    const state = make();
    const before = structuredClone(state);
    assert.deepEqual(train(state), train(state));
    assert.deepEqual(speech(state), speech(state));
    assert.deepEqual(state, before);
  }
  const state = mixedState();
  assert.notDeepEqual(
    planTrain({ content: CONTENT, state, today: TODAY, rng: seeded(1) }),
    planTrain({ content: CONTENT, state, today: TODAY, rng: seeded(2) }),
  );
});

test("Jede Übung und jeder Schnappschuss lässt sich mit JSON hin und zurück wandeln", () => {
  for (const state of [stateOf(), mixedState()]) {
    const trainPlan = train(state);
    assert.deepEqual(JSON.parse(JSON.stringify(trainPlan)), trainPlan);
    const spokenPlan = speech(state, { size: 540 });
    assert.ok(spokenPlan.length > 0);
    assert.deepEqual(JSON.parse(JSON.stringify(spokenPlan)), spokenPlan);
  }
});

// ----- Sprechen -----

const SNAPSHOT_FIELDS = ["clinicDependent", "en", "keywords", "meaningDe", "noteDe", "prompt", "situationDe", "softKeywords", "source", "variants"];

test("planSpeech: leerer Stand, 12 neue Einheiten ohne Wörter, core zuerst", () => {
  const plan = speech(stateOf());
  assert.equal(plan.length, 12);
  assert.ok(plan.every((item) => CONTENT.unit(item.unitId).type !== "word"));
  const sentences = plan.filter((item) => CONTENT.unit(item.unitId).type === "sentence");
  const patients = plan.filter((item) => CONTENT.unit(item.unitId).type === "patient");
  assert.deepEqual([sentences.length, patients.length], [7, 5]);
  assert.ok(sentences.every((item) => CONTENT.unit(item.unitId).core && item.stage === "a"));
  assert.ok(patients.every((item) => item.stage === "b"));
});

test("planSpeech: Stufe a ohne spokenA, sonst b, Äußerung immer b", () => {
  const units = {
    "mr.safety.s01": dueProgress(1),
    "mr.safety.s02": dueProgress(1, { spokenA: true }),
    "mr.safety.p01": dueProgress(1),
  };
  const plan = speech(stateOf(units), { focus: "mr.safety" });
  const stage = (id) => plan.find((item) => item.unitId === id).stage;
  assert.equal(stage("mr.safety.s01"), "a");
  assert.equal(stage("mr.safety.s02"), "b");
  assert.equal(stage("mr.safety.p01"), "b");
});

test("planSpeech: Fällige zuerst, dann Begonnenes ohne spokenB, dann neue. Fertig Gesprochenes wartet auf seinen Tag", () => {
  const ids = UNITS.filter((unit) => unit.sectionId === "mr.safety").map((unit) => unit.id);
  const units = {
    [ids[0]]: laterProgress(),
    [ids[1]]: dueProgress(3, { spokenA: true, spokenB: true }),
    [ids[2]]: { ...laterProgress(), spokenA: true, spokenB: true },
    [ids[3]]: dueProgress(0),
    [ids[4]]: { ...laterProgress(), spokenA: true },
  };
  const plan = speech(stateOf(units), { focus: "mr.safety", size: 40 });
  const order = plan.map((item) => item.unitId);
  assert.deepEqual(order.slice(0, 2), [ids[3], ids[1]]);
  assert.deepEqual(order.slice(2, 4).sort(), [ids[0], ids[4]].sort());
  assert.equal(order.includes(ids[2]), false);
  assert.equal(order.length, ids.length - 1);
});

test("planSpeech: Was heute schwach gewertet wurde, kommt nicht schon in der nächsten Runde", () => {
  const ids = UNITS.filter((unit) => unit.sectionId === "mr.safety" && unit.type === "sentence").map((unit) => unit.id);
  const graded = (result) => applyResult(newUnit(), result, TODAY, NOW);
  const units = {
    [ids[0]]: graded("notUnderstood"),
    [ids[1]]: graded("hint"),
    [ids[2]]: { ...graded("ok"), spokenA: true },
    // Gestern schwach gewertet und noch nicht fällig: Das darf wiederkommen.
    [ids[3]]: { ...graded("hint"), lastAt: "2026-11-05T12:00:00.000Z", due: "2026-11-08" },
  };
  const order = speech(stateOf(units), { focus: "mr.safety", size: 40 }).map((item) => item.unitId);
  assert.equal(order.includes(ids[0]), false);
  assert.equal(order.includes(ids[1]), false);
  assert.ok(order.includes(ids[3]));
  const next = speech(stateOf(units), { focus: "mr.safety", size: 40 }).find((item) => item.unitId === ids[2]);
  assert.equal(next.stage, "b", "Stufe a mit ok darf am selben Tag zu Stufe b weitergehen");
  const tomorrow = planSpeech({ content: CONTENT, state: stateOf(units), today: addDays(TODAY, 1), focus: "mr.safety", size: 40 }).map((item) => item.unitId);
  assert.ok(tomorrow.includes(ids[0]) && tomorrow.includes(ids[1]), "Morgen sind sie fällig");
});

test("planSpeech: Eine Patientenäußerung trägt die Quelle der Äußerung, ein Satz nicht", () => {
  const plan = speech(stateOf(), { focus: "mr.safety", size: 40 });
  for (const item of plan) {
    const unit = CONTENT.unit(item.unitId);
    if (unit.type === "patient") {
      assert.deepEqual(item.promptSource, CONTENT.source(unit.source), unit.id);
      assert.ok(item.promptSource.title, unit.id);
    } else {
      assert.equal("promptSource" in item, false, unit.id);
    }
  }
});

test("planSpeech: size begrenzt, auch bei vielen Fälligen", () => {
  const units = Object.fromEntries(UNITS.filter((unit) => unit.file === "mrt" && unit.type !== "word").map((unit) => [unit.id, dueProgress(2)]));
  const plan = speech(stateOf(units));
  assert.equal(plan.length, 12);
  assert.ok(plan.every((item) => units[item.unitId]));
  assert.equal(speech(stateOf(), { size: 3 }).length, 3);
});

test("Schnappschuss eines Satzes trägt alle Felder und die aufgelöste Quelle", () => {
  for (const unit of UNITS.filter((item) => item.type === "sentence")) {
    const [item] = speech(stateOf({ [unit.id]: dueProgress(1) }), { focus: unit.sectionId, size: 1 });
    assert.equal(item.unitId, unit.id);
    const { snapshot } = item;
    assert.deepEqual(Object.keys(snapshot).sort(), SNAPSHOT_FIELDS);
    assert.equal(snapshot.en, unit.en);
    assert.deepEqual(snapshot.variants, unit.variants);
    assert.deepEqual(snapshot.keywords, unit.keywords);
    assert.equal(snapshot.softKeywords, false);
    assert.equal(snapshot.situationDe, unit.situationDe);
    assert.equal(snapshot.meaningDe, unit.meaningDe);
    assert.equal(snapshot.noteDe, unit.noteDe);
    assert.equal(snapshot.clinicDependent, unit.clinicDependent);
    assert.equal(snapshot.prompt, null);
    assert.deepEqual(snapshot.source, CONTENT.source(unit.source));
    assert.ok(snapshot.source.title && snapshot.source.publisher && snapshot.source.url && snapshot.source.retrieved);
    assert.equal(matchSpoken(snapshot, unit.en, { stage: item.stage }).outcome, "understood");
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
  }
});

test("Schnappschuss einer Äußerung: Text zum Anhören, Antwort aus der passenden Reaktion", () => {
  const patient = UNITS.filter((item) => item.type === "patient");
  for (const unit of patient) {
    const [item] = speech(stateOf({ [unit.id]: dueProgress(1) }), { focus: unit.sectionId, size: 1 });
    assert.equal(item.unitId, unit.id);
    assert.equal(item.stage, "b");
    const reaction = unit.reactions.find((entry) => entry.fits === true);
    const { snapshot } = item;
    assert.deepEqual(Object.keys(snapshot).sort(), SNAPSHOT_FIELDS);
    assert.equal(snapshot.prompt, unit.en);
    assert.equal(snapshot.en, reaction.en);
    assert.equal(snapshot.meaningDe, reaction.meaningDe);
    assert.deepEqual(snapshot.variants, []);
    assert.deepEqual(snapshot.keywords, deriveKeywords(reaction.en));
    assert.equal(snapshot.softKeywords, true);
    assert.equal(snapshot.noteDe, unit.noteDe);
    assert.equal(snapshot.clinicDependent, unit.clinicDependent || reaction.clinicDependent === true);
    assert.deepEqual(snapshot.source, CONTENT.source(reaction.source));
    assert.ok(snapshot.source.title && snapshot.source.publisher && snapshot.source.url);
    assert.equal(matchSpoken(snapshot, reaction.en, { stage: "b" }).outcome, "understood");
    assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
  }
});

test("Zusammenspiel über simulierte Tage: Alles kommt dran, der Stand bleibt gültig, die Grenzen halten", () => {
  const state = stateOf();
  const rng = seeded(11);
  let day = TODAY;
  let exercises = 0;
  for (let round = 0; round < 120; round += 1) {
    const plan = planTrain({ content: CONTENT, state, today: day, rng });
    assert.ok(plan.length <= 30, day);
    const fresh = new Set(plan.map((exercise) => exercise.unitId).filter((id) => unitState(state, id).due === null));
    assert.ok(fresh.size <= 15, day);
    assert.ok(plan.length - plan.filter((exercise) => fresh.has(exercise.unitId)).length <= 21, day);
    for (const exercise of plan) {
      if (exercise.kind !== "present") {
        const result = rng() < 0.85 ? "ok" : "wrong";
        setUnitState(state, exercise.unitId, applyResult(unitState(state, exercise.unitId), result, day, NOW));
        recordExercise(state, day);
        exercises += 1;
      }
    }
    day = addDays(day, 1);
  }
  assert.equal(stateProblem(state), null);
  assert.equal(Object.keys(state.units).length, 540);
  assert.equal(Object.values(state.stats.days).reduce((sum, item) => sum + item.exercises, 0), exercises);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test("Vorgaben: size 30 und 12, focus null", () => {
  assert.ok(planTrain({ content: CONTENT, state: mixedState(), today: TODAY, rng: seeded(1) }).length <= 30);
  assert.equal(planSpeech({ content: CONTENT, state: mixedState(), today: TODAY, rng: seeded(1) }).length, 12);
  assert.equal(focusUnits(CONTENT).length, 540);
});
