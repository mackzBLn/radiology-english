// Einstufungstest: prüft die echten Daten aus daten/einstufung.json und rechnet sie mit scorePlacement durch.
// Dazu die Sitzungslogik aus views/placement.js, die ohne DOM läuft. Den Ablauf in der Ansicht prüft der Browser.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildContent, UNIT_FILES } from "../js/core/content.js";
import { matchSpoken, matchTyped } from "../js/core/matcher.js";
import { tokens } from "../js/core/normalize.js";
import { buildPlan, chooseForm, LEVELS, scorePlacement } from "../js/core/placement.js";
import { createState } from "../js/core/state.js";
import { isSpeechAvailable } from "../js/ui/speak-step.js";
import {
  SCALE_SOURCE,
  advance,
  answerFromTyping,
  attemptFrom,
  createFormSnapshot,
  createPlacementSession,
  createRetakeSession,
  currentItem,
  overallText,
  recordAnswer,
  recordSpeech,
  resultRows,
  sessionUsable,
  skipRemainingSpeaking,
  speakingOpen,
  storeAttempt,
  testSentences,
} from "../js/ui/views/placement.js";

function readData(name) {
  return JSON.parse(readFileSync(new URL("../daten/" + name + ".json", import.meta.url), "utf8"));
}

const data = readData("einstufung");
const sources = readData("quellen");
const content = buildContent(
  Object.fromEntries([...UNIT_FILES, "faelle", "quellen"].map((name) => [name, readData(name)])),
);
const forms = data.forms;
const allItems = forms.flatMap((form) => form.items);
const resolve = (ref) => content.source(ref);
const noShuffle = () => 0.999;

function textsOf(item) {
  return [item.en, ...item.variants];
}

function hasKeyword(text, keyword) {
  const words = " " + tokens(text).join(" ") + " ";
  return keyword.split("|").some((choice) => words.includes(" " + tokens(choice).join(" ") + " "));
}

function answersWhere(form, decide) {
  return Object.fromEntries(form.items.map((item) => [item.id, decide(item)]));
}

const passUpTo = (limit) => (item) => (LEVELS.indexOf(item.level) <= LEVELS.indexOf(limit) ? "correct" : "wrong");

test("Daten: zwei Fassungen A und B", () => {
  assert.equal(data.file, "einstufung");
  assert.deepEqual(forms.map((form) => form.id), ["A", "B"]);
});

for (const form of forms) {
  test("Fassung " + form.id + ": 8 Sprechen, 8 Hören, 4 Schreiben, je Stufe verteilt", () => {
    for (const level of LEVELS) {
      const ofLevel = form.items.filter((item) => item.level === level);
      const speaking = ofLevel.filter((item) => item.part === "speaking");
      assert.deepEqual(speaking.map((item) => item.type).sort(), ["repeat", "respond"], level);
      const listening = ofLevel.filter((item) => item.part === "listening");
      assert.deepEqual(listening.map((item) => item.type), ["hearChoose", "hearChoose"], level);
      const writing = ofLevel.filter((item) => item.part === "writing");
      assert.deepEqual(writing.map((item) => item.type), ["type"], level);
    }
    assert.equal(form.items.length, 20);
  });

  test("Fassung " + form.id + ": IDs folgen dem Muster und sind eindeutig", () => {
    const prefix = "pl." + form.id.toLowerCase() + ".";
    const short = { speaking: "sp", listening: "li", writing: "wr" };
    for (const item of form.items) {
      assert.match(item.id, new RegExp("^" + prefix.replaceAll(".", "\\.") + short[item.part] + "\\d\\d$"));
    }
    assert.equal(new Set(form.items.map((item) => item.id)).size, form.items.length);
  });
}

test("Kein Satz kommt in beiden Fassungen vor", () => {
  const sentences = (form) =>
    new Set(form.items.flatMap((item) => [...textsOf(item), ...(item.options ?? []).map((option) => option.en)]).map((text) => tokens(text).join(" ")));
  const [a, b] = forms.map(sentences);
  assert.deepEqual([...a].filter((text) => b.has(text)), []);
});

