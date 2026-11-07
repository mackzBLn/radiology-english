/*
 * Zusammenspiel mit den echten Daten aus daten/, ohne Browser: Lernpfad, Planer, Wertung, Speichern und Sicherung.
 * Die Zeit läuft als Parameter, der Zufall kommt aus einem festen Zahlengenerator. Kein Test wartet auf etwas.
 */

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createBackup, parseBackup } from "../js/core/backup.js";
import { loadContent } from "../js/core/content.js";
import { addDays } from "../js/core/dates.js";
import { matchSpoken, matchTyped } from "../js/core/matcher.js";
import { normalizeText } from "../js/core/normalize.js";
import { applyRating, weakUnitsFromRating } from "../js/core/partner.js";
import { buildPlan } from "../js/core/placement.js";
import { kindsFor, planSpeech, planTrain } from "../js/core/planner.js";
import { applyResult, isLearned, recordExercise } from "../js/core/srs.js";
import { createState, setUnitState, unitState } from "../js/core/state.js";
import { createStore } from "../js/core/storage.js";
import { parseRoute } from "../js/ui/router.js";
import { buildStrands, nextEntry } from "../js/ui/views/path.js";
import { resolveSection } from "../js/ui/views/section.js";
import { VERSION } from "../js/version.js";

const dataDir = new URL("../daten/", import.meta.url);
const content = await loadContent(async (name) => JSON.parse(await readFile(new URL(name + ".json", dataDir), "utf8")));
const strands = buildStrands(content);
const entries = strands.flatMap((strand) => strand.groups).flatMap((group) => group.entries);

const TODAY = "2026-11-09";
const NOW = new Date(TODAY + "T07:00:00");
const UNLIMITED = 5000;

// Fester Zufall: Gleicher Startwert, gleicher Ablauf.
function seededRng(seed) {
  let value = seed;
  return () => {
    value = (value * 48271) % 2147483647;
    return value / 2147483647;
  };
}

function memoryBackend() {
  const items = new Map();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, String(value)),
    removeItem: (key) => void items.delete(key),
  };
}

// ----- Was eine Übung erfüllen muss -----

const CORRECT_TEXT = {
  pickEnglish: (unit) => unit.en,
  wordPick: (unit) => unit.en,
  hearMeaning: (unit) => unit.meaningDe,
  wordHear: (unit) => unit.meaningDe,
  hearReact: (unit) => unit.reactions.find((reaction) => reaction.fits === true).en,
};

function choiceProblems(exercise, unit) {
  const texts = exercise.options.map((option) => normalizeText(option.text ?? ""));
  const right = exercise.options.filter((option) => option.correct === true);
  const problems = [];
  if (texts.length < 2) {
    problems.push("weniger als zwei Antworten");
  }
  if (texts.includes("")) {
    problems.push("leere Antwort");
  }
  if (new Set(texts).size !== texts.length) {
    problems.push("zwei gleiche Antworten");
  }
  if (right.length !== 1) {
    problems.push(right.length + " richtige Antworten");
  } else if (right[0].text !== CORRECT_TEXT[exercise.kind](unit)) {
    problems.push("falsche Antwort als richtig markiert");
  }
  return problems;
}

function buildProblems(exercise) {
  const words = exercise.options.map((option) => option.text);
  const problems = [];
  if ([...words].sort().join(" ") !== [...exercise.answer].sort().join(" ")) {
    problems.push("Wörter passen nicht zur Lösung");
  }
  if (words.length > 1 && new Set(words).size > 1 && words.join(" ") === exercise.answer.join(" ")) {
    problems.push("Wörter stehen schon richtig");
  }
  return problems;
}

function exerciseProblems(exercise) {
  const unit = content.unit(exercise.unitId);
  if (!unit) {
    return ["Einheit fehlt"];
  }
  const problems = kindsFor(unit).includes(exercise.kind) ? [] : ["Art passt nicht zur Einheit"];
  if (exercise.kind in CORRECT_TEXT) {
    problems.push(...choiceProblems(exercise, unit));
  } else if (exercise.kind === "buildSentence") {
    problems.push(...buildProblems(exercise));
  } else if (exercise.options.length !== 0) {
    problems.push("Antworten, wo keine hingehören");
  }
  if (exercise.kind === "typeSentence" && matchTyped(unit, unit.en).outcome !== "correct") {
    problems.push("der Satz selbst gilt getippt nicht als richtig");
  }
  return problems.map((text) => exercise.unitId + " " + exercise.kind + ": " + text);
}

