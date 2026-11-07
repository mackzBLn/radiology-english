import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadContent } from "../js/core/content.js";
import { LEVELS, WEIGHTS, buildPlan, chooseForm, compareAttempts, scorePlacement } from "../js/core/placement.js";

const CONTENT = await loadContent((name) => JSON.parse(readFileSync(new URL("../daten/" + name + ".json", import.meta.url), "utf8")));
const ALL_SECTIONS = CONTENT.sections();

// Erfundene Fassung: je Teil und Stufe count Aufgaben. Die echte Datei daten/einstufung.json gibt es noch nicht.
function makeForm(id = "A", counts = { speaking: 2, listening: 2, writing: 1 }) {
  const items = [];
  for (const [part, count] of Object.entries(counts)) {
    for (const level of LEVELS) {
      for (let index = 1; index <= count; index += 1) {
        items.push({
          id: "pl." + id.toLowerCase() + "." + part + "." + level + "." + index,
          part,
          type: part === "listening" ? "hearChoose" : part === "writing" ? "type" : "repeat",
          level,
          descriptor: { scale: "Beispielskala", level, page: 1, summaryDe: "Beispiel " + part + " " + level },
          situationDe: "Eine erfundene Lage.",
          en: "Please wait here.",
          variants: [],
          keywords: ["wait"],
          meaningDe: "Bitte warten Sie hier.",
          options: [],
          source: { ref: "beispiel", locator: "Teil 1" },
        });
      }
    }
  }
  return { id, items };
}

// Antworten als Muster: je Teil und Stufe, wie viele richtig, wie viele falsch. Der Rest notMeasured.
function answersFor(form, pattern) {
  const answers = {};
  for (const [part, levels] of Object.entries(pattern)) {
    for (const [level, [correct, wrong]] of Object.entries(levels)) {
      const items = form.items.filter((item) => item.part === part && item.level === level);
      items.forEach((item, index) => {
        answers[item.id] = index < correct ? "correct" : index < correct + wrong ? "wrong" : "notMeasured";
      });
    }
  }
  return answers;
}

function allAnswers(form, value) {
  return Object.fromEntries(form.items.map((item) => [item.id, value]));
}

function partResult(part, pattern, count = 10) {
  const form = makeForm("A", { [part]: count });
  return scorePlacement(form, answersFor(form, { [part]: pattern })).parts[part];
}

function resultWith(levels) {
  const parts = {};
  for (const part of Object.keys(WEIGHTS)) {
    const level = levels[part] ?? null;
    parts[part] = { measured: level !== null, level, belowA1: false };
  }
  return { form: "A", parts, overall: levels.overall ?? null, strengths: [], gaps: [] };
}

test("LEVELS und WEIGHTS", () => {
  assert.deepEqual(LEVELS, ["A1", "A2", "B1", "B2"]);
  assert.deepEqual(WEIGHTS, { speaking: 0.5, listening: 0.3, writing: 0.2 });
});

// ----- Grenzen -----

test("Grenze 60 Prozent: 6 von 10 reichen, 5 von 10 nicht", () => {
  assert.equal(partResult("speaking", { A1: [6, 4] }).level, "A1");
  assert.equal(partResult("speaking", { A1: [6, 4] }).belowA1, false);
  assert.equal(partResult("speaking", { A1: [5, 5] }).belowA1, true);
  assert.equal(partResult("speaking", { A1: [10, 0], A2: [6, 4] }).level, "A2");
  assert.equal(partResult("speaking", { A1: [10, 0], A2: [5, 5] }).level, "A1");
});

test("Grenze 50 Prozent: Jede niedrigere Stufe braucht die Hälfte", () => {
  assert.equal(partResult("listening", { A1: [5, 5], A2: [6, 4] }).level, "A2");
  assert.equal(partResult("listening", { A1: [4, 6], A2: [10, 0] }).belowA1, true);
  assert.equal(partResult("listening", { A1: [10, 0], A2: [4, 6], B1: [10, 0], B2: [10, 0] }).level, "A1");
  assert.equal(partResult("listening", { A1: [10, 0], A2: [5, 5], B1: [10, 0], B2: [5, 5] }).level, "B1");
  assert.equal(partResult("listening", { A1: [5, 5], A2: [5, 5], B1: [5, 5], B2: [6, 4] }).level, "B2");
});