test("Jeder englische Satz hat höchstens 15 Wörter und ist sauber geschrieben", () => {
  for (const item of allItems) {
    for (const text of [...textsOf(item), ...(item.options ?? []).map((option) => option.en)]) {
      assert.ok(text.trim().split(/\s+/).length <= 15, text);
      assert.match(text, /^[A-Z][\x20-\x7e]*[.?!]$/, text);
    }
  }
});

test("Schlüsselwörter: eins bis drei, sie stehen im Satz und in jeder Fassung", () => {
  for (const item of allItems) {
    assert.ok(item.keywords.length >= 1 && item.keywords.length <= 3, item.id);
    for (const keyword of item.keywords) {
      for (const text of textsOf(item)) {
        assert.ok(hasKeyword(text, keyword), item.id + ": " + keyword + " fehlt in " + text);
      }
    }
  }
});

test("Hören: genau eine Antwort passt, mindestens zwei nicht, jede mit Bedeutung und Quelle", () => {
  for (const item of allItems.filter((entry) => entry.part === "listening")) {
    assert.equal(item.options.filter((option) => option.fits === true).length, 1, item.id);
    const wrong = item.options.filter((option) => option.fits !== true);
    assert.ok(wrong.length >= 2, item.id);
    for (const option of wrong) {
      assert.ok(option.whyDe, item.id);
    }
    for (const option of item.options) {
      assert.ok(option.meaningDe && option.source, item.id);
    }
  }
});

test("Quellen: nur bekannte Einträge, immer mit Stelle, der Referenzrahmen genau einmal", () => {
  const known = new Set(sources.sources.map((source) => source.id));
  for (const item of allItems) {
    for (const source of [item.source, ...(item.options ?? []).map((option) => option.source)]) {
      assert.ok(known.has(source.ref), item.id + ": " + source.ref);
      assert.ok(source.locator, item.id);
    }
  }
  assert.equal(sources.sources.filter((source) => source.id === "cefr-cv").length, 1);
});

test("Deskriptoren: Skala und Stufe passen zur Aufgabe, der Sprechteil nutzt Phonological control", () => {
  for (const item of allItems) {
    assert.equal(item.descriptor.level, item.level, item.id);
    assert.ok(item.descriptor.scale && item.descriptor.summaryDe, item.id);
    if (item.part === "speaking") {
      assert.equal(item.descriptor.scale, "Phonological control", item.id);
    }
  }
});

test("Deskriptoren: die Seitenzahl ist selbst gelesen", () => {
  const pages = {
    listening: { A1: 73, A2: 73, B1: 73, B2: 73 },
    writing: { A1: 178, A2: 178, B1: 178, B2: 178 },
    speaking: { A1: 135, A2: 135, B1: 134, B2: 134 },
  };
  for (const item of allItems) {
    assert.equal(item.descriptor.page, pages[item.part][item.level], item.id);
  }
});

test("Schreiben: Satz und Fassungen zählen als richtig, ein Tippfehler auch, Unsinn nicht", () => {
  for (const item of allItems.filter((entry) => entry.part === "writing")) {
    for (const text of textsOf(item)) {
      assert.equal(matchTyped(item, text).outcome, "correct", item.id + ": " + text);
      assert.equal(answerFromTyping(item, text), "correct", item.id);
    }
    const longest = [...item.en.replace(/[.?!]$/, "").split(" ")].sort((a, b) => b.length - a.length)[0];
    const typo = item.en.replace(longest, longest.slice(0, -1) + "x");
    assert.notEqual(matchTyped(item, typo).outcome, "wrong", item.id + ": " + typo);
    assert.equal(answerFromTyping(item, typo), "correct", item.id + ": " + typo);
    assert.equal(answerFromTyping(item, "Banana."), "wrong", item.id);
  }
});

test("Sprechen: Satz und Fassungen werden verstanden, Unsinn nicht", () => {
  for (const item of allItems.filter((entry) => entry.part === "speaking")) {
    const stage = item.type === "repeat" ? "a" : "b";
    for (const text of textsOf(item)) {
      assert.equal(matchSpoken(item, text, { stage }).outcome, "understood", item.id + ": " + text);
    }
    assert.equal(matchSpoken(item, "banana", { stage }).outcome, "notUnderstood", item.id);
  }
});

