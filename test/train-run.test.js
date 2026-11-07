import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { matchTyped } from "../js/core/matcher.js";
import { createState, unitState } from "../js/core/state.js";
import {
  HINT_STEPS,
  RETRY_GAP,
  ROUND_LIMIT_MS,
  advance,
  builtResult,
  choiceResult,
  createRun,
  currentItem,
  elapsedMs,
  feedbackFor,
  formatClock,
  gradeAnswer,
  hasNext,
  hasProgress,
  isFirstHearing,
  isHearing,
  isOverTime,
  optionsAreEnglish,
  pauseClock,
  promptOf,
  resumeClock,
  speaksBySelf,
  summaryOf,
  tileWords,
  typedAnswer,
  typedResult,
  typingHint,
  verdictOf,
} from "../js/core/train-run.js";

const TODAY = "2026-11-07";
const START = new Date("2026-11-07T10:00:00.000Z");

function later(ms) {
  return new Date(START.getTime() + ms);
}

// Zufall, der nichts vertauscht, und einer, der immer tauscht.
const keepOrder = () => 0.999;
const swapAlways = () => 0;

function choice(unitId, kind = "pickEnglish") {
  return {
    unitId,
    kind,
    options: [
      { text: "Please keep still.", correct: true, meaningDe: "Bitte halten Sie still.", source: { ref: "a" } },
      { text: "Please follow me.", correct: false, meaningDe: "Bitte folgen Sie mir.", source: { ref: "b" } },
    ],
  };
}

function present(unitId) {
  return { unitId, kind: "present", options: [] };
}

function runOf(plan, state = createState(START)) {
  return { state, run: createRun({ plan, state, now: START }) };
}

function grade(run, state, result, { saves = [], now = START, rng = keepOrder } = {}) {
  return gradeAnswer({ run, state, result, today: TODAY, now, rng, save: () => saves.push(result) });
}

describe("Wertung einer Antwort", () => {
  it("wendet das Ergebnis an, zählt die Übung und speichert sofort", () => {
    const { run, state } = runOf([choice("u1")]);
    const saves = [];
    assert.equal(grade(run, state, "ok", { saves }), true);
    const unit = unitState(state, "u1");
    assert.equal(unit.box, 1);
    assert.equal(unit.correct, 1);
    assert.equal(unit.lastResult, "ok");
    assert.equal(state.stats.days[TODAY].exercises, 1);
    assert.deepEqual(saves, ["ok"]);
  });

  it("speichert erst, wenn Einheit und Tageszahl im Lernstand stehen", () => {
    const { run, state } = runOf([choice("u1")]);
    let seenAtSave = null;
    gradeAnswer({
      run,
      state,
      result: "wrong",
      today: TODAY,
      now: START,
      rng: keepOrder,
      save: () => {
        seenAtSave = { wrong: unitState(state, "u1").wrong, exercises: state.stats.days[TODAY].exercises };
      },
    });
    assert.deepEqual(seenAtSave, { wrong: 1, exercises: 1 });
  });

  it("present zählt nicht als Abruf und ändert den Lernstand nicht", () => {
    const { run, state } = runOf([present("u1"), choice("u1")]);
    const before = JSON.stringify(state);
    const saves = [];
    assert.equal(grade(run, state, "ok", { saves }), false);
    assert.equal(JSON.stringify(state), before);
    assert.deepEqual(saves, []);
    assert.equal(run.tally.right, 0);
  });

  it("wertet dieselbe Übung nur einmal", () => {
    const { run, state } = runOf([choice("u1")]);
    assert.equal(grade(run, state, "ok"), true);
    assert.equal(grade(run, state, "ok"), false);
    assert.equal(unitState(state, "u1").seen, 1);
    assert.equal(state.stats.days[TODAY].exercises, 1);
  });

  it("hint heißt schwach: Box 0, morgen wieder, kein Fehler", () => {
    const { run, state } = runOf([{ unitId: "u1", kind: "typeSentence", options: [] }]);
    grade(run, state, "hint");
    const unit = unitState(state, "u1");
    assert.equal(unit.box, 0);
    assert.equal(unit.due, "2026-11-08");
    assert.equal(unit.wrong, 0);
    assert.equal(run.tally.hinted, 1);
    assert.equal(run.queue.length, 1, "Nur Falsches kommt in der Runde wieder");
  });
});

