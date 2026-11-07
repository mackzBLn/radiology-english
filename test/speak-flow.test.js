import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DONT_KNOW,
  advance,
  createSpeechSession,
  currentTask,
  dontKnowResult,
  gradeOnce,
  initialStep,
  needsGrading,
  resultFromHearing,
  sessionFits,
  sessionOutdated,
  setStepState,
  stepAfterResult,
  stepStateOf,
  summaryOf,
} from "../js/core/speak-flow.js";
import { createState, unitState } from "../js/core/state.js";
import { createStore } from "../js/core/storage.js";
import { createBrowserAssessor } from "../js/speech/assessor.js";

const TODAY = "2026-11-07";
const NOW = new Date("2026-11-07T10:00:00.000Z");
const VERSION = "0.9.0";

function task(unitId, stage, extra = {}) {
  return {
    unitId,
    stage,
    snapshot: {
      en: "Please keep still.",
      variants: [],
      keywords: ["still"],
      softKeywords: false,
      situationDe: "Die Aufnahme beginnt gleich.",
      meaningDe: "Bitte halten Sie still.",
      noteDe: null,
      clinicDependent: false,
      prompt: null,
      source: null,
      ...extra,
    },
  };
}

function backend() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function result(outcome, extra = {}) {
  return { outcome, transcript: "please keep still", words: [], against: null, reason: null, ...extra };
}

// Eine Übung samt echtem Speicher. restart() liest beides neu, wie nach einem Neuladen.
function setup(queue = [task("a.s01", "a"), task("a.s02", "b")]) {
  const store = createStore(backend(), { now: () => NOW });
  const state = createState(NOW);
  store.save(state);
  const session = createSpeechSession({ queue, focus: null, appVersion: VERSION });
  store.saveSession(session);
  const context = { store, state, session };
  context.grade = (hooks = {}) =>
    gradeOnce({
      session: context.session,
      state: context.state,
      today: TODAY,
      now: NOW,
      saveState: hooks.saveState ?? (() => store.save(context.state)),
      saveSession: hooks.saveSession ?? ((value) => store.saveSession(value)),
    });
  context.deliver = (value) => {
    setStepState(context.session, { step: stepAfterResult(value), result: value });
    store.saveSession(context.session);
  };
  context.restart = () => {
    context.state = store.load().state;
    context.session = store.loadSession();
  };
  return context;
}

describe("Sprechablauf: Schritte", () => {
  it("beginnt mit Anhören bei Stufe a und bei einer Patientenäußerung", () => {
    assert.equal(initialStep(task("x", "a")), "listen");
    assert.equal(initialStep(task("x", "b", { prompt: "Will it hurt?" })), "listen");
  });

  it("beginnt in Stufe b ohne Äußerung gleich mit dem Sprechen", () => {
    assert.equal(initialStep(task("x", "b")), "speak");
  });

  it("führt notMeasured zum Ausfall, alles andere zur Rückmeldung", () => {
    assert.equal(stepAfterResult(result("notMeasured")), "failed");
    for (const outcome of ["understood", "partly", "notUnderstood"]) {
      assert.equal(stepAfterResult(result(outcome)), "feedback");
    }
  });

  it("baut das Ergebnis aus dem Gehörten", () => {
    const heard = { status: "heard", transcript: "please keep still", reason: null, events: [] };
    const assess = (transcript) => ({ outcome: "understood", words: [{ word: transcript, status: "recognized", accuracy: null }], against: "Please keep still." });
    assert.deepEqual(resultFromHearing(heard, assess), {
      outcome: "understood",
      transcript: "please keep still",
      words: [{ word: "please keep still", status: "recognized", accuracy: null }],
      against: "Please keep still.",
      reason: null,
    });
  });

  it("macht aus einem Ausfall notMeasured, ohne zu bewerten", () => {
    const heard = { status: "notMeasured", transcript: "half a sentence", reason: "audio-capture", events: [] };
    const value = resultFromHearing(heard, () => assert.fail("darf nicht bewerten"));
    assert.deepEqual(value, { outcome: "notMeasured", transcript: "", words: [], against: null, reason: "audio-capture" });
  });

  it("reicht weiter, wenn ein not den Sinn kippen kann, und wertet das höchstens als teilweise", () => {
    const heard = { status: "heard", transcript: "you must drive after that medicine", reason: null, events: [] };
    const unit = { en: "You must not drive after that medicine.", variants: [], keywords: ["drive"] };
    const value = resultFromHearing(heard, (transcript) => createBrowserAssessor().assess({ unit, transcript, stage: "b" }));
    assert.equal(value.outcome, "partly");
    assert.equal(value.negationFlip, true);
    const same = resultFromHearing({ ...heard, transcript: "you must not drive after that medicine" }, (transcript) => createBrowserAssessor().assess({ unit, transcript, stage: "b" }));
    assert.equal("negationFlip" in same, false);
  });
});