for (const form of forms) {
  test("Fassung " + form.id + ": alles richtig ergibt B2, alles falsch A1 mit belowA1", () => {
    const best = scorePlacement(form, answersWhere(form, () => "correct"));
    assert.equal(best.overall, "B2");
    const worst = scorePlacement(form, answersWhere(form, () => "wrong"));
    assert.equal(worst.overall, "A1");
    for (const part of ["speaking", "listening", "writing"]) {
      assert.equal(best.parts[part].level, "B2");
      assert.equal(best.parts[part].belowA1, false);
      assert.equal(worst.parts[part].level, "A1");
      assert.equal(worst.parts[part].belowA1, true);
    }
  });

  test("Fassung " + form.id + ": richtig bis zu einer Stufe ergibt genau diese Stufe", () => {
    for (const level of LEVELS) {
      const result = scorePlacement(form, answersWhere(form, passUpTo(level)));
      assert.equal(result.overall, level);
      for (const part of ["speaking", "listening", "writing"]) {
        assert.equal(result.parts[part].level, level);
      }
    }
  });

  test("Fassung " + form.id + ": die Hälfte einer Stufe trägt die Stufe darüber", () => {
    const listeningA2 = form.items.filter((item) => item.part === "listening" && item.level === "A2")[0].id;
    const answers = answersWhere(form, (item) => (item.level === "B2" || item.id === listeningA2 ? "wrong" : "correct"));
    assert.equal(scorePlacement(form, answers).parts.listening.level, "B1");
  });

  test("Fassung " + form.id + ": nicht gemessenes Sprechen zählt nie als falsch und fällt aus der Gesamtstufe", () => {
    const answers = answersWhere(form, (item) => {
      if (item.part === "speaking") {
        return "notMeasured";
      }
      return item.part === "listening" ? "correct" : "wrong";
    });
    const result = scorePlacement(form, answers);
    assert.equal(result.parts.speaking.measured, false);
    assert.equal(result.parts.speaking.level, null);
    assert.equal(result.parts.listening.level, "B2");
    assert.equal(result.overall, "B1"); // (3 mal 3 + 2 mal 0) durch 5, also 1,8, gerundet Stufe 2.
    assert.ok(result.gaps.some((line) => line.includes("nicht gemessen")));
  });

  test("Fassung " + form.id + ": Sprechen wiegt am meisten", () => {
    const answers = answersWhere(form, (item) => (item.part === "speaking" ? "correct" : "wrong"));
    assert.equal(scorePlacement(form, answers).overall, "B1"); // 5 mal 3 durch 10, also 1,5, gerundet Stufe 2.
  });

  test("Fassung " + form.id + ": Stärken und Lücken sind Sätze und der Lernplan enthält jeden Abschnitt", () => {
    const result = scorePlacement(form, answersWhere(form, passUpTo("A2")));
    assert.ok(result.strengths.length === 3 && result.gaps.length === 3);
    for (const line of [...result.strengths, ...result.gaps]) {
      assert.match(line, /\)\.$/);
    }
    const plan = buildPlan(result, content);
    assert.deepEqual([...plan.order].sort(), content.sections().map((section) => section.id).sort());
    assert.ok(plan.noteDe);
  });
}

test("Beide Fassungen werten dasselbe Muster gleich", () => {
  const position = (form, item) => form.items.filter((entry) => entry.part === item.part && entry.level === item.level).indexOf(item);
  const [a, b] = forms.map((form) => scorePlacement(form, answersWhere(form, (item) => (position(form, item) === 0 ? "correct" : "wrong"))));
  for (const part of ["speaking", "listening", "writing"]) {
    assert.equal(a.parts[part].level, b.parts[part].level);
  }
  assert.equal(a.overall, b.overall);
});

test("Fassung: A beim ersten Mal, danach im Wechsel", () => {
  assert.equal(chooseForm([]), "A");
  assert.equal(chooseForm([{ form: "A" }]), "B");
  assert.equal(chooseForm([{ form: "A" }, { form: "B" }]), "A");
});

// ---------- Sitzung ----------

const newSession = (form = forms[0]) =>
  createPlacementSession({ form: createFormSnapshot(form, resolve, noShuffle), appVersion: "1" });