describe("Falsches kommt einmal wieder", () => {
  function plan(count) {
    return Array.from({ length: count }, (_, index) => choice("u" + index));
  }

  it("legt den zweiten Versuch ein paar Übungen später ein", () => {
    const { run, state } = runOf(plan(6));
    grade(run, state, "wrong");
    assert.equal(run.queue.length, 7);
    const retry = run.queue[RETRY_GAP + 1];
    assert.equal(retry.retry, true);
    assert.equal(retry.exercise.unitId, "u0");
  });

  it("am Ende der Runde kommt der zweite Versuch direkt danach", () => {
    const { run, state } = runOf(plan(1));
    grade(run, state, "wrong");
    assert.equal(run.queue.length, 2);
    assert.equal(run.queue[1].exercise.unitId, "u0");
    assert.equal(advance(run, START), true);
    assert.equal(currentItem(run).retry, true);
  });

  it("ein zweiter falscher Versuch kommt nicht noch einmal und zählt nicht als neuer Fehler", () => {
    const { run, state } = runOf(plan(1));
    grade(run, state, "wrong");
    advance(run, START);
    grade(run, state, "wrong");
    assert.equal(run.queue.length, 2);
    assert.equal(summaryOf(run, START).wrong, 1);
    assert.equal(summaryOf(run, START).answered, 1);
    assert.equal(unitState(state, "u0").wrong, 2, "Der Lernstand zählt jede Antwort");
  });

  it("ein zweiter richtiger Versuch zählt nur als solcher", () => {
    const { run, state } = runOf(plan(1));
    grade(run, state, "wrong");
    advance(run, START);
    grade(run, state, "ok");
    const summary = summaryOf(run, START);
    assert.deepEqual([summary.right, summary.wrong, summary.rightOnRetry], [0, 1, 1]);
    const unit = unitState(state, "u0");
    assert.equal(unit.lastResult, "ok");
    assert.equal(unit.box, 1);
    assert.equal(state.stats.days[TODAY].exercises, 2);
  });

  it("rückt nicht zwischen einen neuen Satz und seine Übung", () => {
    const { run, state } = runOf([choice("u0"), choice("u1"), choice("u2"), present("u3"), choice("u3"), choice("u4")]);
    grade(run, state, "wrong");
    const kinds = run.queue.map((item) => item.exercise.kind + ":" + item.exercise.unitId);
    assert.deepEqual(kinds, [
      "pickEnglish:u0",
      "pickEnglish:u1",
      "pickEnglish:u2",
      "present:u3",
      "pickEnglish:u3",
      "pickEnglish:u0",
      "pickEnglish:u4",
    ]);
  });

  it("mischt die Antworten neu und lässt die Übung im Plan unverändert", () => {
    const exercise = choice("u0");
    const firstTexts = exercise.options.map((option) => option.text);
    const { run, state } = runOf([exercise]);
    grade(run, state, "wrong", { rng: swapAlways });
    assert.deepEqual(run.queue[1].exercise.options.map((option) => option.text), [...firstTexts].reverse());
    assert.deepEqual(exercise.options.map((option) => option.text), firstTexts);
  });

  it("buildSentence behält die Reihenfolge der Wörter, die Folge ist nie schon die Lösung", () => {
    const exercise = { unitId: "u0", kind: "buildSentence", options: [{ text: "still" }, { text: "keep" }], answer: ["keep", "still"] };
    const { run, state } = runOf([exercise]);
    grade(run, state, "wrong", { rng: swapAlways });
    assert.deepEqual(run.queue[1].exercise.options, exercise.options);
  });
});