test("Alle Stufen geschafft und keine", () => {
  const form = makeForm();
  const best = scorePlacement(form, allAnswers(form, "correct"));
  for (const part of Object.keys(WEIGHTS)) {
    assert.equal(best.parts[part].level, "B2", part);
    assert.equal(best.parts[part].measured, true, part);
    assert.equal(best.parts[part].belowA1, false, part);
  }
  assert.equal(best.overall, "B2");
  const none = scorePlacement(form, allAnswers(form, "wrong"));
  for (const part of Object.keys(WEIGHTS)) {
    assert.equal(none.parts[part].level, "A1", part);
    assert.equal(none.parts[part].belowA1, true, part);
    assert.equal(none.parts[part].measured, true, part);
  }
  assert.equal(none.overall, "A1");
});

test("belowA1: Stufe A1 mit Vermerk", () => {
  const result = partResult("writing", { A1: [0, 10], A2: [10, 0], B1: [10, 0], B2: [10, 0] });
  assert.equal(result.level, "A1");
  assert.equal(result.belowA1, true);
  assert.equal(result.measured, true);
});

test("Die Zähler je Stufe stehen im Ergebnis", () => {
  const form = makeForm();
  const answers = answersFor(form, { speaking: { A1: [1, 1], A2: [1, 0] } });
  const { levels } = scorePlacement(form, answers).parts.speaking;
  assert.deepEqual(levels.A1, { correct: 1, wrong: 1, notMeasured: 0 });
  assert.deepEqual(levels.A2, { correct: 1, wrong: 0, notMeasured: 1 });
  assert.deepEqual(levels.B1, { correct: 0, wrong: 0, notMeasured: 2 });
});

// ----- notMeasured -----

test("notMeasured zählt nie als falsch", () => {
  const form = makeForm();
  const allOpenExceptOne = allAnswers(form, "notMeasured");
  const item = form.items.find((entry) => entry.part === "listening" && entry.level === "A1");
  allOpenExceptOne[item.id] = "correct";
  const result = scorePlacement(form, allOpenExceptOne);
  assert.equal(result.parts.listening.level, "A1");
  assert.equal(result.parts.listening.belowA1, false);

  const a1 = form.items.filter((entry) => entry.part === "speaking" && entry.level === "A1");
  const answers = { [a1[0].id]: "correct", [a1[1].id]: "notMeasured" };
  assert.equal(scorePlacement(form, answers).parts.speaking.belowA1, false);
  const b1 = form.items.filter((entry) => entry.part === "speaking" && entry.level === "B1");
  const higher = { [a1[0].id]: "correct", [a1[1].id]: "correct", [b1[0].id]: "correct" };
  assert.equal(scorePlacement(form, higher).parts.speaking.level, "B1");
});

test("Eine ganz ungemessene Stufe bricht die Kette nicht", () => {
  assert.equal(partResult("speaking", { A1: [10, 0], A2: [0, 0], B1: [6, 4] }).level, "B1");
  assert.equal(partResult("speaking", { A1: [0, 0], A2: [6, 4] }).level, "A2");
  assert.equal(partResult("speaking", { A1: [0, 0], A2: [4, 6] }).belowA1, true);
});

test("Fehlende Antwort heißt notMeasured", () => {
  const form = makeForm();
  const result = scorePlacement(form, {});
  for (const part of Object.keys(WEIGHTS)) {
    assert.equal(result.parts[part].measured, false, part);
    assert.equal(result.parts[part].level, null, part);
    assert.equal(result.parts[part].belowA1, false, part);
  }
  assert.equal(result.overall, null);
  assert.deepEqual(result.strengths, []);
  assert.equal(result.gaps.length, 3);
});

test("Fall ohne Spracherkennung: Der ganze Sprechteil ist notMeasured, Gesamt nur aus Hören und Schreiben", () => {
  const form = makeForm();
  const answers = allAnswers(form, "correct");
  for (const item of form.items.filter((entry) => entry.part === "speaking")) {
    answers[item.id] = "notMeasured";
  }
  const result = scorePlacement(form, answers);
  assert.equal(result.parts.speaking.measured, false);
  assert.equal(result.parts.speaking.level, null);
  assert.equal(result.parts.speaking.belowA1, false);
  assert.deepEqual(result.parts.speaking.levels.A1, { correct: 0, wrong: 0, notMeasured: 2 });
  assert.equal(result.parts.listening.level, "B2");
  assert.equal(result.parts.writing.level, "B2");
  assert.equal(result.overall, "B2", "Ein ungemessener Teil zieht das Gesamtergebnis nicht nach unten");
  assert.ok(result.gaps.some((text) => text.includes("Sprechen") && text.includes("nicht gemessen")));
  assert.ok(!result.strengths.some((text) => text.includes("Sprechen")));
  assert.deepEqual(buildPlan(result, CONTENT).order.length, ALL_SECTIONS.length);
});