test("Schnappschuss: Hören, Schreiben, Sprechen, Quellen aufgelöst, übersteht das Speichern, Rohdaten bleiben", () => {
  const before = JSON.stringify(forms[0]);
  const snapshot = createFormSnapshot(forms[0], resolve, noShuffle);
  assert.deepEqual(
    [...new Set(snapshot.items.map((item) => item.part))],
    ["listening", "writing", "speaking"],
  );
  for (const item of snapshot.items) {
    assert.ok(item.source.title && item.source.url && item.source.locator, item.id);
    assert.equal(item.prompt, null);
    for (const option of item.options ?? []) {
      assert.ok(option.source.title && option.source.locator, item.id);
    }
  }
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
  assert.equal(JSON.stringify(forms[0]), before);
  assert.equal(scorePlacement(snapshot, answersWhere(forms[0], passUpTo("A2"))).overall, "A2");
});

test("Schnappschuss: Die Antworten werden gemischt, damit die passende nicht immer oben steht", () => {
  const firsts = new Set();
  let seed = 0;
  const rng = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let round = 0; round < 20; round += 1) {
    const item = createFormSnapshot(forms[0], resolve, rng).items[0];
    firsts.add(item.options.findIndex((option) => option.fits));
    assert.equal(item.options.length, forms[0].items.find((entry) => entry.id === item.id).options.length);
  }
  assert.ok(firsts.size > 1);
});

test("Sitzung: passt nur zur eigenen Art und Version", () => {
  const session = newSession();
  assert.equal(sessionUsable(session, "1"), true);
  assert.equal(sessionUsable(session, "2"), false);
  assert.equal(sessionUsable({ ...session, kind: "speech" }, "1"), false);
  assert.equal(sessionUsable({ ...session, index: 99 }, "1"), false);
  assert.equal(sessionUsable(null, "1"), false);
});

test("Sitzung: Jede Aufgabe zählt genau einmal, nur notMeasured darf noch ersetzt werden", () => {
  const session = newSession();
  assert.equal(recordAnswer(session, "x", "correct"), true);
  assert.equal(recordAnswer(session, "x", "wrong"), false);
  assert.equal(session.answers.x, "correct");
  assert.equal(recordAnswer(session, "y", "notMeasured"), true);
  assert.equal(recordAnswer(session, "y", "wrong"), true);
  assert.equal(session.answers.y, "wrong");
});

test("Sitzung: Sprechen wertet understood als richtig, partly und notUnderstood als falsch, notMeasured nie", () => {
  const expected = { understood: "correct", partly: "wrong", notUnderstood: "wrong", notMeasured: "notMeasured" };
  for (const [outcome, answer] of Object.entries(expected)) {
    const session = newSession();
    session.result = { outcome };
    recordSpeech(session, { id: "z" });
    assert.equal(session.answers.z, answer);
  }
  const session = newSession();
  assert.equal(recordSpeech(session, { id: "z" }), false);
  assert.deepEqual(session.answers, {});
});

test("Sitzung: Nach einem Ausfall zählt der nächste Versuch, ein Ergebnis bleibt nach dem Neuladen gleich", () => {
  const session = newSession();
  const item = { id: "z" };
  session.result = { outcome: "notMeasured" };
  recordSpeech(session, item);
  session.result = { outcome: "understood" };
  recordSpeech(session, item);
  assert.equal(session.answers.z, "correct");
  session.result = { outcome: "partly" };
  assert.equal(recordSpeech(session, item), false);
  assert.equal(session.answers.z, "correct");
});

test("Sitzung: Der Weitergang setzt den Sprechschritt zurück und zeigt am Ende keine Aufgabe mehr", () => {
  const session = newSession();
  const first = currentItem(session);
  session.step = "failed";
  session.result = { outcome: "notMeasured" };
  advance(session);
  assert.notEqual(currentItem(session), first);
  assert.equal(session.step, null);
  assert.equal(session.result, null);
  session.index = session.queue.length;
  assert.equal(currentItem(session), null);
});