describe("Zeit", () => {
  it("zeigt die Laufzeit als Minuten und Sekunden", () => {
    assert.equal(formatClock(0), "00:00");
    assert.equal(formatClock(59_999), "00:59");
    assert.equal(formatClock(61_000), "01:01");
    assert.equal(formatClock(ROUND_LIMIT_MS), "18:00");
  });

  it("nach 18 Minuten keine neue Übung mehr", () => {
    const { run, state } = runOf([choice("u0"), choice("u1")]);
    const justBefore = later(ROUND_LIMIT_MS - 1);
    assert.equal(hasNext(run, justBefore), true);
    assert.equal(isOverTime(run, justBefore), false);
    grade(run, state, "ok", { now: later(ROUND_LIMIT_MS) });
    const atLimit = later(ROUND_LIMIT_MS);
    assert.equal(isOverTime(run, atLimit), true);
    assert.equal(hasNext(run, atLimit), false);
    assert.equal(advance(run, atLimit), false);
    assert.equal(currentItem(run).exercise.unitId, "u0");
    assert.equal(unitState(state, "u0").correct, 1, "Die laufende Übung zählt noch");
  });

  it("die Uhr steht, solange sie angehalten ist", () => {
    const { run } = runOf([choice("u0")]);
    pauseClock(run, later(60_000));
    assert.equal(elapsedMs(run, later(600_000)), 60_000);
    resumeClock(run, later(600_000));
    assert.equal(elapsedMs(run, later(630_000)), 90_000);
    resumeClock(run, later(640_000));
    assert.equal(elapsedMs(run, later(640_000)), 100_000, "Ein zweites Fortsetzen ändert nichts");
  });

  it("eine zurückgestellte Geräteuhr macht die Laufzeit nicht negativ", () => {
    const { run } = runOf([choice("u0")]);
    assert.equal(elapsedMs(run, later(-5_000)), 0);
  });
});

describe("Weiter und Ende", () => {
  it("geht Übung für Übung und meldet das Ende", () => {
    const { run } = runOf([choice("u0"), choice("u1")]);
    assert.equal(hasNext(run, START), true);
    assert.equal(advance(run, START), true);
    assert.equal(currentItem(run).exercise.unitId, "u1");
    assert.equal(hasNext(run, START), false);
    assert.equal(advance(run, START), false);
  });

  it("hasProgress ist erst nach der ersten Antwort oder dem ersten Weiter wahr", () => {
    const { run, state } = runOf([choice("u0"), choice("u1")]);
    assert.equal(hasProgress(run), false);
    grade(run, state, "ok");
    assert.equal(hasProgress(run), true);
  });
});

describe("Ton", () => {
  it("kennt die Hörübungen", () => {
    for (const kind of ["present", "hearReact", "hearMeaning", "wordHear"]) {
      assert.equal(isHearing({ kind }), true, kind);
    }
    for (const kind of ["pickEnglish", "buildSentence", "typeSentence", "wordPick"]) {
      assert.equal(isHearing({ kind }), false, kind);
    }
  });

  it("die erste Hörübung startet per Tipp, die nächste spricht von selbst", () => {
    const { run } = runOf([choice("u0"), choice("u1", "hearMeaning"), choice("u2"), choice("u3", "hearMeaning")]);
    assert.equal(isFirstHearing(run), false, "Noch keine Hörübung");
    assert.equal(speaksBySelf(run), false);
    advance(run, START);
    assert.equal(isFirstHearing(run), true);
    assert.equal(speaksBySelf(run), false);
    advance(run, START);
    assert.equal(isFirstHearing(run), false);
    assert.equal(speaksBySelf(run), false, "Keine Hörübung, also kein Ton");
    advance(run, START);
    assert.equal(isFirstHearing(run), false);
    assert.equal(speaksBySelf(run), true);
  });

  it("eine neue Runde beginnt wieder mit dem Tipp", () => {
    const { run } = runOf([choice("u1", "hearMeaning")]);
    assert.equal(isFirstHearing(run), true);
    assert.equal(speaksBySelf(run), false);
  });
});