function speechProblems(task) {
  const unit = content.unit(task.unitId);
  if (!unit || unit.type === "word") {
    return [task.unitId + ": gehört nicht in die Sprechübung"];
  }
  const { snapshot, stage } = task;
  const isPatient = unit.type === "patient";
  const expectedEn = isPatient ? CORRECT_TEXT.hearReact(unit) : unit.en;
  const problems = [];
  if (snapshot.en !== expectedEn) {
    problems.push("falscher Satz");
  }
  if (snapshot.prompt !== (isPatient ? unit.en : null)) {
    problems.push("falsche Vorgabe zum Anhören");
  }
  if (isPatient && (stage !== "b" || snapshot.softKeywords !== true || snapshot.variants.length !== 0)) {
    problems.push("Patientenäußerung nicht als freie Antwort angelegt");
  }
  if (!snapshot.source?.title) {
    problems.push("Quelle nicht aufgelöst");
  }
  // Eine Reaktion kann ohne Inhaltswort sein, dann wertet der Abgleich die Wörter. Das prüfen die beiden Fälle unten.
  if (!Array.isArray(snapshot.keywords) || (!isPatient && snapshot.keywords.length === 0)) {
    problems.push("keine Schlüsselwörter");
  }
  if (matchSpoken(snapshot, snapshot.en, { stage }).outcome !== "understood") {
    problems.push("der Satz selbst gilt gesprochen nicht als verstanden");
  }
  if (matchSpoken(snapshot, "purple elephants dance quietly tonight", { stage }).outcome !== "notUnderstood") {
    problems.push("etwas Fremdes gilt als verstanden");
  }
  return problems.map((text) => task.unitId + " Stufe " + stage + ": " + text);
}

// Ein neuer Satz kommt erst zum Hören und Lesen und gleich danach als Übung.
function pairProblems(plan) {
  return plan.flatMap((exercise, index) => {
    const next = plan[index + 1];
    return exercise.kind === "present" && (next?.unitId !== exercise.unitId || next.kind !== "pickEnglish")
      ? [exercise.unitId + ": nach present fehlt pickEnglish"]
      : [];
  });
}

function outsideProblems(plan, entry) {
  return plan.filter((item) => !entry.unitIds.includes(item.unitId)).map((item) => item.unitId + ": nicht in " + entry.id);
}

// Alle Einheiten des Eintrags sind heute fällig, mit diesen Angaben.
function stateWith(entry, fields) {
  const state = createState(NOW);
  for (const id of entry.unitIds) {
    setUnitState(state, id, { ...unitState(state, id), due: TODAY, ...fields });
  }
  return state;
}