test("Ohne Erkennung: Der ganze Sprechteil zählt als notMeasured, die übrigen Antworten bleiben", () => {
  assert.equal(isSpeechAvailable(), false); // In Node gibt es keine Erkennung.
  const session = newSession();
  for (const item of session.form.items.filter((entry) => entry.part !== "speaking")) {
    recordAnswer(session, item.id, "correct");
    advance(session);
  }
  assert.equal(currentItem(session).part, "speaking");
  skipRemainingSpeaking(session);
  assert.equal(currentItem(session), null);
  session.attemptAt = "2026-11-07T10:00:00.000Z";
  const attempt = attemptFrom(session);
  assert.equal(attempt.parts.speaking.measured, false);
  assert.equal(attempt.parts.listening.level, "B2");
  assert.equal(attempt.overall, "B2");
  assert.equal(speakingOpen(attempt), true);
  assert.equal(Object.values(attempt.answers).filter((answer) => answer === "notMeasured").length, 8);
});

test("Wiederholung: nur die nicht gemessenen Sprechaufgaben, derselbe Versuch wird ersetzt", () => {
  const state = createState(new Date("2026-11-07T10:00:00Z"));
  const session = newSession();
  const speaking = session.form.items.filter((item) => item.part === "speaking");
  for (const item of session.form.items) {
    recordAnswer(session, item.id, item.part === "speaking" ? "notMeasured" : "correct");
  }
  recordAnswer(session, speaking[0].id, "correct");
  session.attemptAt = "2026-11-07T10:00:00.000Z";
  const attempt = attemptFrom(session);
  storeAttempt(state, attempt, { order: [], noteDe: "erst" });
  assert.equal(attempt.parts.speaking.measured, true);
  assert.equal(speakingOpen(attempt), true);

  const retake = createRetakeSession({ form: session.form, attempt, appVersion: "1" });
  assert.equal(retake.queue.length, 7);
  assert.ok(!retake.queue.includes(speaking[0].id));
  assert.equal(retake.retake, true);
  assert.equal(currentItem(retake).part, "speaking");

  for (const id of retake.queue) {
    assert.equal(recordAnswer(retake, id, "correct"), true);
  }
  const again = attemptFrom(retake);
  assert.equal(again.at, attempt.at);
  assert.equal(again.parts.speaking.level, "B2");
  assert.equal(speakingOpen(again), false);
  storeAttempt(state, again, { order: [], noteDe: "neu" });
  assert.equal(state.placement.attempts.length, 1);
  assert.equal(state.placement.attempts[0].parts.speaking.level, "B2");
  assert.equal(state.placement.plan.noteDe, "neu");
});

test("Ergebnis: Ein eingelesener Stand mit nur einem Teil lässt sich öffnen", () => {
  const backup = JSON.parse(readFileSync(new URL("./fixtures/backup-v1.json", import.meta.url), "utf8"));
  const [attempt] = backup.state.placement.attempts;
  assert.deepEqual(Object.keys(attempt.parts), ["speaking"]);
  assert.deepEqual(resultRows(attempt), [
    { labelDe: "Hören", text: "nicht gemessen" },
    { labelDe: "Schreiben", text: "nicht gemessen" },
    { labelDe: "Sprechen", text: "A2" },
  ]);
  assert.equal(overallText(attempt), "Stufe A2");
  assert.equal(speakingOpen(attempt), false);
  for (const reduced of [{}, { parts: null, overall: null }, { parts: {}, overall: "A1" }]) {
    assert.equal(resultRows(reduced).every((row) => row.text === "nicht gemessen"), true);
  }
  assert.equal(overallText({}), "Noch keine Stufe");
  assert.equal(overallText({ parts: {}, overall: "A1" }), "Stufe A1");
});

test("Ergebnis: Liegen alle gemessenen Teile unter A1, steht das auch oben", () => {
  const wrong = scorePlacement(forms[0], answersWhere(forms[0], () => "wrong"));
  assert.equal(wrong.overall, "A1");
  assert.equal(overallText(wrong), "Unter A1");
  assert.ok(resultRows(wrong).every((row) => row.text === "unter A1"));

  const noSpeaking = scorePlacement(forms[0], answersWhere(forms[0], (item) => (item.part === "speaking" ? "notMeasured" : "wrong")));
  assert.equal(overallText(noSpeaking), "Unter A1", "Ein nicht gemessener Teil ändert daran nichts");
  assert.equal(resultRows(noSpeaking).find((row) => row.labelDe === "Sprechen").text, "nicht gemessen");

  const mixed = scorePlacement(forms[0], answersWhere(forms[0], (item) => (item.part === "speaking" && item.level === "A1" ? "correct" : "wrong")));
  assert.equal(overallText(mixed), "Stufe A1", "Ein Teil auf A1 reicht");
});