describe("Ergebnis der Antwortarten", () => {
  const unit = {
    en: "Please remove your coat.",
    variants: ["Remove your coat, please.", "Please take off your coat."],
    keywords: ["coat"],
  };
  const exercise = { unitId: "u0", kind: "buildSentence", options: [], answer: ["Please", "remove", "your", "coat"] };

  it("Antwort antippen", () => {
    assert.equal(choiceResult({ correct: true }), "ok");
    assert.equal(choiceResult({ correct: false }), "wrong");
    assert.equal(choiceResult({}), "wrong");
  });

  it("Satz legen: die Folge der Übung ist richtig, eine falsche Folge falsch", () => {
    assert.equal(builtResult(exercise, unit, ["Please", "remove", "your", "coat"]), "ok");
    assert.equal(builtResult(exercise, unit, ["Please", "your", "remove", "coat"]), "wrong");
  });

  it("Satz legen: auch eine andere gültige Fassung aus denselben Wörtern ist richtig", () => {
    assert.equal(builtResult(exercise, unit, ["Remove", "your", "coat", "Please"]), "ok");
  });

  it("Tippen: correct und close zählen, mit Hinweis wird daraus hint", () => {
    assert.equal(typedResult("correct", false), "ok");
    assert.equal(typedResult("close", false), "ok");
    assert.equal(typedResult("correct", true), "hint");
    assert.equal(typedResult("close", true), "hint");
    assert.equal(typedResult("wrong", false), "wrong");
    assert.equal(typedResult("wrong", true), "wrong", "Ein Hinweis macht eine falsche Antwort nicht besser");
  });

  it("Tippen: zusammen mit matchTyped, ein Tippfehler zählt als richtig", () => {
    assert.equal(typedResult(matchTyped(unit, "please remove your coat").outcome, false), "ok");
    assert.equal(typedResult(matchTyped(unit, "Please remove your coaat").outcome, false), "ok");
    assert.equal(typedResult(matchTyped(unit, "I like trains").outcome, false), "wrong");
  });

  it("Tippen: Wortsalat ist falsch, nicht fast richtig", () => {
    const pacemaker = { en: "Do you have a pacemaker?", variants: [], keywords: ["pacemaker"] };
    assert.deepEqual(typedAnswer(matchTyped(pacemaker, "pacemaker a have you do"), false), { result: "wrong", close: false, negationFlip: false, against: null });
  });

  it("Tippen: Kippt der Sinn durch ein not, ist die Antwort falsch und zeigt den Satz", () => {
    const medicine = { en: "You must not drive after that medicine.", variants: [], keywords: ["drive"] };
    assert.deepEqual(typedAnswer(matchTyped(medicine, "you must drive after that medicine"), false), {
      result: "wrong",
      close: false,
      negationFlip: true,
      against: medicine.en,
    });
    assert.equal(typedAnswer(matchTyped(medicine, "you must not drive after that medicine"), false).result, "ok");
    assert.equal(typedAnswer(matchTyped(medicine, "you must not drive after that medicine"), true).result, "hint");
  });

  it("Tippen: Fast richtig zeigt die Fassung, der die Eingabe am nächsten kam", () => {
    const answer = typedAnswer(matchTyped(unit, "Please remove your coaat"), false);
    assert.equal(answer.result, "ok");
    assert.equal(answer.close, true);
    assert.equal(answer.against, unit.en);
    assert.equal(answer.negationFlip, false);
  });
});

describe("Kacheln beim Satzlegen", () => {
  const words = (answer, order = answer) => ({ answer, options: order.map((text) => ({ text })) });

  it("der Großbuchstabe am Satzanfang verrät das erste Wort nicht", () => {
    assert.deepEqual(tileWords(words(["Do", "you", "have", "a", "pacemaker"], ["a", "you", "Do", "pacemaker", "have"])), ["a", "you", "do", "pacemaker", "have"]);
    assert.deepEqual(tileWords(words(["Please", "keep", "still"])), ["please", "keep", "still"]);
  });

  it("I und Abkürzungen bleiben, wie sie sind", () => {
    for (const first of ["I", "I'm", "I’ll", "Mr", "MRI", "CT", "GP"]) {
      assert.equal(tileWords(words([first, "here"]))[0], first);
    }
    assert.deepEqual(tileWords(words(["This", "is", "an", "MRI", "scan"])), ["this", "is", "an", "MRI", "scan"]);
  });

  it("die kleine Schreibung zählt beim Prüfen als richtig", () => {
    const unit = { en: "Do you have a pacemaker?", variants: [] };
    const exercise = words(["Do", "you", "have", "a", "pacemaker"]);
    assert.equal(builtResult(exercise, unit, tileWords(exercise)), "ok");
  });
});

describe("Fällig, aber noch nie geübt", () => {
  const rated = () => {
    const state = createState(START);
    state.units.u1 = { ...unitState(state, "u1"), due: TODAY };
    state.units.u2 = { ...unitState(state, "u2"), due: TODAY, seen: 2, box: 0 };
    return state;
  };

  it("ein Satz aus einer Bewertung kommt erst zum Hören und Lesen", () => {
    const { run } = runOf([choice("u1"), choice("u2")], rated());
    assert.deepEqual(run.queue.map((item) => [item.exercise.unitId, item.exercise.kind]), [
      ["u1", "present"],
      ["u1", "pickEnglish"],
      ["u2", "pickEnglish"],
    ]);
    assert.deepEqual(run.newUnitIds, [], "Er zählt nicht als neu");
  });

  it("schon vorgestellt oder neu: kein zweites present", () => {
    const { run } = runOf([present("u1"), choice("u1")], rated());
    assert.equal(run.queue.length, 2);
    const fresh = runOf([choice("n1")]);
    assert.equal(fresh.run.queue.length, 1);
  });

  it("present ändert nichts am Lernstand, die Übung danach wertet wie sonst", () => {
    const { run, state } = runOf([choice("u1")], rated());
    assert.equal(grade(run, state, "ok"), false);
    assert.equal(unitState(state, "u1").seen, 0);
    assert.equal(advance(run, START), true);
    assert.equal(grade(run, state, "ok"), true);
    assert.equal(unitState(state, "u1").box, 1);
  });
});