describe("Jeder Eintrag des Lernpfads lässt sich üben", () => {
  const focusOf = (entry) => resolveSection(content, entry.id).focus;

  it("der Lernpfad hat Einträge, und jeder führt zu einem Fokus", () => {
    assert.ok(entries.length > 40);
    for (const entry of entries) {
      assert.ok(entry.unitIds.length > 0, entry.id);
      assert.equal(focusOf(entry), entry.id);
    }
  });

  it("planTrain: ganz neu kommen Übungen aus genau diesem Eintrag", () => {
    for (const entry of entries) {
      const plan = planTrain({ content, state: createState(NOW), today: TODAY, rng: seededRng(7), focus: focusOf(entry) });
      assert.ok(plan.length > 0 && plan.length <= 30, entry.id + ": " + plan.length + " Übungen");
      assert.deepEqual([...outsideProblems(plan, entry), ...pairProblems(plan), ...plan.flatMap(exerciseProblems)], [], entry.id);
    }
  });

  it("planTrain: Wer in einem Eintrag jede Box erreicht hat, bekommt die vorgesehene Übung", () => {
    const expected = (unit, box) => {
      if (unit.type === "patient") {
        return ["hearReact"];
      }
      return [["pickEnglish"], ["pickEnglish", "hearMeaning"], ["buildSentence"]][box] ?? ["typeSentence"];
    };
    for (const box of [0, 1, 2, 3, 4, 5]) {
      for (const entry of entries) {
        const state = stateWith(entry, { box, seen: 1 });
        const plan = planTrain({ content, state, today: TODAY, rng: seededRng(box + 1), size: UNLIMITED, focus: focusOf(entry) });
        assert.equal(plan.length, entry.unitIds.length, entry.id + " Box " + box);
        for (const exercise of plan) {
          assert.ok(expected(content.unit(exercise.unitId), box).includes(exercise.kind), exercise.unitId + " Box " + box + ": " + exercise.kind);
        }
        assert.deepEqual([...outsideProblems(plan, entry), ...plan.flatMap(exerciseProblems)], [], entry.id + " Box " + box);
      }
    }
  });

  it("planTrain: Ist nichts fällig und nichts neu, bleibt der Plan leer, und die Ansicht bietet den Weg ohne Fokus an", () => {
    for (const entry of entries) {
      const state = stateWith(entry, { box: 3, due: addDays(TODAY, 7) });
      assert.deepEqual(planTrain({ content, state, today: TODAY, rng: seededRng(3), focus: focusOf(entry) }), [], entry.id);
    }
  });

  it("planSpeech: ganz neu kommt jeder Satz in Stufe a und jede Patientenäußerung in Stufe b", () => {
    for (const entry of entries) {
      const speakable = entry.unitIds.filter((id) => content.unit(id).type !== "word");
      const focus = focusOf(entry);
      const plan = planSpeech({ content, state: createState(NOW), today: TODAY, rng: seededRng(5), focus });
      assert.equal(plan.length, Math.min(speakable.length, 12), entry.id);
      const all = planSpeech({ content, state: createState(NOW), today: TODAY, rng: seededRng(5), size: UNLIMITED, focus });
      assert.deepEqual(all.map((task) => task.unitId).sort(), [...speakable].sort(), entry.id);
      assert.deepEqual([...outsideProblems(all, entry), ...all.flatMap(speechProblems)], [], entry.id);
      for (const task of all) {
        assert.equal(task.stage, content.unit(task.unitId).type === "sentence" ? "a" : "b", task.unitId);
      }
    }
  });

  it("planSpeech: Nach Stufe a kommt jeder Satz in Stufe b, ohne Inhaltsdaten nutzbar und speicherbar", () => {
    for (const entry of entries) {
      const state = stateWith(entry, { box: 1, spokenA: true });
      const plan = planSpeech({ content, state, today: TODAY, rng: seededRng(9), size: UNLIMITED, focus: focusOf(entry) });
      assert.deepEqual(plan.map((task) => task.stage).filter((stage) => stage !== "b"), [], entry.id);
      assert.deepEqual(plan.flatMap(speechProblems), [], entry.id);
      assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan, entry.id + ": Die Sitzung speichert den Plan als JSON");
    }
  });
});

// ----- Ein ganzer Durchlauf -----

const START = TODAY;
const DAYS = 40;
const FOREIGN_ID = "aus.spaeterer.version";
const TRAIN_RESULTS = [[0.7, "ok"], [0.9, "wrong"], [1, "hint"]];
const SPEECH_OUTCOMES = [[0.6, "understood"], [0.8, "partly"], [0.9, "notUnderstood"], [1, "notMeasured"]];
const LEARNING_RESULT = { understood: "ok", partly: "hint", notUnderstood: "notUnderstood", notMeasured: "notMeasured" };

function pick(rng, table) {
  const value = rng();
  return table.find(([limit]) => value < limit)[1];
}

/*
 * Wie in der App: Jeden Tag startet sie neu und liest den Lernstand. Jede Antwort wird sofort gespeichert.
 * Täglich läuft die Bahn, jeden zweiten Tag auch Sprechen, an Tag 20 kommt eine Partner-Bewertung dazu.
 * ledger zählt unabhängig vom Lernstand mit, was dort am Ende stehen muss.
 */