test("Ein Teil ohne Messung bei den anderen Teilen", () => {
  const form = makeForm();
  const onlyWriting = scorePlacement(form, answersFor(form, { writing: { A1: [1, 0], A2: [1, 0], B1: [0, 1] } }));
  assert.equal(onlyWriting.parts.listening.measured, false);
  assert.equal(onlyWriting.parts.speaking.measured, false);
  assert.equal(onlyWriting.parts.writing.level, "A2");
  assert.equal(onlyWriting.overall, "A2");
});

// ----- Gewichte und Runden -----

function overallOf(levels) {
  const form = makeForm("A", { speaking: 1, listening: 1, writing: 1 });
  const answers = {};
  for (const item of form.items) {
    const reached = levels[item.part];
    if (reached !== undefined) {
      answers[item.id] = LEVELS.indexOf(item.level) <= LEVELS.indexOf(reached) ? "correct" : "wrong";
    }
  }
  return scorePlacement(form, answers).overall;
}

test("Gewichte: Sprechen 0,5, Hören 0,3, Schreiben 0,2, gerundet, halbe Stufe nach oben", () => {
  for (const [speaking, listening, writing, overall] of [
    ["B2", "A1", "A1", "B1"], // 1,5
    ["A1", "B2", "A1", "A2"], // 0,9
    ["A1", "A1", "B2", "A2"], // 0,6
    ["A1", "B2", "B2", "B1"], // 1,5
    ["A2", "A1", "A1", "A2"], // 0,5
    ["A1", "A2", "A2", "A2"], // 0,5
    ["A1", "A2", "A1", "A1"], // 0,3
    ["A1", "A1", "A2", "A1"], // 0,2
    ["B1", "A2", "A2", "B1"], // 1,5
    ["A2", "B1", "B1", "B1"], // 1,5
    ["B2", "B1", "A1", "B1"], // 2,1
    ["B2", "B1", "B1", "B2"], // 2,5
    ["B1", "B2", "B2", "B2"], // 2,5
    ["B1", "B1", "B1", "B1"], // 2,0
  ]) {
    assert.equal(overallOf({ speaking, listening, writing }), overall, [speaking, listening, writing].join(" "));
  }
});

test("Gewichte über die gemessenen Teile: Der fehlende Teil zählt nicht mit", () => {
  assert.equal(overallOf({ listening: "B2", writing: "A1" }), "B1"); // 9 / 5 = 1,8
  assert.equal(overallOf({ listening: "A2", writing: "B1" }), "A2"); // 7 / 5 = 1,4
  assert.equal(overallOf({ listening: "A1", writing: "B2" }), "A2"); // 6 / 5 = 1,2
  assert.equal(overallOf({ speaking: "A2", listening: "B1" }), "A2"); // 11 / 8 = 1,375
  assert.equal(overallOf({ speaking: "A1", listening: "B1" }), "A2"); // 6 / 8 = 0,75
  assert.equal(overallOf({ speaking: "B1", writing: "A1" }), "A2"); // 10 / 7 = 1,43
  assert.equal(overallOf({ listening: "B1" }), "B1");
  assert.equal(overallOf({ writing: "A2" }), "A2");
  assert.equal(overallOf({ speaking: "B2" }), "B2");
});

test("belowA1 zählt im Mittel wie A1", () => {
  const form = makeForm();
  const answers = allAnswers(form, "correct");
  for (const item of form.items.filter((entry) => entry.part === "speaking")) {
    answers[item.id] = "wrong";
  }
  const result = scorePlacement(form, answers);
  assert.equal(result.parts.speaking.belowA1, true);
  assert.equal(result.overall, "B1"); // (0 + 9 + 6) / 10 = 1,5
});

// ----- Fassung und Texte -----

test("chooseForm: A beim ersten Mal, danach immer abwechselnd", () => {
  assert.equal(chooseForm([]), "A");
  assert.equal(chooseForm(undefined), "A");
  assert.equal(chooseForm([{ form: "A" }]), "B");
  assert.equal(chooseForm([{ form: "A" }, { form: "B" }]), "A");
  assert.equal(chooseForm([{ form: "A" }, { form: "B" }, { form: "A" }]), "B");
  assert.equal(chooseForm([{ form: "B" }]), "A");
});

test("Das Ergebnis nennt die Fassung, passt zum Aufbau eines Versuchs und übersteht JSON", () => {
  const form = makeForm("B");
  const result = scorePlacement(form, allAnswers(form, "correct"));
  assert.equal(result.form, "B");
  assert.deepEqual(Object.keys(result).sort(), ["form", "gaps", "overall", "parts", "strengths"]);
  const attempt = { ...result, at: "2026-11-07T08:00:00.000Z" };
  assert.deepEqual(JSON.parse(JSON.stringify(attempt)), attempt);
});