describe("Sprechablauf: Weiß ich nicht", () => {
  it("führt zur Rückmeldung und übersteht das Speichern", () => {
    const value = dontKnowResult();
    assert.equal(value.reason, DONT_KNOW);
    assert.equal(stepAfterResult(value), "feedback");
    assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
  });

  it("wertet wie notUnderstood, einmal, und der Satz gilt nicht als gesprochen", () => {
    const state = createState(NOW);
    const session = createSpeechSession({ queue: [task("a", "b")], appVersion: VERSION });
    setStepState(session, { step: "feedback", result: dontKnowResult() });
    const options = { session, state, today: TODAY, now: NOW, saveState: () => {}, saveSession: () => {} };
    assert.equal(gradeOnce(options), true);
    assert.equal(gradeOnce(options), false);
    const unit = unitState(state, "a");
    assert.equal(unit.lastResult, "notUnderstood");
    assert.equal(unit.box, 0);
    assert.equal(unit.seen, 1);
    assert.equal(unit.spokenB, false);
    assert.equal(summaryOf(session).notUnderstood, 1);
    assert.equal(sessionFits(session, { appVersion: VERSION }), true);
  });
});

describe("Sprechablauf: Sitzung", () => {
  it("trägt die Felder des Vertrags und ihren Fokus", () => {
    const session = createSpeechSession({ queue: [task("a", "a")], focus: "mri", appVersion: VERSION });
    assert.equal(session.kind, "speech");
    assert.equal(session.appVersion, VERSION);
    assert.equal(session.focus, "mri");
    assert.equal(session.index, 0);
    assert.equal(session.step, "listen");
    assert.equal(session.result, null);
    assert.equal(session.graded, false);
    assert.equal(currentTask(session).unitId, "a");
  });

  it("übersteht den Weg durch JSON", () => {
    const session = createSpeechSession({ queue: [task("a", "a")], focus: undefined, appVersion: VERSION });
    const copy = JSON.parse(JSON.stringify(session));
    assert.deepEqual(copy, session);
    assert.equal(sessionFits(copy, { focus: undefined, appVersion: VERSION }), true);
  });

  it("passt bei gleichem Fokus und gleicher Version", () => {
    const session = createSpeechSession({ queue: [task("a", "a")], focus: "mri:safety", appVersion: VERSION });
    assert.equal(sessionFits(session, { focus: "mri:safety", appVersion: VERSION }), true);
  });

  it("passt nicht bei anderem oder fehlendem Fokus", () => {
    const session = createSpeechSession({ queue: [task("a", "a")], focus: "mri", appVersion: VERSION });
    assert.equal(sessionFits(session, { focus: "ct", appVersion: VERSION }), false);
    assert.equal(sessionFits(session, { focus: undefined, appVersion: VERSION }), false);
    const free = createSpeechSession({ queue: [task("a", "a")], appVersion: VERSION });
    assert.equal(sessionFits(free, { focus: "mri", appVersion: VERSION }), false);
  });

  it("passt nicht bei anderer Version oder Art", () => {
    const session = createSpeechSession({ queue: [task("a", "a")], appVersion: VERSION });
    assert.equal(sessionFits(session, { appVersion: "0.9.1" }), false);
    assert.equal(sessionFits({ ...session, kind: "placement" }, { appVersion: VERSION }), false);
    assert.equal(sessionFits(null, { appVersion: VERSION }), false);
  });

  it("passt nicht, wenn die Sitzung kaputt ist", () => {
    const session = createSpeechSession({ queue: [task("a", "a")], appVersion: VERSION });
    assert.equal(sessionFits({ ...session, index: 3 }, { appVersion: VERSION }), false);
    assert.equal(sessionFits({ ...session, queue: "nichts" }, { appVersion: VERSION }), false);
    assert.equal(sessionFits({ ...session, step: "unbekannt" }, { appVersion: VERSION }), false);
    assert.equal(sessionFits({ ...session, step: "feedback", result: null }, { appVersion: VERSION }), false);
    assert.equal(sessionFits({ ...session, queue: [{ unitId: "a", stage: "c", snapshot: { en: "x" } }] }, { appVersion: VERSION }), false);
  });

  it("merkt sich Schritt und Ergebnis", () => {
    const session = createSpeechSession({ queue: [task("a", "a")], appVersion: VERSION });
    setStepState(session, { step: "feedback", result: result("partly") });
    assert.deepEqual(stepStateOf(session), { step: "feedback", result: result("partly") });
  });

  it("geht zum nächsten Satz und räumt das Ergebnis weg", () => {
    const session = createSpeechSession({ queue: [task("a", "a"), task("b", "b")], appVersion: VERSION });
    setStepState(session, { step: "feedback", result: result("understood") });
    session.graded = true;
    session.seenBefore = 2;
    assert.equal(advance(session), true);
    assert.equal(session.index, 1);
    assert.equal(session.step, "speak");
    assert.equal(session.result, null);
    assert.equal(session.graded, false);
    assert.equal(session.seenBefore, null);
  });

  it("meldet das Ende beim letzten Satz und ändert nichts", () => {
    const session = createSpeechSession({ queue: [task("a", "a")], appVersion: VERSION });
    setStepState(session, { step: "feedback", result: result("understood") });
    assert.equal(advance(session), false);
    assert.equal(session.index, 0);
    assert.equal(session.step, "feedback");
  });
});