describe("Rückmeldung", () => {
  const unit = {
    en: "It is very loud.",
    meaningDe: "Es ist sehr laut.",
    noteDe: "Ein Hinweis.",
    source: { ref: "u" },
    clinicDependent: false,
  };
  const fits = { text: "We will give you ear plugs.", correct: true, meaningDe: "Sie bekommen Ohrstöpsel.", source: { ref: "f" }, clinicDependent: true };
  const misses = { text: "It is nearly over.", correct: false, meaningDe: "Es ist fast vorbei.", whyDe: "Es fängt gerade erst an.", source: { ref: "m" } };
  const hearReact = { unitId: "p1", kind: "hearReact", options: [misses, fits] };

  it("hearReact richtig: Äußerung und gewählte Reaktion, ohne falsche Wahl", () => {
    const feedback = feedbackFor({ exercise: hearReact, unit, chosen: fits });
    assert.equal(feedback.sentence.en, unit.en);
    assert.equal(feedback.sentence.meaningDe, unit.meaningDe);
    assert.equal(feedback.reaction.en, fits.text);
    assert.equal(feedback.wrongChoice, null);
    assert.equal(feedback.noteDe, "Ein Hinweis.");
  });

  it("hearReact falsch: Die passende Reaktion steht da, die falsche Wahl mit Begründung", () => {
    const feedback = feedbackFor({ exercise: hearReact, unit, chosen: misses });
    assert.equal(feedback.reaction.en, fits.text);
    assert.equal(feedback.reaction.meaningDe, fits.meaningDe);
    assert.equal(feedback.wrongChoice.text, misses.text);
    assert.equal(feedback.wrongChoice.whyDe, misses.whyDe);
    assert.equal(feedback.wrongChoice.english, true);
  });

  it("clinicNote, wenn die Einheit oder die passende Reaktion es trägt", () => {
    assert.equal(feedbackFor({ exercise: hearReact, unit, chosen: misses }).clinic, true);
    const plain = { unitId: "u", kind: "pickEnglish", options: [] };
    assert.equal(feedbackFor({ exercise: plain, unit }).clinic, false);
    assert.equal(feedbackFor({ exercise: plain, unit: { ...unit, clinicDependent: true } }).clinic, true);
  });

  it("eine falsche Wahl der Bedeutung ist deutsch", () => {
    const exercise = { unitId: "u", kind: "hearMeaning", options: [{ text: "Falsch", correct: false }, { text: "Richtig", correct: true }] };
    const feedback = feedbackFor({ exercise, unit, chosen: exercise.options[0] });
    assert.equal(feedback.wrongChoice.english, false);
    assert.equal(feedback.reaction, null);
    assert.equal(feedback.sentence.en, unit.en);
  });

  it("fast richtig getippt: Die Fassung, der die Eingabe am nächsten kam", () => {
    const exercise = { unitId: "u", kind: "typeSentence", options: [] };
    assert.equal(feedbackFor({ exercise, unit, against: "It is really loud." }).sentence.en, "It is really loud.");
    assert.equal(feedbackFor({ exercise, unit }).sentence.en, unit.en);
  });

  it("weiß, welche Arten englische Antworten haben", () => {
    assert.deepEqual(
      ["pickEnglish", "wordPick", "hearReact", "hearMeaning", "wordHear"].map(optionsAreEnglish),
      [true, true, true, false, false],
    );
  });
});

