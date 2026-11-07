/*
 * Zwei Ansichten mit einem kleinen nachgebauten DOM, nur so viel, wie sie brauchen. Das echte Zeichnen prüft der Lauf im Browser,
 * hier geht es um das, was nie wieder passieren darf: ein Freitextfeld ohne Hinweis und ein Ergebnis, das sich nicht öffnen lässt.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { loadContent } from "../js/core/content.js";
import { createState, newUnit } from "../js/core/state.js";
import { render as renderPlacement } from "../js/ui/views/placement.js";
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
  }

  replaceChildren(...kids) {
    this.children = kids;
  }

  remove() {}

  blur() {}

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
    for (const name of ["document", "window", "performance", "scrollTo"]) {
      saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    }
    const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    define("document", { createElement: (tag) => new FakeNode(tag), addEventListener() {}, removeEventListener() {}, hidden: false, body: new FakeNode("body") });
    define("window", { scrollTo() {} });
    define("scrollTo", () => {});
    define("performance", { now: () => clock });
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
});