describe("Sprechablauf: Wertung nach Vertrag", () => {
  it("understood in Stufe a: ok und spokenA, spokenB bleibt", () => {
    const run = setup();
    run.deliver(result("understood"));
    assert.equal(run.grade(), true);
    const unit = unitState(run.state, "a.s01");
    assert.equal(unit.lastResult, "ok");
    assert.equal(unit.box, 1);
    assert.equal(unit.due, "2026-11-08");
    assert.equal(unit.correct, 1);
    assert.equal(unit.spokenA, true);
    assert.equal(unit.spokenB, false);
    assert.equal(run.state.stats.days[TODAY].exercises, 1);
  });

  it("understood in Stufe b: ok und spokenB", () => {
    const run = setup([task("a.s02", "b")]);
    run.deliver(result("understood"));
    run.grade();
    const unit = unitState(run.state, "a.s02");
    assert.equal(unit.spokenB, true);
    assert.equal(unit.spokenA, false);
  });

  it("partly: hint, schwach, ohne spoken", () => {
    const run = setup();
    run.deliver(result("partly"));
    run.grade();
    const unit = unitState(run.state, "a.s01");
    assert.equal(unit.lastResult, "hint");
    assert.equal(unit.box, 0);
    assert.equal(unit.due, "2026-11-08");
    assert.equal(unit.wrong, 0);
    assert.equal(unit.spokenA, false);
    assert.equal(run.state.stats.days[TODAY].exercises, 1);
  });

  it("notUnderstood: schwach und als falsch gezählt", () => {
    const run = setup();
    run.deliver(result("notUnderstood"));
    run.grade();
    const unit = unitState(run.state, "a.s01");
    assert.equal(unit.lastResult, "notUnderstood");
    assert.equal(unit.wrong, 1);
    assert.equal(unit.spokenA, false);
  });

  it("notMeasured ändert nichts außer seen", () => {
    const run = setup();
    run.state.units["a.s01"] = { ...unitState(run.state, "a.s01"), box: 3, due: "2026-11-20", correct: 3, lastResult: "ok", lastAt: "2026-11-01T08:00:00.000Z" };
    run.store.save(run.state);
    const before = unitState(run.state, "a.s01");
    run.deliver(result("notMeasured", { reason: "audio-capture", transcript: "" }));
    run.grade();
    assert.deepEqual(unitState(run.state, "a.s01"), { ...before, seen: before.seen + 1 });
    assert.equal(run.state.stats.days[TODAY], undefined);
    assert.equal(run.session.tally.notMeasured, 1);
  });

  it("speichert Lernstand und Sitzung sofort", () => {
    const run = setup();
    run.deliver(result("understood"));
    run.grade();
    run.restart();
    assert.equal(unitState(run.state, "a.s01").seen, 1);
    assert.equal(run.session.graded, true);
    assert.equal(run.session.tally.understood, 1);
  });

  it("lässt unbekannte Felder der Einheit stehen", () => {
    const run = setup();
    run.state.units["a.s01"] = { ...unitState(run.state, "a.s01"), later: "bleibt" };
    run.deliver(result("understood"));
    run.grade();
    assert.equal(run.state.units["a.s01"].later, "bleibt");
  });
});

