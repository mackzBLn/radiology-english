/*
 * Ansichten mit einem kleinen nachgebauten DOM, nur so viel, wie sie brauchen. Das echte Zeichnen prüft der Lauf im Browser,
 * hier geht es um das, was nie wieder passieren darf: ein Freitextfeld ohne Hinweis, ein Ergebnis, das sich nicht öffnen lässt,
 * und die Verdrahtung, die den Lernstand trifft: speichern, Sitzung leeren, neu laden, doppelte Tipps.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { loadContent } from "../js/core/content.js";
import { createSpeechSession } from "../js/core/speak-flow.js";
import { createState, newUnit, unitState } from "../js/core/state.js";
import { createRecognizer } from "../js/speech/recognizer.js";
import { infoButton } from "../js/ui/components.js";
import { renderSpeakStep } from "../js/ui/speak-step.js";
import { replaceLearningState } from "../js/ui/views/backup.js";
import { render as renderHome } from "../js/ui/views/home.js";
import { createFormSnapshot, createPlacementSession, recordAnswer, render as renderPlacement } from "../js/ui/views/placement.js";
import { speechLogLines } from "../js/ui/views/settings.js";
import { render as renderSpeak } from "../js/ui/views/speak.js";
import { render as renderTrain } from "../js/ui/views/train.js";

const CONTENT = await loadContent((name) => JSON.parse(readFileSync(new URL("../daten/" + name + ".json", import.meta.url), "utf8")));
const TODAY = "2026-11-07";
const NOW = new Date("2026-11-07T08:00:00.000Z");
const HINT = "Keine Patientendaten eingeben";

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName;
    this.nodeType = 1;
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.style = {};
    this.dataset = {};
    this.className = "";
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this.isConnected = true;
    const node = this;
    this.classList = {
      add: (name) => void (node.className += " " + name),
      remove: () => {},
      contains: (name) => node.className.split(" ").includes(name),
      replace: () => {},
      toggle: () => {},
    };
  }

  append(...kids) {
    this.children.push(...kids);
    for (const kid of kids) {
      if (typeof kid === "object") {
        kid.parent = this;
      }
    }
  }

  replaceChildren(...kids) {
    this.children = [];
    this.append(...kids);
  }

  remove() {}

  blur() {}

  scrollIntoView() {}

  showModal() {}

  close() {
    this.fire("close");
  }

  get firstChild() {
    return this.children[0] ?? null;
  }

  after(...nodes) {
    const siblings = this.parent.children;
    siblings.splice(siblings.indexOf(this) + 1, 0, ...nodes);
    for (const node of nodes) {
      node.parent = this.parent;
    }
  }

  querySelector(selector) {
    return this.find((node) => selector.startsWith(".") && node.className.split(" ").includes(selector.slice(1)));
  }

  closest() {
    return null;
  }

  setAttribute(name, value) {
    this.attrs[name] = value;
  }

  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener);
  }

  fire(type) {
    for (const listener of this.listeners[type] ?? []) {
      listener({ preventDefault() {} });
    }
  }

  get childElementCount() {
    return this.children.filter((kid) => typeof kid === "object").length;
  }

  get textContent() {
    return this.children.map((kid) => (typeof kid === "object" ? kid.textContent : String(kid))).join(" ");
  }

  set textContent(value) {
    this.children = [String(value)];
  }

  // Alle Knoten darunter, zuerst dieser.
  *walk() {
    yield this;
    for (const kid of this.children) {
      if (typeof kid === "object") {
        yield* kid.walk();
      }
    }
  }

  find(test) {
    for (const node of this.walk()) {
      if (test(node)) {
        return node;
      }
    }
    return null;
  }

  button(label) {
    return this.find((node) => node.tagName === "button" && node.textContent.trim() === label);
  }
}

let clock = 0;
const saved = {};
const FORMS = JSON.parse(readFileSync(new URL("../daten/einstufung.json", import.meta.url), "utf8")).forms;

const settle = async () => {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

// Merkt sich die Sitzung wie der echte Speicher, als Text: Was im Speicher der Seite liegt, zählt nicht.
function sessionStore(initial = null) {
  return {
    session: initial === null ? null : JSON.parse(JSON.stringify(initial)),
    cleared: 0,
    loadSession() {
      return this.session;
    },
    saveSession(value) {
      this.session = JSON.parse(JSON.stringify(value));
    },
    clearSession() {
      this.session = null;
      this.cleared += 1;
    },
  };
}

// Eine offene Einstufung bei Aufgabe index, alles davor richtig. resumeOnLoad: Sie geht ohne Rückfrage weiter.
function openTest(index) {
  const form = createFormSnapshot(FORMS[0], (ref) => CONTENT.source(ref), () => 0.999);
  const session = createPlacementSession({ form, appVersion: "test" });
  for (const id of session.queue.slice(0, index)) {
    recordAnswer(session, id, "correct");
  }
  session.index = index;
  session.resumeOnLoad = true;
  return session;
}

function speakingTts(spoken = []) {
  return {
    spoken,
    cancel() {},
    speak(text, { onstart, onend } = {}) {
      spoken.push(text);
      onstart?.();
      onend?.();
    },
  };
}

function contextOf(state) {
  return {
    state,
    getContent: async () => CONTENT,
    today: () => TODAY,
    now: () => NOW,
    save() {},
    navigate() {},
    back() {},
    version: "test",
    store: { loadSession: () => null, saveSession() {}, clearSession() {} },
    tts: { cancel() {}, speak() {} },
  };
}

function tap(node) {
  clock += 1000; // Die Sperre gegen doppelte Tipps läuft ab.
  node.fire("click");
}

// Die Attrappen gelten nur für diese Tests: node --test test/ lädt alle Dateien in einen Prozess.
describe("Ansichten mit nachgebautem DOM", () => {
  before(() => {
    for (const name of ["document", "window", "performance", "scrollTo", "location", "webkitSpeechRecognition", "fetch"]) {
      saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    }
    const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    define("document", { createElement: (tag) => new FakeNode(tag), addEventListener() {}, removeEventListener() {}, hidden: false, body: new FakeNode("body") });
    define("window", { scrollTo() {} });
    define("scrollTo", () => {});
    define("performance", { now: () => clock });
    define("location", { reload() {} });
  });

  after(() => {
    for (const [name, descriptor] of Object.entries(saved)) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        delete globalThis[name];
      }
    }
  });

  it("Bahn: Jedes Tippfeld trägt den Hinweis, in jeder Übung, direkt beim Feld", async () => {
    const ids = ["mr.safety.s01", "mr.safety.s02", "mr.safety.s05"];
    const state = createState(NOW);
    for (const id of ids) {
      state.units[id] = { ...newUnit(), box: 3, due: TODAY, seen: 3, lastResult: "ok" };
    }
    const container = new FakeNode("div");
    const stop = await renderTrain(container, contextOf(state), { focus: "mr.safety" });
    const seen = [];
    for (let round = 0; round < ids.length; round += 1) {
      const input = container.find((node) => node.tagName === "input");
      assert.ok(input, "Übung " + round + " hat ein Tippfeld");
      const form = container.find((node) => node.tagName === "form");
      assert.ok(form.textContent.includes(HINT), "Übung " + round + " ohne Hinweis");
      assert.ok(form.children.indexOf(input) >= 0);
      const situation = container.find((node) => node.className === "situation-de").textContent;
      const unit = ids.map((id) => CONTENT.unit(id)).find((item) => item.situationDe === situation);
      seen.push(unit.id);
      input.value = unit.en;
      input.fire("input");
      tap(container.button("Prüfen"));
      tap(container.button("Weiter"));
    }
    assert.deepEqual([...seen].sort(), [...ids].sort());
    stop();
  });

  it("Bahn: Fehlt getippt ein not, zählt das als falsch und sagt warum", async () => {
    const unit = CONTENT.allUnits().find((item) => item.type === "sentence" && /\bnot\b/.test(item.en) && item.variants.every((text) => /\bnot\b|n't|never/.test(text)));
    const state = createState(NOW);
    state.units[unit.id] = { ...newUnit(), box: 3, due: TODAY, seen: 3, lastResult: "ok" };
    const container = new FakeNode("div");
    const stop = await renderTrain(container, contextOf(state), { focus: unit.sectionId });
    const input = container.find((node) => node.tagName === "input");
    input.value = unit.en.replace(/\bnot /, "");
    input.fire("input");
    tap(container.button("Prüfen"));
    assert.ok(container.textContent.includes("Achte auf „not“"), container.textContent);
    assert.equal(state.units[unit.id].lastResult, "wrong");
    assert.equal(state.units[unit.id].box, 0);
    stop();
  });

  it("Einstufung: Das Ergebnis eines eingelesenen Stands mit nur einem Teil lässt sich öffnen", async () => {
    const { state } = JSON.parse(readFileSync(new URL("./fixtures/backup-v1.json", import.meta.url), "utf8"));
    assert.deepEqual(Object.keys(state.placement.attempts[0].parts), ["speaking"]);
    const container = new FakeNode("div");
    await renderPlacement(container, contextOf(state));
    container.button("Ergebnis ansehen").fire("click");
    await new Promise((resolve) => setImmediate(resolve));
    const text = container.textContent;
    assert.ok(text.includes("Dein Ergebnis"), text);
    assert.ok(text.includes("Stufe A2"), text);
    assert.ok(text.includes("nicht gemessen"), text);
  });

  it("Einstufung: Fehlen auch Stärken und Lücken, lässt sich das Ergebnis trotzdem öffnen", async () => {
    const { state } = JSON.parse(readFileSync(new URL("./fixtures/backup-v1.json", import.meta.url), "utf8"));
    delete state.placement.attempts[0].strengths;
    delete state.placement.attempts[0].gaps;
    const container = new FakeNode("div");
    await renderPlacement(container, contextOf(state));
    container.button("Ergebnis ansehen").fire("click");
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(container.textContent.includes("Dein Ergebnis"));
    assert.equal(container.textContent.includes("Das kannst du schon"), false);
  });

  // ----- Einstufung -----

  it("Einstufung: Das Ergebnis zeigt die Sätze aus dem Test eingeklappt, mit Bedeutung und Quelle", async () => {
    const { state } = JSON.parse(readFileSync(new URL("./fixtures/backup-v1.json", import.meta.url), "utf8"));
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ forms: FORMS }) });
    const container = new FakeNode("div");
    await renderPlacement(container, contextOf(state));
    container.button("Ergebnis ansehen").fire("click");
    await settle();
    const block = container.find((node) => node.tagName === "details" && node.textContent.includes("Die Sätze aus dem Test"));
    assert.ok(block, container.textContent);
    for (const item of FORMS[0].items) {
      assert.ok(block.textContent.includes(item.en), item.id);
      assert.ok(block.textContent.includes(item.meaningDe), item.id);
    }
    const infos = [...block.walk()].filter((node) => node.tagName === "button" && node.className.includes("btn-info"));
    assert.equal(infos.length, FORMS[0].items.length);
  });

  it("Einstufung: Ein Versuch aus einer älteren Version zeigt den neuen Wortlaut, ohne Aussage über die Aussprache", async () => {
    const state = createState(NOW);
    state.placement.attempts = [
      {
        form: "A",
        at: NOW.toISOString(),
        overall: "B2",
        parts: { speaking: { measured: true, level: "B2", belowA1: false } },
        strengths: ["Sprechen: Du schaffst Stufe B2 (Betonung, Satzmelodie und Laute meist klar)."],
        gaps: [],
        answers: Object.fromEntries(FORMS[0].items.map((item) => [item.id, "correct"])),
      },
    ];
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ forms: FORMS }) });
    const container = new FakeNode("div");
    await renderPlacement(container, contextOf(state));
    container.button("Ergebnis ansehen").fire("click");
    await settle();
    assert.ok(container.textContent.includes("Dein Ergebnis"));
    assert.equal(container.textContent.includes("Satzmelodie"), false);
    assert.ok(container.textContent.includes("misst die App nicht"));
  });

  it("Einstufung: Fehlt die Datei, entfällt nur der Block mit den Sätzen", async () => {
    const { state } = JSON.parse(readFileSync(new URL("./fixtures/backup-v1.json", import.meta.url), "utf8"));
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    const container = new FakeNode("div");
    await renderPlacement(container, contextOf(state));
    container.button("Ergebnis ansehen").fire("click");
    await settle();
    assert.ok(container.textContent.includes("Dein Ergebnis"));
    assert.equal(container.textContent.includes("Die Sätze aus dem Test"), false);
  });

  it("Einstufung: Ein zweiter Tipp direkt danach wertet die nächste Aufgabe nicht", async () => {
    const store = sessionStore(openTest(7));
    const container = new FakeNode("div");
    await renderPlacement(container, { ...contextOf(createState(NOW)), store, tts: speakingTts() });
    container.button("Anhören").fire("click");
    const listening = store.session.queue[7];
    const writing = store.session.queue[8];
    tap(container.button("Weiß ich nicht"));
    assert.equal(store.session.index, 8);
    assert.equal(store.session.answers[listening], "wrong");
    container.button("Weiß ich nicht").fire("click"); // Dieselbe Stelle, 0 ms später
    assert.equal(store.session.index, 8, "Die nächste Aufgabe war noch gar nicht zu sehen");
    assert.equal(store.session.answers[writing], undefined);
    tap(container.button("Weiß ich nicht"));
    assert.equal(store.session.index, 9);
    assert.equal(store.session.answers[writing], "wrong");
  });

  it("Einstufung: Ein zweiter Tipp nach der letzten Schreibaufgabe lässt den Sprechteil nicht aus", async () => {
    const store = sessionStore(openTest(11));
    const container = new FakeNode("div");
    await renderPlacement(container, { ...contextOf(createState(NOW)), store, tts: speakingTts() });
    tap(container.button("Weiß ich nicht"));
    assert.equal(store.session.index, 12);
    container.button("Zum Ergebnis").fire("click");
    assert.equal(store.session.index, 12, "Der zweite Tipp zählt nicht");
    assert.ok(store.session !== null);
  });

  it("Einstufung: Ist der Speicher voll, überspringt der nächste Tipp keine Aufgabe", async () => {
    const store = sessionStore(openTest(8));
    const write = store.saveSession.bind(store);
    let full = false;
    store.saveSession = (value) => {
      if (full) {
        throw new DOMException("voll", "QuotaExceededError");
      }
      write(value);
    };
    const container = new FakeNode("div");
    await renderPlacement(container, { ...contextOf(createState(NOW)), store, tts: speakingTts() });
    const first = store.session.queue[8];
    const second = store.session.queue[9];
    full = true;
    assert.throws(() => tap(container.button("Weiß ich nicht")), { name: "QuotaExceededError" });
    full = false;
    tap(container.button("Weiß ich nicht"));
    assert.equal(store.session.index, 9);
    assert.equal(store.session.answers[first], "wrong");
    assert.equal(store.session.answers[second], undefined);
  });

  it("Einstufung: „Weiß ich nicht“ steht in der Karte, die Tastatur kann die Leiste verdecken. Der Hinweis liegt zwischen Feld und Knopf gegen Fehltipps", async () => {
    const store = sessionStore(openTest(8));
    const container = new FakeNode("div");
    await renderPlacement(container, { ...contextOf(createState(NOW)), store, tts: speakingTts() });
    const input = container.find((node) => node.tagName === "input");
    const siblings = input.parent.children;
    const dontKnow = siblings.indexOf(container.button("Weiß ich nicht"));
    const hint = siblings.findIndex((node) => node.textContent?.includes(HINT));
    assert.ok(siblings.indexOf(input) < hint);
    assert.ok(hint < dontKnow);
  });

  it("Einstufung: Das Ergebnis landet im Lernstand, die Sitzung wird geleert", async () => {
    const session = openTest(0);
    for (const id of session.queue) {
      recordAnswer(session, id, "correct");
    }
    session.index = session.queue.length;
    const store = sessionStore(session);
    const state = createState(NOW);
    let saves = 0;
    const container = new FakeNode("div");
    await renderPlacement(container, { ...contextOf(state), store, save: () => (saves += 1), tts: speakingTts() });
    await settle();
    assert.equal(saves, 1);
    assert.equal(state.placement.attempts.length, 1);
    assert.equal(state.placement.attempts[0].overall, "B2");
    assert.ok(state.placement.plan);
    assert.equal(store.session, null);
    assert.ok(container.textContent.includes("Dein Ergebnis"));
  });

  it("Einstufung: Der Vergleich nennt auch die Gesamtstufe unter A1", async () => {
    const below = { form: "A", at: "2026-11-01T08:00:00.000Z", overall: "A1", parts: { speaking: { measured: true, level: "A1", belowA1: true } } };
    const reached = { form: "B", at: "2026-11-07T08:00:00.000Z", overall: "A1", parts: { speaking: { measured: true, level: "A1", belowA1: false } } };
    const state = createState(NOW);
    state.placement.attempts = [below, reached];
    const container = new FakeNode("div");
    await renderPlacement(container, contextOf(state));
    container.button("Ergebnis ansehen").fire("click");
    await settle();
    const rows = container.find((node) => node.tagName === "dl" && node.textContent.includes("Gesamt"));
    assert.ok(rows, container.textContent);
    const gesamt = rows.children.findIndex((node) => node.textContent === "Gesamt");
    assert.equal(rows.children[gesamt + 1].textContent, "unter A1");
    assert.equal(rows.children[gesamt + 2].textContent, "A1");
  });

  // ----- Bahn -----

  it("Bahn: „Hinweis“ steht über dem Eingabefeld, „Prüfen“ unten", async () => {
    const state = createState(NOW);
    state.units["mr.safety.s01"] = { ...newUnit(), box: 3, due: TODAY, seen: 3, lastResult: "ok" };
    const container = new FakeNode("div");
    const stop = await renderTrain(container, contextOf(state), { focus: "mr.safety" });
    const form = container.find((node) => node.tagName === "form");
    const input = form.find((node) => node.tagName === "input");
    assert.ok(form.children.indexOf(form.button("Hinweis")) >= 0);
    assert.ok(form.children.indexOf(form.button("Hinweis")) < form.children.indexOf(input));
    const bar = container.find((node) => node.className === "bottom-bar");
    assert.ok(bar.button("Prüfen"));
    assert.equal(bar.button("Hinweis"), null);
    stop();
  });

  it("Bahn: Sie hört die Fassung des Tages, die Rückmeldung nennt sie und die anderen Antworten mit Quelle", async () => {
    const unit = CONTENT.unit("ge.changing.p04");
    const state = createState(NOW);
    state.units[unit.id] = { ...newUnit(), box: 1, due: TODAY, seen: 1, lastResult: "ok", lastAt: NOW.toISOString() };
    const spoken = [];
    const container = new FakeNode("div");
    const stop = await renderTrain(container, { ...contextOf(state), tts: speakingTts(spoken) }, { focus: unit.sectionId });
    tap(container.button("Anhören"));
    assert.deepEqual(spoken, [unit.variants[0]]);
    const fits = unit.reactions.find((reaction) => reaction.fits);
    tap(container.button(fits.en));
    const text = container.textContent;
    assert.ok(text.includes(unit.variants[0]), text);
    const block = container.find((node) => node.tagName === "details" && node.textContent.includes("Die anderen Antworten"));
    assert.ok(block, text);
    for (const reaction of unit.reactions.filter((item) => !item.fits)) {
      assert.ok(block.textContent.includes(reaction.en), reaction.en);
    }
    assert.equal([...block.walk()].filter((node) => node.tagName === "button" && node.className.includes("btn-info")).length, 2);
    stop();
  });

  it("Bahn: Die Uhr steht, solange die Seite verborgen ist", async () => {
    const { document: fakeDocument } = globalThis;
    const original = fakeDocument.addEventListener;
    let onVisibility = null;
    fakeDocument.addEventListener = (type, listener) => {
      if (type === "visibilitychange") {
        onVisibility = listener;
      }
    };
    try {
      const state = createState(NOW);
      state.units["mr.safety.s01"] = { ...newUnit(), box: 3, due: TODAY, seen: 3, lastResult: "ok" };
      let current = NOW.getTime();
      const container = new FakeNode("div");
      const stop = await renderTrain(container, { ...contextOf(state), now: () => new Date(current) }, { focus: "mr.safety" });
      current += 10000;
      fakeDocument.hidden = true;
      onVisibility();
      current += 600000;
      fakeDocument.hidden = false;
      onVisibility();
      const timer = container.find((node) => node.className === "timer");
      assert.equal(timer.textContent, "00:10", "Die zehn Minuten im Hintergrund zählen nicht");
      stop();
    } finally {
      fakeDocument.addEventListener = original;
      fakeDocument.hidden = false;
    }
  });

  it("Bahn: Auf der Rückmeldung liegt „Beenden“ unten neben „Weiter“", async () => {
    const state = createState(NOW);
    for (const id of ["mr.safety.s01", "mr.safety.s02"]) {
      state.units[id] = { ...newUnit(), box: 3, due: TODAY, seen: 3, lastResult: "ok" };
    }
    const container = new FakeNode("div");
    const stop = await renderTrain(container, contextOf(state), { focus: "mr.safety" });
    const input = container.find((node) => node.tagName === "input");
    input.value = "banana";
    input.fire("input");
    tap(container.button("Prüfen"));
    const bar = container.find((node) => node.className === "bottom-bar");
    assert.ok(bar.button("Weiter"));
    assert.ok(bar.button("Beenden"));
    stop();
  });

  // ----- Quelle -----

  it("Quelle: Was nur über die Suche zu lesen war, heißt nicht abgerufen", () => {
    const open = (source) => {
      globalThis.document.body = new FakeNode("body");
      infoButton(source).fire("click");
      return globalThis.document.body.textContent;
    };
    const searched = open({ title: "Wörterbuch", access: "search", retrieved: "2026-11-07", locator: "Eintrag seat", url: "quelle.html" });
    assert.ok(searched.includes("Über die Suche gelesen"), searched);
    assert.ok(searched.includes("07.11.2026"), searched);
    assert.equal(searched.includes("Abgerufen"), false, searched);
    assert.ok(open({ title: "Merkblatt", access: "direct", retrieved: "2026-11-07", url: "quelle.html" }).includes("Abgerufen"));
  });

  // ----- Startseite -----

  function homeContext(state, overrides = {}) {
    const worker = { checks: 0, applied: 0, ready: false };
    return {
      worker,
      ctx: {
        ...contextOf(state),
        worker: {
          isUpdateReady: () => worker.ready,
          onUpdateReady: () => () => {},
          checkForUpdate: () => (worker.checks += 1),
          applyUpdate: () => (worker.applied += 1),
        },
        ...overrides,
      },
    };
  }

  it("Startseite: Kommt die App an einem neuen Tag aus dem Hintergrund, zeichnet sie sich neu", async () => {
    const { document: fakeDocument } = globalThis;
    const original = fakeDocument.addEventListener;
    let onVisible = null;
    fakeDocument.addEventListener = (type, listener) => {
      if (type === "visibilitychange") {
        onVisible = listener;
      }
    };
    fakeDocument.visibilityState = "visible";
    try {
      const state = createState(NOW);
      state.placement.skippedAt = NOW.toISOString();
      let today = TODAY;
      const navigations = [];
      const { ctx, worker } = homeContext(state, { today: () => today, navigate: (hash) => navigations.push(hash) });
      const stop = await renderHome(new FakeNode("div"), ctx);
      onVisible();
      assert.deepEqual(navigations, [], "Derselbe Tag: nichts neu zeichnen");
      assert.equal(worker.checks, 2, "Einmal beim Zeichnen, einmal beim Zurückkommen");
      today = "2026-11-08";
      onVisible();
      assert.deepEqual(navigations, ["#/"]);
      stop();
    } finally {
      fakeDocument.addEventListener = original;
    }
  });

  it("Startseite: Sie sagt einmal, dass ein angefangener Test mit dem Update verloren ging", async () => {
    const state = createState(NOW);
    state.placement.skippedAt = NOW.toISOString();
    globalThis.document.visibilityState = "visible";
    const { ctx } = homeContext(state, { placementDiscarded: true });
    const first = new FakeNode("div");
    (await renderHome(first, ctx))();
    assert.ok(first.textContent.includes("ließ sich nach dem Update nicht fortsetzen"), first.textContent);
    const second = new FakeNode("div");
    (await renderHome(second, ctx))();
    assert.equal(second.textContent.includes("nach dem Update"), false);
  });

  it("Startseite: „Jetzt aktualisieren“ wechselt die Version, bei offenem Test erst nach Rückfrage", async () => {
    const state = createState(NOW);
    state.placement.skippedAt = NOW.toISOString();
    globalThis.document.visibilityState = "visible";
    globalThis.document.body = new FakeNode("body");

    const plain = homeContext(state);
    plain.worker.ready = true;
    const plainView = new FakeNode("div");
    (await renderHome(plainView, plain.ctx))();
    tap(plainView.button("Jetzt aktualisieren"));
    assert.equal(plain.worker.applied, 1);

    const open = homeContext(state, { store: sessionStore({ kind: "placement", appVersion: "test", queue: [], index: 0 }) });
    open.worker.ready = true;
    const openView = new FakeNode("div");
    (await renderHome(openView, open.ctx))();
    tap(openView.button("Jetzt aktualisieren"));
    assert.equal(open.worker.applied, 0, "Erst die Rückfrage");
    const confirm = globalThis.document.body.button("Trotzdem aktualisieren");
    assert.ok(confirm, globalThis.document.body.textContent);
    tap(confirm);
    assert.equal(open.worker.applied, 1);
  });

  // ----- Sichern -----

  it("Sichern: Einlesen hebt den Stand auf, ersetzt, speichert und leert die Sitzung, in dieser Folge", () => {
    const old = createState(NOW);
    const fresh = createState(NOW);
    const calls = [];
    const ctx = {
      state: old,
      loadError: { code: "broken" },
      store: { keepPrevious: () => calls.push("keepPrevious"), clearSession: () => calls.push("clearSession") },
      replaceState(state) {
        ctx.state = state;
        calls.push("replaceState");
      },
      save: () => calls.push("save"),
      navigate() {},
    };
    assert.equal(replaceLearningState(ctx, fresh, new FakeNode("div"), "Eingelesen."), true);
    assert.deepEqual(calls, ["keepPrevious", "replaceState", "save", "clearSession"]);
    assert.equal(ctx.state, fresh);
    assert.equal(ctx.loadError, null);
  });

  it("Sichern: Scheitert das Einlesen, bleibt der jetzige Lernstand", () => {
    const old = createState(NOW);
    const calls = [];
    const ctx = {
      state: old,
      store: { keepPrevious: () => calls.push("keepPrevious"), clearSession: () => calls.push("clearSession") },
      replaceState(state) {
        ctx.state = state;
      },
      save() {
        throw new Error("voll");
      },
      navigate() {},
    };
    const area = new FakeNode("div");
    assert.equal(replaceLearningState(ctx, createState(NOW), area, "Eingelesen."), false);
    assert.equal(ctx.state, old);
    assert.deepEqual(calls, ["keepPrevious"], "Die Sitzung bleibt");
    assert.ok(area.textContent.includes("Das hat nicht geklappt"));
  });

  // ----- Sprechen -----

  const speakTask = {
    unitId: "mr.safety.s01",
    stage: "a",
    snapshot: {
      en: "Do you have a pacemaker?",
      variants: [],
      keywords: ["pacemaker"],
      softKeywords: false,
      situationDe: "Lage",
      meaningDe: "Haben Sie einen Herzschrittmacher?",
      noteDe: null,
      clinicDependent: false,
      prompt: null,
      source: null,
    },
  };

  class FakeRecognition {
    start() {}
    abort() {}
    stop() {}
  }

  it("Sprechen: Endete die App vor der Wertung, kommt sie beim Laden, und „Beenden“ leert die Sitzung", async () => {
    globalThis.webkitSpeechRecognition = FakeRecognition;
    const session = createSpeechSession({ queue: [speakTask], appVersion: "test", today: TODAY });
    session.step = "feedback";
    session.result = { outcome: "understood", transcript: "do you have a pacemaker", words: [], against: null, reason: null };
    const store = sessionStore(session);
    const state = createState(NOW);
    let saves = 0;
    const container = new FakeNode("div");
    const stop = await renderSpeak(container, { ...contextOf(state), store, save: () => (saves += 1), tts: speakingTts() }, {});
    assert.equal(unitState(state, speakTask.unitId).spokenA, true);
    assert.equal(saves, 1);
    assert.equal(store.session.graded, true);
    tap(container.button("Beenden"));
    assert.equal(store.session, null);
    assert.ok(container.textContent.includes("Runde geschafft"));
    stop?.();
  });

  it("Sprechen: Lief die Erkennung auf dieser Seite schon, lädt der nächste Satz neu", async () => {
    globalThis.webkitSpeechRecognition = FakeRecognition;
    const recognizer = createRecognizer(FakeRecognition);
    const running = recognizer.listen({ lang: "en-GB" });
    recognizer.cancel();
    await running;
    let reloads = 0;
    globalThis.location.reload = () => (reloads += 1);
    const store = sessionStore(createSpeechSession({ queue: [speakTask], appVersion: "test", today: TODAY }));
    await renderSpeak(new FakeNode("div"), { ...contextOf(createState(NOW)), store, tts: speakingTts() }, {});
    assert.equal(reloads, 1);
  });

  it("Sprechen: Eine Runde von gestern wird verworfen und neu geplant", async () => {
    globalThis.webkitSpeechRecognition = FakeRecognition;
    const yesterday = createSpeechSession({ queue: [{ ...speakTask, unitId: "gestern" }], appVersion: "test", today: "2026-11-06" });
    const store = sessionStore(yesterday);
    const container = new FakeNode("div");
    const stop = await renderSpeak(container, { ...contextOf(createState(NOW)), store, tts: speakingTts() }, {});
    assert.equal(store.session.plannedOn, TODAY);
    assert.notEqual(store.session.queue[0].unitId, "gestern");
    stop?.();
  });

  it("Einstufung: Lief die Erkennung auf dieser Seite schon, lädt die nächste Sprechaufgabe neu, ohne Rückfrage danach", async () => {
    globalThis.webkitSpeechRecognition = FakeRecognition;
    const recognizer = createRecognizer(FakeRecognition);
    const running = recognizer.listen({ lang: "en-GB" });
    recognizer.cancel();
    await running;
    let reloads = 0;
    globalThis.location.reload = () => (reloads += 1);
    const session = openTest(12);
    session.speakingReady = true;
    const store = sessionStore(session);
    await renderPlacement(new FakeNode("div"), { ...contextOf(createState(NOW)), store, tts: speakingTts() });
    assert.equal(reloads, 1);
    assert.equal(store.session.resumeOnLoad, true);
    assert.equal(store.session.index, 12);
  });

  it("Sprechschritt: Ein zweiter Tipp auf „Weiter“ überspringt keinen Satz", () => {
    let nexts = 0;
    const host = new FakeNode("div");
    const step = renderSpeakStep(host, contextOf(createState(NOW)), {
      task: speakTask,
      saved: { step: "feedback", result: { outcome: "understood", transcript: "x", words: [], against: null, reason: null } },
      onChange() {},
      onResult() {},
      onNext: () => (nexts += 1),
      recognizer: { listen: async () => ({}), cancel() {} },
    });
    const next = host.button("Weiter");
    next.fire("click");
    next.fire("click");
    assert.equal(nexts, 1);
    step.destroy();
  });

  it("Sprechschritt: Ein Lauf ohne Text kommt in den Technik-Bericht, ein Abbruch nicht", async () => {
    const runs = [];
    const ctx = { ...contextOf(createState(NOW)), store: { ...sessionStore(), noteSpeechRun: (entry) => runs.push(entry) }, tts: speakingTts() };
    ctx.state.settings = { lang: "en-GB" };
    const events = [{ name: "audiostart", ms: 300 }];
    const listen = async () => ({ status: "notMeasured", transcript: "", reason: "noSpeech", events });
    const host = new FakeNode("div");
    const step = renderSpeakStep(host, ctx, {
      task: { ...speakTask, stage: "b" },
      onChange() {},
      onResult() {},
      onNext() {},
      recognizer: { listen, cancel() {} },
      reload() {},
    });
    tap(host.button("Sprechen"));
    await settle();
    assert.deepEqual(runs, [{ at: NOW.toISOString(), status: "notMeasured", reason: "noSpeech", events }]);
    assert.deepEqual(speechLogLines(runs), [NOW.toISOString() + " notMeasured noSpeech: audiostart 300"]);
    step.destroy();

    const cancelled = [];
    const again = new FakeNode("div");
    const quiet = renderSpeakStep(again, { ...ctx, store: { ...sessionStore(), noteSpeechRun: (entry) => cancelled.push(entry) } }, {
      task: { ...speakTask, stage: "b" },
      onChange() {},
      onResult() {},
      onNext() {},
      recognizer: { listen: async () => ({ status: "notMeasured", transcript: "", reason: "cancelled", events: [] }), cancel() {} },
      reload() {},
    });
    tap(again.button("Sprechen"));
    await settle();
    assert.deepEqual(cancelled, []);
    quiet.destroy();
  });
});