function simulate() {
  const backend = memoryBackend();
  const rng = seededRng(20261109);
  let clock = NOW;
  const openStore = () => createStore(backend, { now: () => clock });

  const setup = openStore();
  let state = setup.load().state;
  state.placement.attempts.push({ form: "A", at: clock.toISOString(), parts: {}, overall: "A2", gaps: [], strengths: [] });
  state.placement.plan = buildPlan({ overall: "A2", parts: {} }, content);
  state.settings.slowRate = 0.7;
  state.fromLaterVersion = { note: "bleibt" };
  setUnitState(state, FOREIGN_ID, { box: 3, due: "2031-01-01", note: "bleibt" });
  setup.save(state);

  const ledger = { units: new Map(), days: {}, rated: [], problems: [] };

  for (let dayIndex = 0; dayIndex < DAYS; dayIndex += 1) {
    const today = addDays(START, dayIndex);
    clock = new Date(today + "T07:00:00");
    const store = openStore();
    const loaded = store.load();
    assert.equal(loaded.error, null, today);
    assert.deepEqual(loaded.state, state, "Nach dem Neustart fehlt etwas: " + today);
    state = loaded.state;

    const grade = (unitId, result, change = {}) => {
      setUnitState(state, unitId, { ...applyResult(unitState(state, unitId), result, today, clock), ...change });
      const counts = ledger.units.get(unitId) ?? { seen: 0, correct: 0, wrong: 0 };
      counts.seen += 1;
      counts.correct += result === "ok" ? 1 : 0;
      counts.wrong += result === "wrong" || result === "notUnderstood" ? 1 : 0;
      ledger.units.set(unitId, counts);
      if (result !== "notMeasured") {
        recordExercise(state, today);
        ledger.days[today] = { exercises: (ledger.days[today]?.exercises ?? 0) + 1 };
      }
      store.save(state);
    };

    if (dayIndex === 20) {
      const [item] = content.cases;
      const ratings = { "fa.check.1": "yes", "fa.check.2": "partly", "fa.check.3": "yes", "fa.check.4": "yes", "fa.check.5": "no" };
      const rating = { caseId: item.id, exam: item.exam, type: item.type, at: clock.toISOString(), ratings, helpNote: "", passed: false };
      ledger.rated = weakUnitsFromRating(rating, content);
      applyRating(state, rating, content, today);
      store.save(state);
      assert.ok(ledger.rated.length > 0 && ledger.rated.every((id) => typeof state.units[id].due === "string"));
      assert.ok(ledger.rated.filter((id) => state.units[id].due === today).length >= Math.min(ledger.rated.length, 15));
    }

    const plan = planTrain({ content, state, today, rng });
    assert.ok(plan.length > 0, today + ": nichts zu üben");
    ledger.problems.push(...pairProblems(plan), ...plan.flatMap(exerciseProblems));
    for (const exercise of plan) {
      if (exercise.kind !== "present") {
        grade(exercise.unitId, pick(rng, TRAIN_RESULTS));
      }
    }

    if (dayIndex % 2 === 1) {
      const tasks = planSpeech({ content, state, today, rng });
      assert.ok(tasks.length > 0, today + ": nichts zu sprechen");
      ledger.problems.push(...tasks.flatMap(speechProblems));
      for (const task of tasks) {
        const outcome = pick(rng, SPEECH_OUTCOMES);
        grade(task.unitId, LEARNING_RESULT[outcome], outcome === "understood" ? { [task.stage === "a" ? "spokenA" : "spokenB"]: true } : {});
      }
    }
  }
  return { state, ledger, openStore, now: clock, backend };
}