describe("Texte der Rückmeldung und der Aufgabe", () => {
  it("richtig braucht keinen Zusatz", () => {
    assert.deepEqual(verdictOf("ok"), { tone: "ok", title: "Richtig", label: null, closing: null });
  });

  it("fast richtig zählt und zeigt den genauen Satz", () => {
    const verdict = verdictOf("ok", { close: true });
    assert.equal(verdict.tone, "ok");
    assert.equal(verdict.title, "Fast richtig, das zählt");
    assert.equal(verdict.label, "So heißt der Satz genau:");
  });

  it("mit Hinweis kommt der Satz morgen wieder", () => {
    assert.equal(verdictOf("hint").title, "Richtig, mit Hinweis");
    assert.equal(verdictOf("hint", { close: true }).title, "Fast richtig, mit Hinweis");
    assert.equal(verdictOf("hint").closing, "Der Satz kommt morgen wieder.");
    assert.equal(verdictOf("hint").tone, "warn");
  });

  it("falsch sagt, wann es wiederkommt", () => {
    assert.equal(verdictOf("wrong", { comesAgain: true }).closing, "Das kommt gleich noch einmal.");
    assert.equal(verdictOf("wrong", { comesAgain: false }).closing, "Das kommt morgen wieder.");
    assert.equal(verdictOf("wrong").tone, "error");
  });

  it("falsch sagt es schon in der Überschrift", () => {
    assert.equal(verdictOf("wrong", { comesAgain: true }).title, "Noch nicht richtig, kommt gleich nochmal");
    assert.equal(verdictOf("wrong", { comesAgain: false }).title, "Noch nicht richtig, kommt morgen wieder");
  });

  it("die Aufgabe zeigt bei Hörübungen nichts vom Satz", () => {
    const unit = { en: "Please keep still.", situationDe: "Die Aufnahme läuft.", meaningDe: "Bitte halten Sie still." };
    for (const kind of ["hearReact", "hearMeaning", "wordHear"]) {
      assert.equal(promptOf(kind, unit).text, null, kind);
    }
    assert.equal(promptOf("pickEnglish", unit).text, unit.situationDe);
    assert.equal(promptOf("wordPick", unit).text, unit.meaningDe);
  });
});

describe("Hinweis beim Tippen", () => {
  const en = "Don't move, please.";

  it("zeigt Schritt für Schritt mehr", () => {
    assert.equal(typingHint(en, 1).en, "Don't …");
    assert.match(typingHint(en, 1).textDe, /^3 Wörter/);
    assert.equal(typingHint(en, 2).en, "D__'_ m___ p_____");
    assert.equal(typingHint(en, HINT_STEPS).en, "Do_'_ mo__ ple___");
  });

  it("zählt ein einzelnes Wort richtig", () => {
    assert.match(typingHint("Okay.", 1).textDe, /^1 Wort\./);
  });

  it("verrät nie den ganzen Satz", () => {
    for (let step = 1; step <= HINT_STEPS; step += 1) {
      assert.notEqual(typingHint(en, step).en, "Don't move please");
    }
  });
});

describe("Zusammenfassung", () => {
  it("zählt richtig, falsch, neu und Zeit, jede Einheit nur einmal als neu", () => {
    const state = createState(START);
    state.units.old = { box: 2, due: TODAY, seen: 3, correct: 3, wrong: 0, lastResult: "ok", lastAt: null, spokenA: false, spokenB: false };
    const { run } = runOf([choice("old"), present("n1"), choice("n1"), choice("n2", "wordHear")], state);

    grade(run, state, "ok");
    advance(run, START);
    advance(run, START);
    grade(run, state, "ok");
    advance(run, START);
    grade(run, state, "wrong");

    const summary = summaryOf(run, later(125_000));
    assert.equal(summary.right, 2);
    assert.equal(summary.wrong, 1);
    assert.equal(summary.fresh, 2);
    assert.equal(summary.answered, 3);
    assert.equal(summary.comesBack, 1);
    assert.equal(summary.elapsedMs, 125_000);
  });

  it("ein nur vorgestellter Satz zählt als neu, wenn sie weitergegangen ist, ändert aber nichts am Lernstand", () => {
    const { run, state } = runOf([present("n1"), choice("n1")]);
    assert.equal(summaryOf(run, START).fresh, 0);
    advance(run, START);
    assert.equal(summaryOf(run, START).fresh, 1);
    assert.equal(summaryOf(run, START).answered, 0);
    assert.equal(unitState(state, "n1").seen, 0);
  });

  it("eine leere Zusammenfassung ist möglich", () => {
    const { run } = runOf([choice("u0")]);
    assert.deepEqual(summaryOf(run, START), { right: 0, wrong: 0, hinted: 0, rightOnRetry: 0, fresh: 0, elapsedMs: 0, answered: 0, comesBack: 0 });
  });
});