test("strengths und gaps sind deutsche Sätze je Teil", () => {
  const form = makeForm();
  const answers = answersFor(form, {
    speaking: { A1: [2, 0], A2: [1, 1], B1: [0, 2], B2: [0, 2] },
    listening: { A1: [2, 0], A2: [2, 0], B1: [2, 0], B2: [2, 0] },
    writing: { A1: [0, 1], A2: [1, 0], B1: [1, 0], B2: [1, 0] },
  });
  const result = scorePlacement(form, answers);
  assert.deepEqual(result.strengths, [
    "Sprechen: Du schaffst Stufe A1 (Beispiel speaking A1).",
    "Hören: Du schaffst Stufe B2 (Beispiel listening B2).",
  ]);
  assert.deepEqual(result.gaps, [
    "Sprechen: Stufe A2 sitzt noch nicht (Beispiel speaking A2).",
    "Schreiben: Stufe A1 sitzt noch nicht (Beispiel writing A1).",
  ]);
});

test("gaps meldet einzelne ungemessene Aufgaben ohne sie als Fehler zu werten", () => {
  const form = makeForm();
  const answers = allAnswers(form, "correct");
  const [first, second] = form.items.filter((item) => item.part === "speaking" && item.level === "B2");
  answers[first.id] = "notMeasured";
  assert.ok(scorePlacement(form, answers).gaps.includes("Sprechen: 1 Aufgabe wurde nicht gemessen. Das zählt nicht als Fehler."));
  answers[second.id] = "notMeasured";
  const result = scorePlacement(form, answers);
  assert.ok(result.gaps.includes("Sprechen: 2 Aufgaben wurden nicht gemessen. Das zählt nicht als Fehler."));
  assert.equal(result.parts.speaking.level, "B1");
});

test("Texte ohne Beschreibung im Format bleiben ganze Sätze", () => {
  const form = makeForm();
  form.items.forEach((item) => {
    delete item.descriptor;
  });
  const result = scorePlacement(form, allAnswers(form, "correct"));
  assert.deepEqual(result.strengths, ["Sprechen: Du schaffst Stufe B2.", "Hören: Du schaffst Stufe B2.", "Schreiben: Du schaffst Stufe B2."]);
  assert.deepEqual(result.gaps, []);
});

// ----- Lernplan -----

function filesOf(order) {
  const blocks = [];
  for (const id of order) {
    const { file } = ALL_SECTIONS.find((section) => section.id === id);
    if (blocks[blocks.length - 1] !== file) {
      blocks.push(file);
    }
  }
  return blocks;
}

const BASIC_BLOCKS = ["satzbau", "klaeren", "gemeinsam", "mrt", "ct", "roentgen"];

test("buildPlan: Jede Abschnitts-ID genau einmal, für alle Stufen und jeden Satzbau", () => {
  const ids = ALL_SECTIONS.map((section) => section.id).sort();
  assert.ok(ids.length > 40);
  for (const overall of [null, ...LEVELS]) {
    for (const writing of [null, ...LEVELS]) {
      const plan = buildPlan(resultWith({ overall, writing }), CONTENT);
      assert.deepEqual([...plan.order].sort(), ids, overall + " " + writing);
      assert.equal(typeof plan.noteDe, "string");
      assert.ok(plan.noteDe.length > 10);
      assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
    }
  }
});

test("buildPlan unter A2: erst satzbau und klaeren, dann gemeinsam, dann die Untersuchungen", () => {
  for (const overall of ["A1", null]) {
    assert.deepEqual(filesOf(buildPlan(resultWith({ overall, writing: "A2" }), CONTENT).order), BASIC_BLOCKS, overall);
  }
});

test("buildPlan: Schwacher Satzbau, also Schreiben unter A2, geht auf jeder Stufe zu den Grundlagen", () => {
  for (const overall of LEVELS) {
    assert.deepEqual(filesOf(buildPlan(resultWith({ overall, writing: "A1" }), CONTENT).order), BASIC_BLOCKS, overall);
  }
});