describe("40 simulierte Tage mit Planen, Werten und Speichern", () => {
  let run = null;

  before(() => {
    run = simulate();
  });

  it("alle Pläne waren in Ordnung", () => {
    assert.deepEqual(run.ledger.problems, []);
  });

  it("jede gewertete Übung steht im Lernstand", () => {
    assert.ok(run.ledger.units.size > 100, run.ledger.units.size + " Einheiten");
    for (const [id, counts] of run.ledger.units) {
      const { seen, correct, wrong } = run.state.units[id];
      assert.deepEqual({ seen, correct, wrong }, counts, id);
    }
  });

  it("es fehlt keine Einheit und es kommt keine dazu", () => {
    const expected = new Set([...run.ledger.units.keys(), ...run.ledger.rated, FOREIGN_ID]);
    assert.deepEqual(Object.keys(run.state.units).sort(), [...expected].sort());
  });

  it("die Übungen je Tag stimmen, an jedem der 40 Tage", () => {
    assert.equal(Object.keys(run.state.stats.days).length, DAYS);
    assert.deepEqual(run.state.stats.days, run.ledger.days);
  });

  it("Unbekanntes, Einstufung, Plan, Partner und Einstellungen bleiben erhalten", () => {
    const { state } = run;
    assert.deepEqual(state.fromLaterVersion, { note: "bleibt" });
    assert.deepEqual(state.units[FOREIGN_ID], { box: 3, due: "2031-01-01", note: "bleibt" });
    assert.equal(state.placement.attempts.length, 1);
    assert.deepEqual(state.placement.plan, buildPlan({ overall: "A2", parts: {} }, content));
    assert.equal(state.partner.length, 1);
    assert.equal(state.settings.slowRate, 0.7);
  });

  it("Boxen und Termine bleiben gültig, und es geht voran", () => {
    const { state } = run;
    const lastDay = addDays(START, DAYS - 1);
    for (const [id, counts] of run.ledger.units) {
      const unit = state.units[id];
      assert.ok(Number.isInteger(unit.box) && unit.box >= 0 && unit.box <= 5, id);
      assert.ok(unit.due === null || unit.due >= START, id);
      assert.ok(unit.due === null || unit.due <= addDays(lastDay, 30), id);
      assert.ok(counts.correct + counts.wrong <= counts.seen, id);
    }
    const practiced = [...run.ledger.units.keys()].map((id) => [content.unit(id), state.units[id]]);
    assert.ok(practiced.filter(([, unit]) => unit.box >= 3).length > 10, "kaum eine Einheit kam voran");
    assert.ok(practiced.filter(([unit, progress]) => unit.type === "sentence" && isLearned(unit, progress)).length > 10, "kaum ein Satz gelernt");
    assert.ok(practiced.filter(([unit, progress]) => unit.type !== "sentence" && isLearned(unit, progress)).length > 10, "kaum eine Äußerung oder ein Wort gelernt");
  });

  it("createBackup und parseBackup liefern denselben Stand zurück", () => {
    const backup = createBackup(run.state, { appVersion: VERSION, now: run.now });
    const parsed = parseBackup(JSON.stringify(backup));
    assert.equal(parsed.ok, true, parsed.reasonDe);
    assert.deepEqual(parsed.state, run.state);
    assert.equal(parsed.info.units, Object.keys(run.state.units).length);
    assert.equal(parsed.info.attempts, 1);
    assert.equal(parsed.info.appVersion, VERSION);
  });

  it("eine eingelesene Sicherung übersteht Speichern und Neustart, und es lässt sich weiterüben", () => {
    const parsed = parseBackup(JSON.stringify(createBackup(run.state, { appVersion: VERSION, now: run.now })));
    const store = createStore(memoryBackend(), { now: () => run.now });
    store.save(parsed.state);
    const loaded = store.load();
    assert.equal(loaded.error, null);
    assert.deepEqual(loaded.state, run.state);
    assert.ok(planTrain({ content, state: loaded.state, today: addDays(START, DAYS), rng: seededRng(11) }).length > 0);
  });

  it("Einlesen hebt den alten Stand auf", () => {
    const store = run.openStore();
    const stored = store.load().state;
    assert.equal(store.keepPrevious(), true);
    store.save(createState(run.now));
    assert.deepEqual(store.loadPrevious(), stored);
    store.save(stored);
  });
});

// ----- Reihenfolge nach dem Lernplan -----

