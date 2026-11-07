import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadContent } from "../js/core/content.js";
import { analyzeWords, apostropheReading, normalizeText, spellingForms, surfaceWords, tokens } from "../js/core/normalize.js";

function same(a, b) {
  assert.equal(normalizeText(a), normalizeText(b), a + " und " + b);
}

function different(a, b) {
  assert.notEqual(normalizeText(a), normalizeText(b), a + " und " + b);
}

test("Kleinschreibung, gerade Apostrophe, Satzzeichen und Leerzeichen darum", () => {
  assert.equal(normalizeText("How are you?"), "how are you");
  assert.equal(normalizeText("  How   are you ? "), "how are you");
  assert.equal(normalizeText("how are you ?"), "how are you");
  assert.equal(normalizeText("Hello , how are you ! "), "hello how are you");
  assert.equal(normalizeText("Hello,how are you"), "hello how are you");
  assert.equal(normalizeText("Please - wait..."), "please wait");
  assert.equal(normalizeText("\"Please\" (wait)."), "please wait");
  assert.equal(normalizeText("Please wait"), "please wait");
  same("It’s fine", "It's fine");
  same("It‘s fine", "It's fine");
  same("It`s fine", "It's fine");
  same("It´s fine", "It's fine");
});

test("Leere Eingaben", () => {
  assert.equal(normalizeText(""), "");
  assert.equal(normalizeText("   "), "");
  assert.equal(normalizeText(" ? ! . "), "");
  assert.equal(normalizeText(null), "");
  assert.equal(normalizeText(undefined), "");
  assert.deepEqual(tokens(""), []);
  assert.deepEqual(surfaceWords(" ? "), []);
});

test("Kurzformen aus dem Bauauftrag", () => {
  assert.equal(normalizeText("I'm"), "i am");
  assert.equal(normalizeText("don't"), "do not");
  assert.equal(normalizeText("it's"), "it is");
  assert.equal(normalizeText("you'll"), "you will");
  assert.equal(normalizeText("can't"), "can not");
  assert.equal(normalizeText("cannot"), "can not");
  assert.equal(normalizeText("can not"), "can not");
  assert.equal(normalizeText("won't"), "will not");
  assert.equal(normalizeText("isn't"), "is not");
  assert.equal(normalizeText("that's"), "that is");
  assert.equal(normalizeText("there's"), "there is");
  assert.equal(normalizeText("we'll"), "we will");
  assert.equal(normalizeText("I'll"), "i will");
  assert.equal(normalizeText("you're"), "you are");
  assert.equal(normalizeText("we're"), "we are");
  assert.equal(normalizeText("I've"), "i have");
  assert.equal(normalizeText("doesn't"), "does not");
  assert.equal(normalizeText("didn't"), "did not");
});

test("Weitere übliche Kurzformen", () => {
  for (const [short, long] of [
    ["aren't", "are not"],
    ["wasn't", "was not"],
    ["weren't", "were not"],
    ["haven't", "have not"],
    ["hasn't", "has not"],
    ["hadn't", "had not"],
    ["wouldn't", "would not"],
    ["couldn't", "could not"],
    ["shouldn't", "should not"],
    ["mustn't", "must not"],
    ["he's", "he is"],
    ["she's", "she is"],
    ["what's", "what is"],
    ["who's", "who is"],
    ["where's", "where is"],
    ["when's", "when is"],
    ["how's", "how is"],
    ["here's", "here is"],
    ["they're", "they are"],
    ["they've", "they have"],
    ["we've", "we have"],
    ["you've", "you have"],
    ["I'd", "i would"],
    ["you'd", "you would"],
    ["let's", "let us"],
    ["something's", "something is"],
    ["number's", "number is"],
    ["appointment's", "appointment is"],
  ]) {
    assert.equal(normalizeText(short), long, short);
  }
});

test("Kurzformen ohne Apostroph", () => {
  for (const [typed, written] of [
    ["im", "I'm"],
    ["ive", "I've"],
    ["dont", "don't"],
    ["doesnt", "doesn't"],
    ["didnt", "didn't"],
    ["isnt", "isn't"],
    ["arent", "aren't"],
    ["cant", "can't"],
    ["wont", "won't"],
    ["youre", "you're"],
    ["youll", "you'll"],
    ["thats", "that's"],
    ["theres", "there's"],
    ["whats", "what's"],
    ["its", "it's"],
    ["lets", "let's"],
  ]) {
    same(typed, written);
  }
});

test("Wörter, die wie eine Kurzform ohne Apostroph aussehen, bleiben, die zweite Lesart kommt extra", () => {
  assert.equal(normalizeText("Well done"), "well done");
  assert.equal(normalizeText("Were you here"), "were you here");
  assert.equal(normalizeText("I feel ill"), "i feel ill");
  assert.equal(normalizeText("Your ID"), "your id");
  assert.deepEqual(apostropheReading(tokens("well call you")), ["we", "will", "call", "you"]);
  assert.deepEqual(apostropheReading(tokens("were ready")), ["we", "are", "ready"]);
  assert.deepEqual(apostropheReading(tokens("ill be back")), ["i", "will", "be", "back"]);
  assert.equal(apostropheReading(tokens("please wait here")), null);
});

test("Der Apostroph eines Wortes ohne Kurzform fällt weg", () => {
  assert.equal(normalizeText("o'clock"), "oclock");
  assert.equal(normalizeText("patients'"), "patients");
  assert.equal(normalizeText("'please'"), "please");
  assert.equal(normalizeText("ma'am"), "maam");
});