test("buildPlan ab A2: gemeinsam, klaeren, Untersuchungen, Small Talk dazwischen, Grammatik zuletzt", () => {
  const { order } = buildPlan(resultWith({ overall: "A2", writing: "A2" }), CONTENT);
  const smallTalk = ALL_SECTIONS.filter((section) => section.file === "satzbau" && section.explanationDe === null).map((section) => section.id);
  const grammar = ALL_SECTIONS.filter((section) => section.file === "satzbau" && section.explanationDe !== null).map((section) => section.id);
  assert.equal(smallTalk.length, 5);
  assert.equal(grammar.length, 4);
  const main = order.filter((id) => !smallTalk.includes(id) && !grammar.includes(id));
  assert.deepEqual(filesOf(main), ["gemeinsam", "klaeren", "mrt", "ct", "roentgen"]);
  assert.deepEqual(order.slice(-grammar.length), grammar);
  const positions = smallTalk.map((id) => order.indexOf(id));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.ok(positions[0] > 0, "Erst kommt ein Abschnitt aus dem Kern");
  assert.ok(positions.at(-1) < order.length - grammar.length - 1, "Small Talk steht zwischen den Abschnitten");
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index] - positions[index - 1] > 1, "Small Talk nicht am Stück");
  }
});

test("buildPlan ab B1: Untersuchungen und Patientenseite zuerst", () => {
  for (const overall of ["B1", "B2"]) {
    const { order } = buildPlan(resultWith({ overall, writing: "B1" }), CONTENT);
    assert.deepEqual(filesOf(order.slice(0, order.indexOf("kl.patientquestions"))), ["mrt", "ct", "roentgen"], overall);
    assert.ok(order.indexOf("kl.patientquestions") < order.indexOf("ge.greeting"), overall);
    assert.ok(order.indexOf("kl.patientquestions") < order.indexOf("kl.repeat"), overall);
    assert.ok(order.indexOf("ge.greeting") < order.indexOf("sb.questions"), overall);
  }
});

test("buildPlan: Ohne Messung im Schreiben zählt der Satzbau nicht als schwach", () => {
  assert.equal(filesOf(buildPlan(resultWith({ overall: "A2", writing: null }), CONTENT).order)[0], "gemeinsam");
  assert.equal(filesOf(buildPlan(resultWith({ overall: "B1", writing: null }), CONTENT).order)[0], "mrt");
});

test("buildPlan nimmt das echte Ergebnis von scorePlacement, die Pläne unterscheiden sich", () => {
  const form = makeForm();
  const scored = (value) => scorePlacement(form, allAnswers(form, value));
  const strong = buildPlan(scored("correct"), CONTENT);
  const weak = buildPlan(scored("wrong"), CONTENT);
  assert.deepEqual(filesOf(weak.order), BASIC_BLOCKS);
  assert.equal(filesOf(strong.order)[0], "mrt");
  assert.notEqual(strong.noteDe, weak.noteDe);
  assert.equal(buildPlan(scorePlacement(form, {}), CONTENT).order.length, ALL_SECTIONS.length);
});

// ----- Vergleich -----

test("compareAttempts: je Teil beide Stufen", () => {
  const first = resultWith({ overall: "A1", speaking: "A1", listening: "A2", writing: null });
  const latest = resultWith({ overall: "B1", speaking: "B1", listening: "B2", writing: "A2" });
  assert.deepEqual(compareAttempts(first, latest), {
    speaking: { first: "A1", latest: "B1", firstBelowA1: false, latestBelowA1: false },
    listening: { first: "A2", latest: "B2", firstBelowA1: false, latestBelowA1: false },
    writing: { first: null, latest: "A2", firstBelowA1: false, latestBelowA1: false },
    overall: { first: "A1", latest: "B1" },
  });
});

test("compareAttempts mit echten Ergebnissen, unter A1 und nach JSON", () => {
  const form = makeForm();
  const first = JSON.parse(JSON.stringify(scorePlacement(form, allAnswers(form, "wrong"))));
  const latest = JSON.parse(JSON.stringify(scorePlacement(form, allAnswers(form, "correct"))));
  const comparison = compareAttempts(first, latest);
  assert.deepEqual(comparison.speaking, { first: "A1", latest: "B2", firstBelowA1: true, latestBelowA1: false });
  assert.deepEqual(comparison.overall, { first: "A1", latest: "B2" });
  assert.deepEqual(compareAttempts(first, first).writing, { first: "A1", latest: "A1", firstBelowA1: true, latestBelowA1: true });
});

test("compareAttempts: Ohne Versuch steht überall null", () => {
  const comparison = compareAttempts(undefined, undefined);
  for (const part of Object.keys(WEIGHTS)) {
    assert.deepEqual(comparison[part], { first: null, latest: null, firstBelowA1: false, latestBelowA1: false });
  }
  assert.deepEqual(comparison.overall, { first: null, latest: null });
});