const itemById = (id) => allItems.find((item) => item.id === id);

test("Hören: Die Patientin spricht sie direkt an, das misst die Skala Understanding an interlocutor", () => {
  for (const item of allItems.filter((entry) => entry.part === "listening")) {
    assert.equal(item.descriptor.scale, "Understanding an interlocutor", item.id);
  }
});

test("Schreiben auf A1: Die naheliegenden richtigen Antworten zählen, falsche nicht", () => {
  for (const text of ["Please lie down.", "Lie down, please.", "Lie down here.", "Could you lie down here?", "Could you lie down, please?", "Can you lie down, please?"]) {
    assert.equal(answerFromTyping(itemById("pl.b.wr01"), text), "correct", text);
  }
  for (const text of ["Take a seat.", "Take a seat, please.", "Have a seat.", "Have a seat, please.", "Sit down.", "Please sit."]) {
    assert.equal(answerFromTyping(itemById("pl.a.wr01"), text), "correct", text);
  }
  for (const text of ["Please sit here.", "Please stand up", "Please take a walk", "Please here down lie"]) {
    assert.equal(answerFromTyping(itemById("pl.b.wr01"), text), "wrong", text);
  }
  assert.equal(answerFromTyping(itemById("pl.a.wr01"), "Do not sit down."), "wrong", "Der gegenteilige Satz zählt nicht");
});

for (const [formIndex, id, text] of [[0, "pl.a.wr01", "Take a seat."], [1, "pl.b.wr01", "Please lie down."]]) {
  test("Ergebnis: Alles richtig mit " + text + " auf A1 ergibt B2, keine Lücke und nicht den Plan für Anfänger", () => {
    const form = forms[formIndex];
    const answers = answersWhere(form, () => "correct");
    answers[id] = answerFromTyping(itemById(id), text);
    const result = scorePlacement(form, answers);
    assert.equal(result.parts.writing.level, "B2");
    assert.equal(result.overall, "B2");
    assert.notEqual(buildPlan(result, content).noteDe.startsWith("Du startest mit Satzbau"), true);
  });
}

test("Schreiben: Auch andere richtige Formen zählen, britisch wie amerikanisch", () => {
  const accepted = {
    "pl.a.wr02": ["Do you have jewellery?", "Have you got any jewellery on?"],
    "pl.a.wr03": ["Did you ever have an MRI?", "Did you have an MRI before?"],
    "pl.b.wr03": ["Did you ever have problems with your kidneys?"],
    "pl.a.wr04": ["You can eat and drink normally if you have not been told otherwise.", "If you have not been told anything else, you can eat and drink as normal."],
    "pl.b.wr04": ["Even if you feel fine, you should stay here for a while after the injection."],
  };
  for (const [id, texts] of Object.entries(accepted)) {
    for (const text of texts) {
      assert.equal(answerFromTyping(itemById(id), text), "correct", id + ": " + text);
    }
  }
});

test("Sprechen auf B2: Die wörtliche Übersetzung der Vorgabe zählt", () => {
  const understood = {
    "pl.a.sp08": ["Once the report is there, your doctor will go through it with you."],
    "pl.b.sp08": ["If you don't feel well, we can stop at any time.", "If you don't feel well, we can stop the scan at any time.", "If you feel bad, we can stop the scan whenever you want."],
    "pl.b.sp06": ["Have you ever been operated on?"],
    "pl.a.sp04": ["Do you have an allergy?"],
  };
  for (const [id, texts] of Object.entries(understood)) {
    for (const text of texts) {
      assert.equal(matchSpoken(itemById(id), text, { stage: "b" }).outcome, "understood", id + ": " + text);
    }
  }
  assert.notEqual(matchSpoken(itemById("pl.b.sp08"), "If you feel unwell, we can start the scan.", { stage: "b" }).outcome, "understood");
});