describe("Sprechablauf: genau einmal werten", () => {
  it("wertet beim zweiten Aufruf nicht noch einmal", () => {
    const run = setup();
    run.deliver(result("understood"));
    assert.equal(run.grade(), true);
    assert.equal(run.grade(), false);
    assert.equal(unitState(run.state, "a.s01").seen, 1);
    assert.equal(unitState(run.state, "a.s01").box, 1);
    assert.equal(run.state.stats.days[TODAY].exercises, 1);
    assert.equal(run.session.tally.understood, 1);
  });

  it("wertet nach einem Neuladen nicht noch einmal", () => {
    const run = setup();
    run.deliver(result("understood"));
    run.grade();
    run.restart();
    assert.equal(needsGrading(run.session), false);
    assert.equal(run.grade(), false);
    assert.equal(unitState(run.state, "a.s01").box, 1);
  });

  it("tut ohne Ergebnis nichts", () => {
    const run = setup();
    assert.equal(run.grade(), false);
    assert.equal(run.state.units["a.s01"], undefined);
  });

  it("holt die Wertung nach, wenn die App direkt nach dem Ergebnis endete", () => {
    const run = setup();
    run.deliver(result("understood"));
    run.restart();
    assert.equal(needsGrading(run.session), true);
    run.grade();
    assert.equal(unitState(run.state, "a.s01").seen, 1);
    assert.equal(run.session.graded, true);
  });

  // Die Schreibvorgänge der Wertung sind: Sitzung, Lernstand, Sitzung. Die App endet vor jedem davon.
  for (const crashAt of [1, 2, 3]) {
    it("zählt einmal, wenn die App vor Schreibvorgang " + crashAt + " endet", () => {
      const run = setup();
      run.deliver(result("understood"));
      let writes = 0;
      const guarded = (action) => (value) => {
        writes += 1;
        if (writes === crashAt) {
          throw new Error("App beendet");
        }
        action(value);
      };
      assert.throws(
        () =>
          run.grade({
            saveState: guarded(() => run.store.save(run.state)),
            saveSession: guarded((value) => run.store.saveSession(value)),
          }),
        /App beendet/,
      );
      run.restart();
      run.grade();
      run.restart();
      const unit = unitState(run.state, "a.s01");
      assert.equal(unit.seen, 1);
      assert.equal(unit.correct, 1);
      assert.equal(unit.box, 1);
      assert.equal(run.state.stats.days[TODAY].exercises, 1);
      assert.equal(run.session.tally.understood, 1);
      assert.equal(run.session.graded, true);
    });
  }

  it("zählt einen neuen Versuch nach einem Ausfall für sich", () => {
    const run = setup();
    run.deliver(result("notMeasured", { reason: "no-speech", transcript: "" }));
    run.grade();
    setStepState(run.session, { step: "speak", result: null });
    run.store.saveSession(run.session);
    run.restart();
    assert.equal(run.session.graded, false);
    run.deliver(result("understood"));
    assert.equal(run.grade(), true);
    const unit = unitState(run.state, "a.s01");
    assert.equal(unit.seen, 2);
    assert.equal(unit.box, 1);
    assert.deepEqual(run.session.tally, { understood: 1, partly: 0, notUnderstood: 0, notMeasured: 1 });
  });

  it("wertet den nächsten Satz wieder", () => {
    const run = setup();
    run.deliver(result("understood"));
    run.grade();
    advance(run.session);
    run.deliver(result("partly"));
    assert.equal(run.grade(), true);
    assert.equal(unitState(run.state, "a.s01").lastResult, "ok");
    assert.equal(unitState(run.state, "a.s02").lastResult, "hint");
    assert.equal(run.state.stats.days[TODAY].exercises, 2);
  });

  it("wertet richtig, wenn die Einheit vorher schon geübt war", () => {
    const run = setup();
    run.state.units["a.s01"] = { ...unitState(run.state, "a.s01"), seen: 7, box: 2 };
    run.store.save(run.state);
    run.deliver(result("understood"));
    run.grade();
    run.restart();
    run.grade();
    assert.equal(unitState(run.state, "a.s01").seen, 8);
    assert.equal(unitState(run.state, "a.s01").box, 3);
  });
});