test("Britisch und amerikanisch", () => {
  for (const [british, american] of [
    ["jewellery", "jewelry"],
    ["anaesthetic", "anesthetic"],
    ["anaesthetist", "anesthetist"],
    ["anaesthesia", "anesthesia"],
    ["centre", "center"],
    ["centres", "centers"],
    ["grey", "gray"],
    ["colour", "color"],
    ["coloured", "colored"],
    ["tumour", "tumor"],
    ["litres", "liters"],
    ["favourite", "favorite"],
    ["recognise", "recognize"],
    ["organised", "organized"],
    ["doughnut", "donut"],
    ["cancelled", "canceled"],
    ["pyjamas", "pajamas"],
    ["Mum", "Mom"],
    ["ok", "okay"],
    ["OK", "okay"],
    ["O.K.", "okay"],
    ["earplugs", "ear plugs"],
    ["earplugs", "ear-plugs"],
    ["X-ray", "xray"],
    ["X-ray", "x ray"],
    ["x-rays", "X rays"],
    ["alright", "all right"],
    ["make-up", "makeup"],
    ["make up", "makeup"],
  ]) {
    same(british, american);
  }
  same("Please remove your jewellery.", "please remove your JEWELRY");
  same("Take off your grey coat", "take off your gray coat");
});

test("Zahlwörter und Ziffern sind gleich", () => {
  same("six o'clock", "6 o'clock");
  same("Six o'clock", "6 oclock");
  same("six o clock", "6 o'clock");
  same("6:00", "six o'clock");
  same("6.00", "six o'clock");
  for (let number = 0; number <= 20; number += 1) {
    const word = [
      "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
      "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
    ][number];
    same(word, String(number));
  }
  same("twenty one", "21");
  same("twenty-one", "21");
  same("thirty", "30");
  same("forty-five", "45");
  same("fifty eight", "58");
  same("seventy-one", "71");
  same("ninety nine", "99");
  same("one hundred", "100");
  same("a hundred", "100");
  same("hundred", "100");
  same("one hundred and twenty", "120");
  same("two hundred", "200");
  different("thirteen", "thirty");
  different("13", "30");
  different("fifteen", "fifty");
});

test("Uhrzeit, Jahr und Ordnungszahl", () => {
  same("2:30", "two thirty");
  same("10:15", "ten fifteen");
  same("1:30", "one thirty");
  same("1971", "nineteen seventy one");
  same("1971", "nineteen seventy-one");
  same("1905", "nineteen oh five");
  same("2000", "two thousand");
  same("1,000", "one thousand");
  same("9th", "ninth");
  same("19th", "nineteenth");
  same("23rd", "twenty-third");
  same("23rd", "twenty third");
  same("1st", "first");
  same("2nd", "second");
  same("20th", "twentieth");
  same("0171", "zero one seven one");
  same("6pm", "6 pm");
  same("6 p.m.", "six pm");
  different("1957", "1967");
});

test("Anrede mit und ohne Punkt", () => {
  same("Mr.", "Mr");
  same("Mrs.", "Mrs");
  same("Mister", "Mr.");
  same("Dr.", "Doctor");
});

test("tokens zerlegt und passt zu normalizeText", () => {
  assert.deepEqual(tokens("I'm OK, don't worry."), ["i", "am", "ok", "do", "not", "worry"]);
  assert.deepEqual(tokens("At six o'clock"), ["at", "six", "oclock"]);
  for (const text of ["Please take off your x-ray apron.", "It's 30 minutes, isn't it ?"]) {
    assert.equal(tokens(text).join(" "), normalizeText(text));
  }
});

test("surfaceWords behält das Wort, wie es im Satz steht", () => {
  assert.deepEqual(surfaceWords("I'm OK, don't worry."), ["I'm", "OK", "don't", "worry"]);
  assert.deepEqual(surfaceWords("Is it an X-ray ?"), ["Is", "it", "an", "X-ray"]);
  assert.deepEqual(surfaceWords("(Please) wait -"), ["Please", "wait"]);
  assert.deepEqual(surfaceWords("At 2:30, please."), ["At", "2:30", "please"]);
});

test("analyzeWords ordnet jeden Baustein seinem Wort zu", () => {
  const contraction = analyzeWords("I'm here.");
  assert.deepEqual(contraction.surfaces, ["I'm", "here"]);
  assert.deepEqual(contraction.tokens, ["i", "am", "here"]);
  assert.deepEqual(contraction.owners, [[0], [0], [1]]);

  const joined = analyzeWords("An x ray now");
  assert.deepEqual(joined.tokens, ["an", "xray", "now"]);
  assert.deepEqual(joined.owners, [[0], [1, 2], [3]]);

  const hundred = analyzeWords("a hundred and five");
  assert.deepEqual(hundred.tokens, ["one", "hundred", "five"]);
  assert.deepEqual(hundred.owners, [[0], [1], [2, 3]]);
});

test("spellingForms nennt beide Schreibweisen", () => {
  assert.deepEqual(spellingForms("jewellery"), ["jewellery", "jewelry"]);
  assert.deepEqual(spellingForms("scan"), ["scan"]);
});

test("Echte Daten: jeder Satz ergibt saubere Bausteine", async () => {
  const content = await loadContent((name) => JSON.parse(readFileSync(new URL("../daten/" + name + ".json", import.meta.url), "utf8")));
  const texts = content.allUnits().flatMap((unit) => [unit.en, ...unit.variants, ...unit.reactions.map((reaction) => reaction.en)]);
  assert.ok(texts.length > 1000);
  for (const text of texts) {
    const list = tokens(text);
    assert.ok(list.length > 0, text);
    assert.ok(list.every((token) => /^[\p{L}\p{N}]+$/u.test(token)), text);
    assert.equal(normalizeText(normalizeText(text)), normalizeText(text), text);
    assert.ok(surfaceWords(text).length > 0, text);
  }
});