test("Ergebnis: Beim Sprechen steht nichts über die Aussprache, beim Schreiben die Grenze des Tests", () => {
  for (const form of forms) {
    for (const level of LEVELS) {
      const result = scorePlacement(form, answersWhere(form, passUpTo(level)));
      for (const line of [...result.strengths, ...result.gaps]) {
        if (line.startsWith("Sprechen")) {
          assert.doesNotMatch(line, /Satzmelodie|Akzent|meist klar|Mühe/, line);
          assert.match(line, /misst die App nicht/, line);
        }
      }
    }
    const top = scorePlacement(form, answersWhere(form, passUpTo("B2")));
    assert.ok(top.strengths.some((line) => line.startsWith("Schreiben") && line.includes("längere Texte prüft der Test nicht")));
    assert.ok(top.strengths.some((line) => line.startsWith("Hören") && line.includes("was zu dir gesagt wird")));
  }
});

test("Ergebnis: Die Liste der Sätze nennt jede Aufgabe mit Bedeutung und aufgelöster Quelle", () => {
  for (const form of forms) {
    const snapshot = createFormSnapshot(form, resolve, noShuffle);
    const groups = testSentences(snapshot);
    assert.deepEqual(groups.map((group) => group.labelDe), ["Hören", "Schreiben", "Sprechen"]);
    const listed = groups.flatMap((group) => group.items);
    assert.deepEqual(listed.map((item) => item.id).sort(), form.items.map((item) => item.id).sort());
    for (const item of listed) {
      assert.ok(item.en && item.meaningDe, item.id);
      assert.ok(item.source.title && item.source.url && item.source.locator, item.id);
    }
  }
});

test("Ergebnis: Die Quelle zur Skala nennt die Seiten", () => {
  const scale = resolve(SCALE_SOURCE);
  assert.equal(scale.id, "cefr-cv");
  for (const page of ["S. 73", "S. 134", "S. 178"]) {
    assert.ok(scale.locator.includes(page), page);
  }
});

test("Hören: Die passende Antwort ist nicht an der Form zu erkennen", () => {
  for (const form of forms) {
    const listening = form.items.filter((item) => item.part === "listening");
    const longest = listening.filter((item) => {
      const lengths = item.options.map((option) => option.en.length);
      return item.options.find((option) => option.fits).en.length === Math.max(...lengths);
    });
    assert.ok(longest.length <= 2, form.id + ": " + longest.map((item) => item.id).join(", "));
  }
  for (const id of ["pl.b.li06", "pl.b.li07", "pl.b.li08"]) {
    assert.ok(itemById(id).options.some((option) => option.fits !== true && option.en.startsWith("I will ask")), id);
  }
});

test("Schreiben: Rückwärts getippte Sätze zählen als falsch, ein versetztes please zählt", () => {
  for (const item of allItems.filter((entry) => entry.part === "writing")) {
    const reversed = item.en.replace(/[.?!]$/, "").split(" ").reverse().join(" ");
    assert.equal(answerFromTyping(item, reversed), "wrong", item.id + ": " + reversed);
  }
  const item = allItems.find((entry) => entry.id === "pl.a.wr01");
  assert.equal(item.en, "Please sit down.");
  assert.equal(answerFromTyping(item, "Sit down, please."), "correct");
});

test("Ergebnis: Ein neuer Versuch kommt dazu, die Lerneinheiten bleiben unberührt", () => {
  const state = createState(new Date("2026-11-07T10:00:00Z"));
  state.units["sb.questions.s01"] = { box: 3 };
  const before = JSON.stringify(state.units);
  for (const at of ["2026-11-07T10:00:00.000Z", "2026-12-01T10:00:00.000Z", "2026-12-01T10:00:00.000Z"]) {
    const session = newSession();
    session.attemptAt = at;
    storeAttempt(state, attemptFrom(session), { order: [], noteDe: "Plan" });
  }
  assert.equal(state.placement.attempts.length, 2);
  assert.equal(JSON.stringify(state.units), before);
});