describe("Sprechablauf: Noch nicht fällige Einheiten", () => {
  const notDue = (state) => ({ ...unitState(state, "a.s01"), box: 1, due: "2026-11-08", seen: 1, correct: 1, lastResult: "ok", lastAt: "2026-11-07T08:00:00.000Z" });

  it("Verstanden zählt als gesprochen, Box und Termin bleiben", () => {
    const run = setup();
    run.state.units["a.s01"] = notDue(run.state);
    run.store.save(run.state);
    run.deliver(result("understood"));
    run.grade();
    const unit = unitState(run.state, "a.s01");
    assert.equal(unit.box, 1);
    assert.equal(unit.due, "2026-11-08");
    assert.equal(unit.spokenA, true);
    assert.equal(unit.seen, 2);
    assert.equal(unit.correct, 2);
    assert.equal(unit.lastResult, "ok");
    assert.equal(unit.lastAt, NOW.toISOString());
  });

  it("Ist die Einheit fällig oder neu, steigt die Box wie immer", () => {
    for (const due of [TODAY, "2026-11-01", null]) {
      const run = setup();
      run.state.units["a.s01"] = { ...notDue(run.state), due };
      run.store.save(run.state);
      run.deliver(result("understood"));
      run.grade();
      assert.equal(unitState(run.state, "a.s01").box, 2, String(due));
    }
  });

  it("Teilweise bleibt schwach, auch wenn die Einheit noch nicht fällig ist", () => {
    const run = setup();
    run.state.units["a.s01"] = notDue(run.state);
    run.store.save(run.state);
    run.deliver(result("partly"));
    run.grade();
    assert.equal(unitState(run.state, "a.s01").box, 0);
    assert.equal(unitState(run.state, "a.s01").due, "2026-11-08");
  });
});

describe("Sprechablauf: Runden von einem anderen Tag", () => {
  const planned = () => createSpeechSession({ queue: [task("a", "a")], appVersion: VERSION, today: "2026-11-06" });

  it("merkt sich den Tag und gilt am selben Tag weiter", () => {
    assert.equal(planned().plannedOn, "2026-11-06");
    assert.equal(sessionOutdated(planned(), "2026-11-06"), false);
  });

  it("ist am nächsten Tag veraltet, wenn nichts mehr zu werten ist", () => {
    assert.equal(sessionOutdated(planned(), TODAY), true);
    const graded = planned();
    setStepState(graded, { step: "feedback", result: result("understood") });
    graded.graded = true;
    assert.equal(sessionOutdated(graded, TODAY), true);
  });

  it("wertet ein offenes Ergebnis erst noch, und ohne Tag gilt sie weiter", () => {
    const open = planned();
    setStepState(open, { step: "feedback", result: result("understood") });
    assert.equal(sessionOutdated(open, TODAY), false);
    assert.equal(sessionOutdated(createSpeechSession({ queue: [task("a", "a")], appVersion: VERSION }), TODAY), false);
  });
});

describe("Sprechablauf: Zusammenfassung", () => {
  it("zählt Gesprochenes, Aussetzer zählen nicht mit", () => {
    const session = createSpeechSession({ queue: [task("a", "a")], appVersion: VERSION });
    session.tally = { understood: 4, partly: 2, notUnderstood: 1, notMeasured: 3 };
    assert.deepEqual(summaryOf(session), { spoken: 7, understood: 4, partly: 2, notUnderstood: 1, notMeasured: 3, comesBack: 3 });
  });
});