describe("Die Reihenfolge nach dem Lernplan greift", () => {
  const PLANS = {
    start: buildPlan({ overall: "A1", parts: {} }, content),
    middle: buildPlan({ overall: "A2", parts: {} }, content),
    strong: buildPlan({ overall: "B1", parts: {} }, content),
  };

  function stateWithPlan(plan) {
    const state = createState(NOW);
    state.placement.plan = plan;
    return state;
  }

  const rankIn = (order, entry) => Math.min(Infinity, ...entry.unitIds.map((id) => order.indexOf(content.unit(id).sectionId)).filter((rank) => rank >= 0));

  it("der Lernplan nennt nur Abschnitte, die es gibt, und jeden genau einmal", () => {
    const ids = content.sections().map((section) => section.id).sort();
    for (const plan of Object.values(PLANS)) {
      assert.deepEqual([...plan.order].sort(), ids);
    }
  });

  it("der nächste Abschnitt kommt aus dem Plan, ohne Plan aus dem Lernpfad", () => {
    assert.equal(nextEntry(strands, content, createState(NOW)).id, "sb.questions");
    assert.equal(nextEntry(strands, content, stateWithPlan(PLANS.start)).id, "sb.questions");
    const middle = nextEntry(strands, content, stateWithPlan(PLANS.middle));
    assert.deepEqual([middle.id, middle.groupId], ["mri:greeting", "mri"]);
    const strong = nextEntry(strands, content, stateWithPlan(PLANS.strong));
    assert.deepEqual([strong.id, strong.groupId], ["mri:procedure", "mri"]);
  });

  it("Schritt für Schritt bleibt die Reihenfolge des Plans bis zum Ende", () => {
    for (const plan of Object.values(PLANS)) {
      const state = stateWithPlan(plan);
      const ranks = [];
      const seen = new Set();
      for (let next = nextEntry(strands, content, state); next; next = nextEntry(strands, content, state)) {
        assert.ok(!seen.has(next.id), next.id + " kam zweimal");
        seen.add(next.id);
        ranks.push(rankIn(plan.order, next));
        for (const id of next.unitIds) {
          setUnitState(state, id, { ...unitState(state, id), box: 2, spokenB: true });
        }
      }
      assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
      assert.equal(ranks[0], 0);
      assert.equal(entries.filter((entry) => entry.unitIds.some((id) => !isLearned(content.unit(id), unitState(state, id)))).length, 0);
    }
  });

  it("die neuen Sätze in Bahn und Sprechen kommen aus dem Teil, den der Plan nach vorn holt", () => {
    const firstNewFile = (plan) => {
      const exercises = planTrain({ content, state: stateWithPlan(plan), today: TODAY, rng: seededRng(13) });
      return content.unit(exercises.find((exercise) => exercise.kind === "present").unitId).file;
    };
    const firstSpokenFile = (plan) => {
      const tasks = planSpeech({ content, state: stateWithPlan(plan), today: TODAY, rng: seededRng(13) });
      return content.unit(tasks.find((task) => task.stage === "a").unitId).file;
    };
    for (const firstFile of [firstNewFile, firstSpokenFile]) {
      assert.equal(firstFile(null), "satzbau");
      assert.equal(firstFile(PLANS.start), "satzbau");
      assert.equal(firstFile(PLANS.middle), "gemeinsam");
      assert.equal(firstFile(PLANS.strong), "mrt");
    }
  });
});

// ----- Ansichten -----

describe("Die Ansichten aus dem Bauauftrag", () => {
  const VIEWS = ["home", "path", "section", "backup", "settings", "train", "speak", "partner", "progress", "placement"];

  it("jede Datei existiert und exportiert render", async () => {
    for (const name of VIEWS) {
      const text = await readFile(new URL("../js/ui/views/" + name + ".js", import.meta.url), "utf8");
      assert.match(text, /^export\s+(async\s+)?function\s+render\s*\(/m, name);
    }
  });

  it("jede Route führt zu einer dieser Ansichten", () => {
    const hashes = ["#/", "#/pfad", "#/abschnitt/x", "#/bahn", "#/bahn/x", "#/sprechen", "#/sprechen/x", "#/partner", "#/partner/a/b", "#/fortschritt", "#/einstufung", "#/sichern", "#/einstellungen"];
    assert.deepEqual([...new Set(hashes.map((hash) => parseRoute(hash).view))].sort(), [...VIEWS].sort());
  });
});
