import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createBrowserAssessor } from "../js/speech/assessor.js";

const unit = {
  en: "Please remove your jewellery.",
  variants: ["Please take off your jewellery."],
  keywords: ["remove|take off", "jewellery|jewelry"],
};

describe("Bewertung über die Browser-Erkennung", () => {
  const { assess } = createBrowserAssessor();

  it("hat die vereinbarte Form", () => {
    const result = assess({ unit, transcript: "please remove your jewellery", stage: "a" });
    assert.equal(result.outcome, "understood");
    assert.equal(result.provider, "browser");
    assert.deepEqual(result.scores, { accuracy: null, fluency: null, prosody: null });
    assert.deepEqual(result.words, [
      { word: "Please", status: "recognized", accuracy: null },
      { word: "remove", status: "recognized", accuracy: null },
      { word: "your", status: "recognized", accuracy: null },
      { word: "jewellery", status: "recognized", accuracy: null },
    ]);
  });

  it("nennt die Fassung, gegen die sie ausgerichtet hat", () => {
    const result = assess({ unit, transcript: "please take off your jewelry", stage: "a" });
    assert.equal(result.outcome, "understood");
    assert.equal(result.against, "Please take off your jewellery.");
    assert.deepEqual(result.words.map((item) => item.word), ["Please", "take", "off", "your", "jewellery"]);
  });

  it("markiert nicht erkannte Wörter und wertet teilweise", () => {
    const result = assess({ unit, transcript: "please your necklace", stage: "a" });
    assert.equal(result.outcome, "partly");
    assert.deepEqual(result.words.filter((item) => item.status === "missing").map((item) => item.word), ["remove", "jewellery"]);
  });

  it("wertet Stufe a nicht verstanden, wenn fast nichts passt", () => {
    assert.equal(assess({ unit, transcript: "the bus leaves at nine", stage: "a" }).outcome, "notUnderstood");
  });

  it("wertet in Stufe b nach den Schlüsselwörtern", () => {
    assert.equal(assess({ unit, transcript: "could you take off your jewelry now", stage: "b" }).outcome, "understood");
    assert.equal(assess({ unit, transcript: "take off the ring", stage: "b" }).outcome, "partly");
    assert.equal(assess({ unit, transcript: "the bus leaves at nine", stage: "b" }).outcome, "notUnderstood");
  });

  it("nimmt Ziffern und Zahlwörter gleich (Gerätetest Lauf 4)", () => {
    const shop = { en: "The shop closes at six o'clock.", variants: [], keywords: ["shop", "closes"] };
    assert.equal(assess({ unit: shop, transcript: "The shop closes at 6 o'clock", stage: "a" }).outcome, "understood");
  });

  it("verwirft den Satz wegen eines falschen Worts nicht (Gerätetest Lauf 4)", () => {
    const bus = { en: "The bus leaves at nine in the morning.", variants: [], keywords: ["bus", "morning"] };
    const result = assess({ unit: bus, transcript: "the bus leaves at night in the morning", stage: "a" });
    assert.equal(result.outcome, "understood");
    assert.deepEqual(result.words.filter((item) => item.status === "missing").map((item) => item.word), ["nine"]);
  });

  it("wertet weiche Schlüsselwörter bei freien Antworten", () => {
    const reaction = { en: "I will get you a warm blanket.", variants: [], keywords: ["warm", "blanket"], softKeywords: true };
    assert.equal(assess({ unit: reaction, transcript: "here is a blanket for you", stage: "b" }).outcome, "partly");
    assert.equal(assess({ unit: reaction, transcript: "here is a warm blanket", stage: "b" }).outcome, "understood");
  });

  it("wertet leeren Text als nicht verstanden, ohne zu werfen", () => {
    const result = assess({ unit, transcript: "", stage: "a" });
    assert.equal(result.outcome, "notUnderstood");
    assert.equal(result.words.every((item) => item.status === "missing"), true);
  });
});
