import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadContent } from "../js/core/content.js";
import { deriveKeywords, keywordLabel, matchSpoken, matchTyped, reactionKeywords } from "../js/core/matcher.js";

const REAL = await loadContent((name) => JSON.parse(readFileSync(new URL("../daten/" + name + ".json", import.meta.url), "utf8")));

const JEWELLERY = {
  en: "Please remove your jewellery now.",
  variants: ["Please take off your jewellery now."],
  keywords: ["remove|take off", "jewellery|jewelry"],
};

function typed(unit, text) {
  return matchTyped(unit, text).outcome;
}

function spoken(unit, text, stage) {
  return matchSpoken(unit, text, { stage }).outcome;
}

function unitOf(en, keywords = [], variants = []) {
  return { en, variants, keywords };
}

// ----- Pflicht: Die echten Daten. Ein richtiger Satz darf nie als falsch gelten. -----

// Einheiten, die an den Daten scheitern, mit Grund. Derzeit keine.
const DATA_EXCEPTIONS = new Map();

test("Echte Daten: jedes en und jede Fassung gilt gegen die eigene Einheit als richtig", () => {
  let checked = 0;
  for (const unit of REAL.allUnits()) {
    if (DATA_EXCEPTIONS.has(unit.id)) {
      continue;
    }
    for (const text of [unit.en, ...unit.variants]) {
      checked += 1;
      const label = unit.id + ": " + text;
      assert.equal(typed(unit, text), "correct", label);
      assert.equal(spoken(unit, text, "a"), "understood", label + " Stufe a");
      assert.equal(spoken(unit, text, "b"), "understood", label + " Stufe b");
      const result = matchSpoken(unit, text, { stage: "a" });
      assert.ok(result.words.every((word) => word.status === "recognized"), label);
      assert.deepEqual(result.missingKeywords, [], label);
    }
  }
  assert.ok(checked > 1500);
  assert.equal(REAL.allUnits().length, 540);
});

test("Echte Daten: auch klein, ohne Satzzeichen, mit schrägem Apostroph und mit Leerzeichen um Satzzeichen", () => {
  for (const unit of REAL.allUnits()) {
    if (DATA_EXCEPTIONS.has(unit.id)) {
      continue;
    }
    for (const text of [unit.en, ...unit.variants]) {
      const forms = [
        text.toLowerCase(),
        text.replace(/[.,?!]/g, ""),
        text.replaceAll("'", "’"),
        text.replace(/([.,?!])/g, " $1 ") + " ",
      ];
      for (const form of forms) {
        assert.equal(typed(unit, form), "correct", unit.id + ": " + form);
        assert.equal(spoken(unit, form, "a"), "understood", unit.id + ": " + form);
      }
    }
  }
});

test("Echte Daten: Ein Buchstabendreher im längsten Wort ist nie falsch", () => {
  let checked = 0;
  for (const unit of REAL.allUnits()) {
    for (const text of [unit.en, ...unit.variants]) {
      const longest = text
        .split(/\s+/)
        .map((word) => word.replace(/[.,?!]+$/, ""))
        .filter((word) => /^[A-Za-z]{4,}$/.test(word))
        .sort((a, b) => b.length - a.length)[0];
      if (!longest) {
        continue;
      }
      const position = longest[1] !== longest[2] ? 1 : 2;
      const swapped = longest.slice(0, position) + longest[position + 1] + longest[position] + longest.slice(position + 2);
      if (swapped.toLowerCase() === longest.toLowerCase()) {
        continue;
      }
      checked += 1;
      const outcome = typed(unit, text.replace(longest, swapped));
      assert.notEqual(outcome, "wrong", unit.id + ": " + text.replace(longest, swapped));
    }
  }
  assert.ok(checked > 1000);
});

test("Echte Daten: jedes Schlüsselwort steht in en und in jeder Fassung", () => {
  for (const unit of REAL.allUnits().filter((item) => item.keywords.length > 0 && !DATA_EXCEPTIONS.has(item.id))) {
    for (const text of [unit.en, ...unit.variants]) {
      const alone = { en: text, variants: [], keywords: unit.keywords };
      assert.deepEqual(matchTyped(alone, text).missingKeywords, [], unit.id + ": " + text);
    }
  }
});

test("Echte Daten: die passende Reaktion gilt als Schnappschuss mit abgeleiteten Schlüsselwörtern als verstanden", () => {
  const patient = REAL.allUnits().filter((unit) => unit.type === "patient");
  assert.ok(patient.length > 100);
  for (const unit of patient) {
    const reaction = unit.reactions.find((item) => item.fits === true);
    const snapshot = { en: reaction.en, variants: [], keywords: deriveKeywords(reaction.en), softKeywords: true };
    assert.equal(spoken(snapshot, reaction.en, "b"), "understood", unit.id);
    assert.equal(typed(snapshot, reaction.en), "correct", unit.id);
    assert.ok(snapshot.keywords.length <= 4, unit.id);
  }
});

// ----- Getippt -----

test("Getippt: gleich en oder einer Fassung, against nennt die Fassung", () => {
  assert.deepEqual(matchTyped(JEWELLERY, "Please remove your jewellery now."), {
    outcome: "correct",
    against: JEWELLERY.en,
    missingKeywords: [],
  });
  const variant = matchTyped(JEWELLERY, "please take off your jewellery now");
  assert.equal(variant.outcome, "correct");
  assert.equal(variant.against, JEWELLERY.variants[0]);
});

test("Getippt: britisch und amerikanisch", () => {
  assert.equal(typed(JEWELLERY, "please remove your jewelry now"), "correct");
  assert.equal(typed(unitOf("It is the grey centre."), "It is the gray center"), "correct");
  assert.equal(typed(unitOf("You will need an anaesthetic.", ["anaesthetic|anesthetic"]), "you will need an anesthetic"), "correct");
  assert.equal(typed(unitOf("Is that OK?"), "is that okay"), "correct");
  assert.equal(typed(unitOf("We need an X-ray."), "we need an xray"), "correct");
  assert.equal(typed(unitOf("We need an X-ray."), "we need an x ray"), "correct");
  assert.equal(typed(unitOf("Do you want earplugs?", ["earplugs|ear plugs"]), "do you want ear plugs"), "correct");
});

test("Getippt: Kurzformen", () => {
  const unit = unitOf("I don't know.", ["know"]);
  assert.equal(typed(unit, "I do not know"), "correct");
  assert.equal(typed(unit, "i dont know"), "correct");
  assert.equal(typed(unit, "I don’t know"), "correct");
  assert.equal(typed(unitOf("You cannot eat.", ["eat"]), "you can't eat"), "correct");
  assert.equal(typed(unitOf("I am here."), "I'm here"), "correct");
  assert.equal(typed(unitOf("It will not hurt."), "It won't hurt"), "correct");
});

test("Getippt: Kurzform ohne Apostroph, die zugleich ein Wort ist", () => {
  assert.equal(typed(unitOf("We'll call you."), "well call you"), "correct");
  assert.equal(typed(unitOf("We're ready."), "were ready"), "correct");
  assert.equal(typed(unitOf("I'll be back."), "ill be back"), "correct");
  assert.equal(typed(unitOf("Well done."), "well done"), "correct");
  assert.equal(typed(unitOf("Were you here?"), "were you here"), "correct");
});

test("Getippt: Ziffern und Zahlwörter", () => {
  const unit = unitOf("It starts at six o'clock.", ["six"]);
  assert.equal(typed(unit, "It starts at 6 o'clock."), "correct");
  assert.equal(typed(unit, "it starts at 6 oclock"), "correct");
  assert.equal(typed(unit, "it starts at 6:00"), "correct");
  assert.equal(typed(unitOf("It starts at 6 o'clock.", ["6"]), "it starts at six o'clock"), "correct");
  const other = matchTyped(unit, "it starts at 7 o'clock");
  assert.equal(other.outcome, "wrong");
  assert.deepEqual(other.missingKeywords, ["six"]);
  assert.equal(typed(unitOf("So that is the 23rd of March, 1971?", ["23rd", "1971"]), "so that is the twenty third of march nineteen seventy one"), "correct");
  assert.equal(typed(unitOf("Did you say 13 or 30?", ["13", "30"]), "did you say thirteen or thirty"), "correct");
  assert.equal(typed(unitOf("Did you say 13 or 30?", ["13", "30"]), "did you say thirty or forty"), "wrong");
});

test("Getippt: Schlüsselwörter mit Alternativen, auch als Wortfolge", () => {
  assert.equal(typed(JEWELLERY, "please take off your jewelry now"), "correct");
  const noVariant = { ...JEWELLERY, variants: [] };
  assert.equal(typed(noVariant, "please take off your jewellery now"), "correct");
  assert.equal(typed(noVariant, "please take it off your jewellery now"), "correct");
  assert.equal(typed(noVariant, "take your jewellery off please now"), "close");
  const other = matchTyped(noVariant, "please remove your things now");
  assert.equal(other.outcome, "wrong");
  assert.deepEqual(other.missingKeywords, ["jewellery|jewelry"]);
  const take = matchTyped(noVariant, "please take your jewellery now");
  assert.deepEqual(take.missingKeywords, ["remove|take off"]);
  assert.equal(take.outcome, "wrong");
});

test("Getippt: 80 Prozent der Wörter und alle Schlüsselwörter", () => {
  const five = unitOf("Please lie down over here.", ["lie"]);
  assert.equal(typed(five, "please lie down here"), "correct");
  assert.equal(typed(five, "lie down over here"), "correct");
  assert.equal(typed(five, "please lie down"), "wrong");
  const four = unitOf("Please keep very still.", ["still"]);
  assert.equal(typed(four, "please keep still"), "wrong");
  assert.equal(typed(unitOf("Please lie down over here.", ["table"]), "please lie down over here"), "correct");
  assert.equal(typed(unitOf("Please lie down over here.", ["table"]), "please lie down over there"), "wrong");
  assert.equal(typed(five, "could you please lie down over here for me"), "correct");
});

test("Getippt: Leerzeichen um Satzzeichen und am Ende zählen nicht (Gerätetest Lauf 5)", () => {
  const unit = unitOf("How are you?");
  for (const text of ["how are you?", "how are you ?", "how are you ? ", "  How are you ?  ", "how are you"]) {
    assert.equal(typed(unit, text), "correct", text);
  }
  assert.equal(typed(unitOf("Hello, how are you?"), "hello , how are you ? "), "correct");
  // Das Echo aus Lauf 5. hove ist von how zwei Schritte entfernt, also kein Tippfehler. Die Leerzeichen ändern daran nichts.
  assert.equal(typed(unit, "hove are you ? "), typed(unit, "hove are you?"));
  assert.equal(typed(unit, "hove are you ? "), "wrong");
  assert.equal(typed(unit, "howe are you ? "), "wrong");
  assert.equal(typed(unitOf("Have you eaten?", ["eaten"]), "hove you eaten ? "), "close");
});

test("Getippt: Tippfehler sind close", () => {
  for (const text of [
    "please remvoe your jewellery now",
    "please remove your jewelery now",
    "please remove your jewlery now",
    "please remuve your jewelry now",
    "plesae remuve your jewellery now",
    "Please  remuve your jewellery now ? ",
    "plesae remove yuor jewellery now",
  ]) {
    assert.equal(typed(JEWELLERY, text), "close", text);
    assert.deepEqual(matchTyped(JEWELLERY, text).missingKeywords, [], text);
  }
  assert.equal(typed(unitOf("Do you want earplugs?", ["earplugs|ear plugs"]), "do you want ear pulgs"), "close");
  assert.equal(typed(unitOf("We need an X-ray."), "we need an x rya"), "close");
  assert.equal(typed(unitOf("Could I come in?"), "cuold I come in"), "close");
  const short = unitOf("Please wait here.");
  assert.equal(typed(short, "plesae wait here"), "close");
  assert.equal(typed(short, "pleasee wait here"), "close");
  assert.equal(typed(short, "plese wiat here"), "close");
});

test("Getippt: Ein Tippfehler außerhalb der Schlüsselwörter fällt unter die 80 Prozent und bleibt richtig", () => {
  assert.equal(typed(JEWELLERY, "please remove yuor jewellery now"), "correct");
  assert.equal(typed(JEWELLERY, "plese remove your jewellery now"), "correct");
});

test("Getippt: Tippfehler nur ab 4 Buchstaben, Abstand 1, höchstens zwei Wörter", () => {
  const short = unitOf("Do you see it?", ["see"]);
  assert.equal(typed(short, "do yu see it"), "wrong");
  assert.equal(typed(short, "do you sea it"), "wrong");
  assert.equal(typed(unitOf("Please take your coat.", ["coat"]), "please take your coot"), "close");
  assert.equal(typed(unitOf("Please take your coat.", ["coat"]), "please take your cott"), "close");
  assert.equal(typed(unitOf("Please take your coat.", ["coat"]), "please take your boots"), "wrong");
  const four = unitOf("Please remove your jewellery");
  assert.equal(typed(four, "plesae remuve your jewellery"), "close");
  assert.equal(typed(four, "plesae remuve yuor jewellery"), "wrong");
  assert.equal(typed(four, "plesae remuve yuor jewelery"), "wrong");
});

test("Getippt: Nur please darf die Stelle wechseln, Wortsalat ist falsch", () => {
  const unit = unitOf("Please remove your coat.", ["coat"]);
  assert.equal(typed(unit, "Remove your coat, please."), "close");
  assert.equal(typed(unit, "coat your remove please"), "wrong");
  assert.equal(typed(unit, "coat remove"), "wrong");
  assert.equal(typed(unit, "Remvoe your coat, please"), "close", "please versetzt und ein Tippfehler");
  assert.equal(typed(unit, "Remove your coat"), "wrong", "please fehlt ganz, das ist keine andere Stellung");
  assert.equal(typed(unitOf("Do you have a pacemaker?", ["pacemaker"]), "pacemaker a have you do"), "wrong");
  assert.equal(typed(unitOf("Please sit down."), "down sit please"), "wrong");
});

test("Echte Daten: Rückwärts getippt zählt nie, auch nicht in der Einstufung", () => {
  const { forms } = JSON.parse(readFileSync(new URL("../daten/einstufung.json", import.meta.url), "utf8"));
  const writing = forms.flatMap((form) => form.items).filter((item) => item.part === "writing");
  assert.equal(writing.length, 8);
  const sentences = REAL.allUnits().filter((unit) => unit.type === "sentence");
  assert.ok(sentences.length > 300);
  for (const unit of [...writing, ...sentences]) {
    const reversed = unit.en.replace(/[.?!]$/, "").split(" ").reverse().join(" ");
    assert.equal(typed(unit, reversed), "wrong", unit.id + ": " + reversed);
  }
});

test("Getippt: Bei Fragen zählt die Stellung des Hilfsverbs", () => {
  const unit = unitOf("Do you have a pacemaker?", ["pacemaker"]);
  assert.equal(typed(unit, "Do you have a pacemaker?"), "correct");
  assert.equal(typed(unit, "You do have a pacemaker"), "close");
  assert.equal(typed(unit, "You have a pacemaker"), "close");
  assert.equal(typed(unit, "Sorry, do you have a pacemaker"), "correct", "Ein Wort davor ändert die Stellung nicht");
  assert.equal(typed(unitOf("You have a pacemaker.", ["pacemaker"]), "you have got a pacemaker"), "correct", "Das gilt nur für Fragen");
  assert.equal(typed(unitOf("So you mean your left knee?", ["knee"]), "you mean your left knee"), "correct", "Ohne Hilfsverb am Anfang ändert sich nichts");
  assert.equal(typed(unitOf("Is that a double L?", ["double"]), "That is a double L"), "close");
});

test("Getippt: Fehlt oder kommt ein not dazu, ist das nicht glatt richtig", () => {
  const unit = unitOf("The scan does not hurt.", ["hurt"]);
  assert.equal(typed(unit, "The scan doesn't hurt"), "correct");
  assert.equal(typed(unit, "The scan does hurt"), "close");
  assert.equal(typed(unitOf("Please take off your coat now.", ["coat"]), "Please do not take off your coat now"), "close");
  assert.equal(typed(unitOf("You must not drive after that medicine."), "you must drive after that medicine"), "close");
});

test("negationFlip steht nur im Ergebnis, wenn ein not fehlt oder dazukommt", () => {
  const unit = unitOf("You must not drive after that medicine.", ["drive"]);
  assert.equal(matchTyped(unit, "you must drive after that medicine").negationFlip, true);
  assert.equal(matchTyped(unit, "you must drive after that medecine").negationFlip, true, "auch mit Tippfehler");
  assert.equal(matchTyped(unit, "you must never drive after that medicine").negationFlip, undefined);
  assert.equal(matchTyped(unit, "you must not drive after that medecine").negationFlip, undefined);
  assert.equal(matchTyped(unit, "bananas").negationFlip, undefined, "Falsch ist schon falsch");
  assert.equal(matchSpoken(unit, "you must drive after that medicine", { stage: "b" }).negationFlip, true);
  assert.equal(matchSpoken(unitOf("Please take off your coat.", ["coat"]), "please do not take off your coat", { stage: "b" }).negationFlip, true);
  assert.equal(matchSpoken(unit, "you must not drive after that medicine", { stage: "b" }).negationFlip, undefined);
  assert.equal(matchSpoken({ ...unit, softKeywords: true }, "you can drive after that medicine", { stage: "b" }).negationFlip, undefined, "Freie Antworten fallen verschieden aus");
  assert.equal(matchSpoken(unit, "bananas", { stage: "b" }).negationFlip, undefined);
});

test("Gesprochen: Ein fehlendes oder zusätzliches not ist höchstens teilweise verstanden", () => {
  const unit = unitOf("You must not drive after that medicine.", ["drive"]);
  for (const stage of ["a", "b"]) {
    assert.equal(matchSpoken(unit, "you must drive after that medicine", { stage }).outcome, "partly", stage);
    assert.equal(matchSpoken(unit, "you must not drive after that medicine", { stage }).outcome, "understood", stage);
    assert.equal(matchSpoken(unit, "you mustn't drive after that medicine", { stage }).outcome, "understood", stage + ": Kurzform");
    assert.equal(matchSpoken(unit, "you must never drive after that medicine", { stage }).outcome, "understood", stage + ": never statt not");
  }
  const coat = unitOf("Please take off your coat.", ["coat"]);
  assert.equal(matchSpoken(coat, "please do not take off your coat", { stage: "b" }).outcome, "partly", "not kommt dazu");
  const free = { ...unit, softKeywords: true };
  assert.equal(matchSpoken(free, "you can drive after that medicine", { stage: "b" }).outcome, "understood", "Freie Antwort bleibt großzügig");
  const withVariant = { ...unitOf("You must not drive.", ["drive"]), variants: ["You can drive tomorrow."] };
  assert.equal(matchSpoken(withVariant, "you can drive tomorrow", { stage: "b" }).outcome, "understood", "Eine zugelassene Fassung ohne not zählt");
});

test("Getippt: Einheiten ohne Schlüsselwörter nutzen die der Fassung", () => {
  const word = { en: "contrast medium", variants: ["contrast agent"], keywords: [] };
  assert.equal(typed(word, "contrast medium"), "correct");
  assert.equal(typed(word, "contrast agent"), "correct");
  assert.equal(typed(word, "contrast"), "wrong");
  assert.equal(typed(word, "contrast medum"), "close");
  assert.deepEqual(matchTyped(word, "contrast").missingKeywords, ["medium"]);
});

test("Getippt: Leere Eingabe und Einheit ohne Text", () => {
  for (const text of ["", "   ", " ? ", null, undefined]) {
    const result = matchTyped(JEWELLERY, text);
    assert.equal(result.outcome, "wrong");
    assert.equal(result.against, JEWELLERY.en);
    assert.deepEqual(result.missingKeywords, JEWELLERY.keywords);
  }
  assert.deepEqual(matchTyped({ en: "", variants: [], keywords: [] }, "hello"), { outcome: "wrong", against: null, missingKeywords: [] });
});

// ----- Gesprochen, Stufe a -----

test("Stufe a: verstanden ab 80 Prozent und allen Schlüsselwörtern", () => {
  const unit = unitOf("Please lie down over here.", ["lie"]);
  assert.equal(spoken(unit, "please lie down over here", "a"), "understood");
  assert.equal(spoken(unit, "please lie down here", "a"), "understood");
  assert.equal(spoken(unit, "lie down over here", "a"), "understood");
  assert.equal(spoken(unit, "please down over here", "a"), "partly");
});

test("Stufe a: teilweise ab 50 Prozent oder allen Schlüsselwörtern, sonst nicht verstanden", () => {
  const unit = unitOf("Please keep very still.", ["still"]);
  assert.equal(spoken(unit, "please keep", "a"), "partly");
  assert.equal(spoken(unit, "still", "a"), "partly");
  assert.equal(spoken(unit, "very", "a"), "notUnderstood");
  assert.equal(spoken(unit, "good morning everyone", "a"), "notUnderstood");
  const noKeywords = { en: "Yes, you are doing really well.", variants: [], keywords: [] };
  assert.equal(spoken(noKeywords, "hello", "a"), "notUnderstood");
});

// ----- Gesprochen, Stufe b -----

test("Stufe b: verstanden bei allen Schlüsselwörtern oder Gleichheit", () => {
  const unit = unitOf("Do you have a pacemaker or a metal plate?", ["pacemaker", "metal"]);
  assert.equal(spoken(unit, "pacemaker and metal", "b"), "understood");
  assert.equal(spoken(unit, "Do you have a pacemaker or a metal plate?", "b"), "understood");
  assert.equal(spoken(unit, "any metal", "b"), "partly");
  assert.equal(spoken(unit, "pacemaker", "b"), "partly");
  assert.equal(spoken(unit, "do you have a plate", "b"), "notUnderstood");
  const three = unitOf("Is there metal in your hip or knee?", ["metal", "hip", "knee"]);
  assert.equal(spoken(three, "metal", "b"), "notUnderstood");
  assert.equal(spoken(three, "metal hip", "b"), "partly");
  assert.equal(spoken(three, "metal hip knee", "b"), "understood");
});

test("Stufe b: Gleichheit gewinnt auch dann, wenn der Satz die Schlüsselwörter anders schreibt", () => {
  const unit = { en: "Is that all right?", variants: ["Is that OK?"], keywords: ["OK|all right"] };
  assert.equal(spoken(unit, "is that okay", "b"), "understood");
  assert.equal(spoken(unit, "is that alright", "b"), "understood");
});

test("Stufe b mit softKeywords: verstanden ab 60 Prozent, teilweise ab 30 Prozent", () => {
  const keywords = ["metal", "plate", "knee", "operation", "doctor"];
  const unit = { en: "Is there a metal plate in your knee after the operation, doctor?", variants: [], keywords, softKeywords: true };
  assert.equal(spoken(unit, "metal plate knee", "b"), "understood");
  assert.equal(spoken(unit, "metal plate", "b"), "partly");
  assert.equal(spoken(unit, "metal", "b"), "notUnderstood");
  const three = { ...unit, keywords: ["metal", "plate", "knee"] };
  assert.equal(spoken(three, "metal plate", "b"), "understood");
  assert.equal(spoken(three, "metal", "b"), "partly");
  const four = { ...unit, keywords: ["metal", "plate", "knee", "operation"] };
  assert.equal(spoken(four, "metal plate knee", "b"), "understood");
  assert.equal(spoken(four, "metal plate", "b"), "partly");
  assert.equal(spoken(four, "metal", "b"), "notUnderstood");
  assert.equal(spoken(four, unit.en, "b"), "understood");
});

test("softKeywords gelten nur in Stufe b", () => {
  const unit = { en: "Is there any metal in your knee today?", variants: [], keywords: ["metal", "knee", "today"], softKeywords: true };
  assert.equal(spoken(unit, "metal knee", "b"), "understood");
  assert.equal(spoken(unit, "metal knee", "a"), "notUnderstood");
});

test("Stufe b: Ein Satz ohne Inhaltswort ist nicht mit jeder Antwort verstanden", () => {
  const unit = { en: "Yes, you are doing really well.", variants: [], keywords: deriveKeywords("Yes, you are doing really well."), softKeywords: true };
  assert.deepEqual(unit.keywords, []);
  assert.equal(spoken(unit, "yes you are doing really well", "b"), "understood");
  assert.equal(spoken(unit, "you are doing really well", "b"), "understood");
  assert.equal(spoken(unit, "you are doing", "b"), "partly");
  assert.equal(spoken(unit, "hello", "b"), "notUnderstood");
  assert.equal(spoken(unit, "", "b"), "notUnderstood");
});

test("Stufe b mit softKeywords und ohne Inhaltswort: Eine freie richtige Antwort gilt, mehr als die Hälfte der Wörter genügt", () => {
  const well = { en: "Yes, you are doing really well.", variants: [], keywords: [], softKeywords: true };
  assert.equal(spoken(well, "Yes, you are doing great", "b"), "understood");
  const done = { en: "Yes, that one is done. You did very well.", variants: [], keywords: [], softKeywords: true };
  assert.equal(spoken(done, "yes you did very well", "b"), "understood");
  assert.equal(spoken(done, "thank you doctor", "b"), "notUnderstood");
  assert.equal(spoken({ ...well, softKeywords: false }, "Yes, you are doing great", "b"), "partly", "Ohne softKeywords bleibt die strenge Regel");
  for (const id of ["sb.reassure.p02", "kl.spell.p02", "ge.greeting.p01", "rx.stillness.p01"]) {
    const reaction = REAL.unit(id).reactions.find((item) => item.fits === true);
    assert.deepEqual(deriveKeywords(reaction.en), [], id);
    assert.equal(spoken({ en: reaction.en, variants: [], keywords: [], softKeywords: true }, reaction.en, "b"), "understood", id);
    assert.equal(spoken({ en: reaction.en, variants: [], keywords: [], softKeywords: true }, "purple elephants dance", "b"), "notUnderstood", id);
  }
});

test("Gesprochen: Leerer Text ist nie verstanden", () => {
  for (const stage of ["a", "b"]) {
    const result = matchSpoken(JEWELLERY, "", { stage });
    assert.equal(result.outcome, "notUnderstood");
    assert.equal(result.against, JEWELLERY.en);
    assert.ok(result.words.every((word) => word.status === "missing"));
    assert.deepEqual(result.missingKeywords, JEWELLERY.keywords);
  }
  assert.equal(spoken({ en: "Thanks", variants: [], keywords: [], softKeywords: true }, null, "b"), "notUnderstood");
});

// ----- Gesprochen, Ausrichtung -----

function statuses(result) {
  return result.words.map((word) => (word.status === "recognized" ? word.word : "(" + word.word + ")")).join(" ");
}

test("Ausrichtung: fehlende Wörter", () => {
  const unit = unitOf("Please remove your jewellery now.", ["jewellery|jewelry"]);
  assert.equal(statuses(matchSpoken(unit, "please remove jewelry", { stage: "a" })), "Please remove (your) jewellery (now)");
  assert.equal(statuses(matchSpoken(unit, "remove your", { stage: "a" })), "(Please) remove your (jewellery) (now)");
});

test("Ausrichtung: zusätzliche Wörter erscheinen nicht", () => {
  const unit = unitOf("Please remove your jewellery.", ["jewellery"]);
  const result = matchSpoken(unit, "um please could you remove all of your nice jewellery today thanks", { stage: "a" });
  assert.equal(statuses(result), "Please remove your jewellery");
  assert.equal(result.outcome, "understood");
});

test("Ausrichtung: nur die gemeinsame Folge zählt", () => {
  const unit = unitOf("Please remove your coat", ["coat"]);
  const result = matchSpoken(unit, "coat your remove please", { stage: "a" });
  assert.equal(result.words.filter((word) => word.status === "recognized").length, 1);
  assert.equal(result.outcome, "partly");
});

test("Ausrichtung: wiederholte Wörter werden nur einmal anerkannt", () => {
  const unit = unitOf("Stay here, stay still.");
  assert.equal(statuses(matchSpoken(unit, "stay still", { stage: "a" })), "Stay (here) (stay) still");
});

test("Ausrichtung: Die Wörter stehen wie in der Fassung", () => {
  const unit = unitOf("I'm here at 6 o'clock for the X-ray.", ["X-ray"]);
  const all = matchSpoken(unit, "I am here at six o clock for the x ray", { stage: "a" });
  assert.equal(statuses(all), "I'm here at 6 o'clock for the X-ray");
  assert.equal(all.outcome, "understood");
  const part = matchSpoken(unit, "I here at 6 for the xray", { stage: "a" });
  assert.equal(statuses(part), "(I'm) here at 6 (o'clock) for the X-ray");
  assert.deepEqual(all.words[0], { word: "I'm", status: "recognized" });
});

test("Ausrichtung: Wörter und against kommen aus der besten Fassung", () => {
  const near = matchSpoken(JEWELLERY, "please take off your jewellery", { stage: "a" });
  assert.equal(near.against, JEWELLERY.variants[0]);
  assert.equal(statuses(near), "Please take off your jewellery (now)");
  assert.equal(near.outcome, "understood");
  const first = matchSpoken(JEWELLERY, "your jewellery", { stage: "a" });
  assert.equal(first.against, JEWELLERY.en);
});

test("Gesprochen: Verschiedene Schreibweisen", () => {
  assert.equal(spoken(unitOf("Please remove your jewellery."), "please remove your jewelry", "a"), "understood");
  assert.equal(spoken(unitOf("It starts at six o'clock.", ["six"]), "it starts at 6:00", "a"), "understood");
  assert.equal(spoken(unitOf("It starts at 6 o'clock.", ["6"]), "it starts at six o'clock", "b"), "understood");
  assert.equal(spoken(unitOf("We'll call you."), "well call you", "a"), "understood");
  assert.equal(spoken(unitOf("I can't help you."), "I cannot help you", "b"), "understood");
});

test("Das Ergebnis nennt keine confidence und die Vorgabe ist Stufe a", () => {
  const result = matchSpoken(JEWELLERY, "Please remove your jewellery now.");
  assert.deepEqual(Object.keys(result).sort(), ["against", "missingKeywords", "outcome", "words"]);
  assert.equal(result.outcome, "understood");
  assert.equal(matchSpoken(JEWELLERY, "jewellery take off").outcome, "partly");
});

// ----- deriveKeywords -----

test("deriveKeywords: Inhaltswörter ab 3 Zeichen, keine Funktionswörter, höchstens 4", () => {
  assert.deepEqual(deriveKeywords("Do you know if there is any metal in your knee?"), ["know", "metal", "knee"]);
  assert.deepEqual(deriveKeywords("Please follow me."), ["follow"]);
  assert.deepEqual(deriveKeywords("I will ask the doctor."), ["ask", "doctor"]);
  assert.deepEqual(deriveKeywords("A cat ran up on an ox."), ["cat", "ran"]);
  assert.deepEqual(deriveKeywords("Is the scan, the scan or the scan safe?"), ["scan", "safe"]);
  assert.deepEqual(deriveKeywords("Bring your coat, keys, phone, wallet and bag."), ["bring", "coat", "keys", "phone"]);
  assert.deepEqual(deriveKeywords("Don't worry, I'm here."), ["worry"]);
  assert.deepEqual(deriveKeywords("Something's wrong with the X-ray."), ["wrong", "x-ray"]);
  assert.deepEqual(deriveKeywords("Is that the 1957 scan?"), ["1957", "scan"]);
  assert.deepEqual(deriveKeywords(""), []);
  assert.deepEqual(deriveKeywords(null), []);
});

test("deriveKeywords: Die Ableitung wird im Abgleich erkannt", () => {
  for (const text of ["Don't worry, I'm here.", "Something's wrong with the X-ray.", "Is that the 1957 scan?"]) {
    const unit = { en: text, variants: [], keywords: deriveKeywords(text), softKeywords: true };
    assert.deepEqual(matchSpoken(unit, text, { stage: "b" }).missingKeywords, [], text);
  }
});

test("keywordLabel zeigt die erste Alternative", () => {
  assert.equal(keywordLabel("jewellery|jewelry"), "jewellery");
  assert.equal(keywordLabel("remove|take off"), "remove");
  assert.equal(keywordLabel("pacemaker"), "pacemaker");
});

// ----- Echte Sätze und freie Antworten -----

function spokenReal(id, text) {
  return spoken(REAL.unit(id), text, "b");
}

// Wie planSpeech eine Patientenäußerung für das Sprechen vorbereitet.
function reactionSnapshot(id) {
  const reaction = REAL.unit(id).reactions.find((item) => item.fits === true);
  return { en: reaction.en, variants: [], keywords: reactionKeywords(reaction), softKeywords: true };
}

test("Sicherheitssätze: Das Gegenteil gilt nie als gut verständlich", () => {
  for (const [id, text, outcome] of [
    ["ge.stillness.s01", "Please move.", "notUnderstood"],
    ["ge.stillness.s01", "You can move now.", "notUnderstood"],
    ["ge.contrast.s06", "Please tell me if you feel well.", "partly"],
    ["mr.changing.s02", "Please keep your watch, keys and cards with you.", "partly"],
    ["mr.changing.s02", "Please take your watch, keys and bank cards with you.", "partly"],
    ["rx.stillness.s02", "Please move until I tell you.", "partly"],
  ]) {
    assert.equal(spokenReal(id, text), outcome, id + ": " + text);
  }
  for (const [id, text] of [
    ["ge.stillness.s01", "Try not to move."],
    ["ge.stillness.s01", "Please don't move."],
    ["rx.stillness.s02", "Please try not to move until I tell you."],
    ["ge.contrast.s06", "Please tell me if you don't feel well."],
  ]) {
    assert.equal(spokenReal(id, text), "understood", id + ": " + text);
  }
});

test("Freie Antworten: Ein zusätzliches not kippt den Sinn und gilt höchstens als teilweise", () => {
  for (const [id, text] of [
    ["mr.anxiety.p04", "I can't stop the scan now."],
    ["mr.anxiety.p04", "We will not stop the scan, stay in there."],
    ["mr.noise.p02", "I will not stop the scan."],
    ["ge.safety.p02", "You don't need to ask the doctor first."],
    ["mr.safety.p07", "You don't need to ask the doctor first."],
    ["mr.safety.p01", "You do not need to wait or ask the doctor."],
  ]) {
    const result = matchSpoken(reactionSnapshot(id), text, { stage: "b" });
    assert.notEqual(result.outcome, "understood", id + ": " + text);
    assert.equal(result.negationFlip === true || result.outcome === "notUnderstood", true, id + ": " + text);
  }
  assert.equal(spoken(reactionSnapshot("mr.anxiety.p04"), "OK, I will stop the scan and bring you out.", "b"), "understood");
});

test("Freie Antworten: Eine beruhigende Wendung zählt nicht als zusätzliches not", () => {
  const anxiety = reactionSnapshot("mr.anxiety.p04");
  for (const text of [
    "Don't worry, I will stop the scan and bring you out.",
    "Do not worry. I will stop the scan and bring you out.",
    "Please don't worry. I will stop the scan and bring you out.",
    "I will stop the scan and bring you out, don't worry.",
    "Try not to worry, I will stop the scan and bring you out.",
    "Don't be afraid, I will stop the scan and bring you out.",
    "Please do not be afraid. I will stop the scan and bring you out.",
  ]) {
    const result = matchSpoken(anxiety, text, { stage: "b" });
    assert.equal(result.outcome, "understood", text);
    assert.equal(result.negationFlip, undefined, text);
  }
  // Das not der Musterantwort bleibt das einzige, das zählt.
  const noXrays = matchSpoken(reactionSnapshot("mr.procedure.p01"), "Don't worry, the scan does not use X-rays.", { stage: "b" });
  assert.equal(noXrays.outcome, "understood");
  assert.equal(noXrays.negationFlip, undefined);
});

test("Echte Daten: Was die App zum Beruhigen lehrt, ändert neben der passenden Reaktion das Ergebnis nicht", () => {
  const patient = REAL.allUnits().filter((unit) => unit.type === "patient");
  assert.ok(patient.length > 100);
  const reassure = REAL.unit("sb.reassure.s01");
  const taught = [reassure.en, ...reassure.variants];
  assert.ok(taught.includes("Try not to worry."));
  for (const unit of patient) {
    const snapshot = reactionSnapshot(unit.id);
    for (const form of [...taught, "Don't be afraid."]) {
      for (const text of [form + " " + snapshot.en, snapshot.en + " " + form]) {
        const result = matchSpoken(snapshot, text, { stage: "b" });
        assert.equal(result.outcome, "understood", unit.id + ": " + text);
        assert.equal(result.negationFlip, undefined, unit.id + ": " + text);
      }
    }
  }
});

test("Freie Antworten: Neben einer beruhigenden Wendung bleibt ein echtes not erkannt", () => {
  const anxiety = reactionSnapshot("mr.anxiety.p04");
  for (const text of [
    "I will not stop the scan, don't worry.",
    "Don't worry, I will not stop the scan.",
    "Try not to worry, I will not stop the scan.",
    "Don't be afraid, we can't stop the scan.",
    "Don't worry, I will never stop the scan.",
  ]) {
    const result = matchSpoken(anxiety, text, { stage: "b" });
    assert.equal(result.outcome, "partly", text);
    assert.equal(result.negationFlip, true, text);
  }
  // Steht die Wendung in der Musterantwort, verdeckt sie kein not in der Antwort. Sie zählt auf beiden Seiten nicht.
  for (const [id, text] of [
    ["sb.reassure.p01", "I am not here to help you."],
    ["ct.contrast.p02", "The dye can't feel like that."],
  ]) {
    assert.equal(matchSpoken(reactionSnapshot(id), text, { stage: "b" }).negationFlip, true, id + ": " + text);
  }
  const en = "Please do not be afraid. I will stay with you.";
  const afraid = { en, variants: [], keywords: deriveKeywords(en), softKeywords: true };
  assert.equal(matchSpoken(afraid, "I will not stay with you.", { stage: "b" }).negationFlip, true);
  assert.equal(matchSpoken(afraid, "Don't be afraid, I will stay with you.", { stage: "b" }).negationFlip, undefined);
});

test("Fester Satz: Fehlt das not der beruhigenden Wendung, bleibt das höchstens teilweise verstanden", () => {
  const reassure = REAL.unit("sb.reassure.s01");
  assert.equal(spokenReal("sb.reassure.s01", "Please don't worry."), "understood");
  assert.equal(spokenReal("sb.reassure.s01", "Please worry."), "partly");
  assert.equal(matchSpoken(reassure, "Please worry.", { stage: "b" }).negationFlip, true);
});

test("Freie Antworten: Was die abgeleiteten Schlüsselwörter messen, ist der Inhalt, nicht die Höflichkeit", () => {
  for (const [id, text] of [
    ["ge.contrast.p04", "I will get the doctor."],
    ["ge.safety.p01", "I will let the doctor know."],
    ["ct.contrast.p03", "Is it hard to breathe?"],
    ["ct.contrast.p03", "Can you breathe OK?"],
    ["mr.contrast.p02", "Are you having trouble breathing?"],
    ["sb.wellbeing.p02", "Oh, I'm sorry."],
  ]) {
    assert.equal(spoken(reactionSnapshot(id), text, "b"), "understood", id + ": " + text);
  }
  assert.equal(spoken(reactionSnapshot("ct.contrast.p03"), "Please drink some water.", "b"), "notUnderstood");
  assert.equal(spoken(reactionSnapshot("sb.wellbeing.p02"), "Good, I'm glad.", "b"), "notUnderstood");
  assert.deepEqual(deriveKeywords("Do you have any trouble breathing?"), ["breathe|breathing|breath"]);
  assert.deepEqual(deriveKeywords("I'm sorry to hear that."), ["sorry"]);
  assert.deepEqual(deriveKeywords("Thank you for telling me. I will get the doctor."), ["doctor"]);
  assert.deepEqual(deriveKeywords("Yes, you are doing really well."), []);
});

test("Stufe b: Richtige freie Antworten scheitern nicht am engen Schlüsselwort", () => {
  for (const [id, text] of [
    ["mr.safety.s11", "Have you ever been operated on?"],
    ["ge.safety.s05", "Do you have an allergy?"],
    ["ge.stillness.s05", "Take a big breath in."],
    ["ge.stillness.s05", "Please inhale."],
    ["ge.contrast.s09", "If you can't breathe, tell me at once."],
    ["ge.contrast.s09", "Tell me immediately if it is hard to breathe."],
    ["ge.contrast.s06", "Please say if you feel sick."],
    ["mr.noise.s01", "The machine is very noisy."],
    ["kl.rescue.s02", "Sorry, I can't tell you that."],
    ["ge.greeting.s04", "When is your birthday?"],
    ["mr.anxiety.s06", "We can get you out at any time."],
    ["mr.callbutton.s02", "If you need help, just press this button."],
    ["mr.stillness.s01", "Please keep very still, especially when it gets loud."],
    ["ct.stillness.s01", "Just breathe as normal until I say."],
    ["ct.contrast.s05", "You will get contrast through a vein."],
  ]) {
    assert.equal(spokenReal(id, text), "understood", id + ": " + text);
  }
  assert.notEqual(spokenReal("ge.stillness.s05", "Hold your breath."), "understood", "Das andere Atemkommando zählt nicht");
});

test("Stufe b: Sinnlich falsche Antworten gelten nicht als gut verständlich", () => {
  for (const [id, text] of [
    ["ge.stillness.s08", "Breathe in."],
    ["ge.stillness.s08", "Breathe out and hold."],
    ["ct.anxiety.s01", "The scanner is a long tunnel, not a ring."],
    ["mr.noise.s02", "Please take out your earplugs to protect your ears."],
    ["ge.contrast.s09", "Please keep breathing normally."],
    ["ge.changing.s04", "Please take off this gown."],
    ["ge.contrast.s02", "I will take the small tube out of your arm."],
  ]) {
    assert.notEqual(spokenReal(id, text), "understood", id + ": " + text);
  }
});

test("no zählt als Verneinung, am Satzanfang neben einem not ist es nur die Antwort", () => {
  assert.equal(spokenReal("mr.changing.s01", "No metal in the scan room, please."), "understood");
  assert.equal(spokenReal("ge.safety.s05", "You have no allergies."), "partly");
  assert.equal(spokenReal("mr.safety.s10", "You have no metal in your eyes."), "partly");
  assert.equal(matchSpoken(REAL.unit("ge.safety.s05"), "You have no allergies.", { stage: "b" }).negationFlip, true);
  const scan = unitOf("The scan does not hurt.", ["hurt"]);
  assert.equal(spoken(scan, "No, the scan does not hurt.", "b"), "understood");
  assert.equal(spoken(scan, "The scan does hurt.", "b"), "partly");
  assert.equal(typed(REAL.unit("kl.confirm.s05"), "So you have no allergies, is that right?"), "correct");
  assert.equal(matchTyped(REAL.unit("kl.confirm.s05"), "So you have allergies, is that right?").negationFlip, true);
});

test("Echte Daten: Die passende Reaktion erfüllt ihre Schlüsselwörter, eine falsche gilt nie als gut verständlich", () => {
  const patient = REAL.allUnits().filter((unit) => unit.type === "patient");
  assert.equal(patient.length, 148);
  for (const unit of patient) {
    const snapshot = reactionSnapshot(unit.id);
    const own = matchSpoken(snapshot, snapshot.en, { stage: "b" });
    assert.equal(own.outcome, "understood", unit.id);
    assert.deepEqual(own.missingKeywords, [], unit.id);
    for (const reaction of unit.reactions.filter((item) => item.fits !== true)) {
      assert.notEqual(spoken(snapshot, reaction.en, "b"), "understood", unit.id + ": " + reaction.en);
    }
  }
});

test("Zahlen und Namen: Ein falscher Wert gilt nicht als gut verständlich", () => {
  for (const [id, text] of [
    ["kl.numbers.p01", "So that is the 13th of March, 1971?"],
    ["kl.numbers.p01", "So that is the 23rd of March, 1981?"],
    ["kl.numbers.p02", "Thank you. So that is the twentieth of June?"],
    ["kl.numbers.p04", "No problem. So that is 1967?"],
    ["kl.numbers.p06", "Thank you. Five five five, oh one two four?"],
    ["kl.numbers.p09", "So your appointment is at quarter to ten?"],
    ["kl.spell.p01", "Let me check. H, A, R, I, S. Is that right?"],
    ["kl.spell.p02", "Thank you. So that is R, E, E, D?"],
  ]) {
    assert.notEqual(spoken(reactionSnapshot(id), text, "b"), "understood", id + ": " + text);
  }
  for (const [id, text] of [
    ["kl.numbers.p01", "So that is March 23, 1971?"],
    ["kl.numbers.p01", "The twenty third of March, nineteen seventy one?"],
    ["kl.numbers.p02", "So that is June 12?"],
    ["kl.numbers.p04", "So that is nineteen fifty seven?"],
    ["kl.numbers.p06", "555 0142?"],
    ["kl.numbers.p06", "Five five five, zero one four two."],
    ["kl.numbers.p09", "So your appointment is at 10:15?"],
    ["kl.spell.p01", "So that's H, A, double R, I, S?"],
    ["kl.spell.p01", "So that is Harris?"],
    ["kl.spell.p02", "So that is Reid?"],
  ]) {
    assert.equal(spoken(reactionSnapshot(id), text, "b"), "understood", id + ": " + text);
  }
});

test("Sachantworten: Ohne das not gilt die Antwort nicht als gut verständlich", () => {
  for (const [id, text] of [
    ["kl.patientquestions.p04", "The scan does hurt."],
    ["kl.patientquestions.p05", "You will feel some pain."],
    ["kl.patientquestions.p12", "The pictures may be clear."],
    ["mr.procedure.p01", "The scan does use X-rays."],
    ["ct.anxiety.p01", "The scanner is a long tunnel."],
  ]) {
    assert.notEqual(spoken(reactionSnapshot(id), text, "b"), "understood", id + ": " + text);
  }
  for (const [id, text] of [
    ["kl.patientquestions.p04", "It doesn't hurt."],
    ["kl.patientquestions.p04", "No, it won't hurt."],
    ["kl.patientquestions.p05", "You should not feel anything."],
    ["kl.patientquestions.p12", "We may have to do it again."],
    ["mr.procedure.p01", "It doesn't use X-rays."],
    ["mr.procedure.p01", "No, it uses a magnet."],
    ["ct.anxiety.p01", "It is only a ring."],
  ]) {
    assert.equal(spoken(reactionSnapshot(id), text, "b"), "understood", id + ": " + text);
  }
});

test("Warnzeichen: Nachfragen oder Hilfe holen gilt, ein Atemkommando nicht", () => {
  for (const id of ["ct.contrast.p03", "mr.contrast.p02"]) {
    for (const text of ["Please hold your breath.", "Breathe in.", "Keep breathing normally."]) {
      assert.notEqual(spoken(reactionSnapshot(id), text, "b"), "understood", id + ": " + text);
    }
    for (const text of ["Is it hard to breathe?", "Do you have trouble breathing?", "Can you breathe OK?", "I will get the doctor."]) {
      assert.equal(spoken(reactionSnapshot(id), text, "b"), "understood", id + ": " + text);
    }
  }
  assert.equal(spoken(reactionSnapshot("mr.contrast.p02"), "How do you feel?", "b"), "understood");
  assert.equal(spoken(reactionSnapshot("ge.contrast.p02"), "How do you feel?", "b"), "understood");
  assert.notEqual(spoken(reactionSnapshot("ge.safety.p01"), "Your doctor will explain the results.", "b"), "understood");
  assert.equal(spoken(reactionSnapshot("ge.safety.p01"), "I will tell the doctor.", "b"), "understood");
});

test("Freie Antworten: Kurze natürliche Antworten gelten, Unpassendes nicht", () => {
  for (const [id, text] of [
    ["ge.stillness.p01", "Tell me."],
    ["ge.stillness.p01", "Please tell me."],
    ["mr.callbutton.p02", "I can hear you."],
    ["mr.anxiety.p04", "I will get you out."],
    ["kl.patientquestions.p13", "Please stay still."],
    ["mr.stillness.p01", "Please stay still."],
    ["mr.callbutton.p01", "Press the button."],
    ["ge.closing.p02", "Your doctor will tell you."],
    ["ge.procedure.p03", "What are you worried about?"],
    ["kl.patientquestions.p21", "Yes, you can."],
  ]) {
    assert.equal(spoken(reactionSnapshot(id), text, "b"), "understood", id + ": " + text);
  }
  assert.equal(spoken(reactionSnapshot("mr.callbutton.p02"), "You can go home now.", "b"), "notUnderstood");
  assert.equal(spoken(reactionSnapshot("mr.callbutton.p02"), "I cannot hear you.", "b"), "partly");
});

function assertNotUnderstood(cases) {
  for (const [id, text] of cases) {
    assert.notEqual(spoken(reactionSnapshot(id), text, "b"), "understood", id + ": " + text);
  }
}

function assertUnderstood(cases) {
  for (const [id, text] of cases) {
    const result = matchSpoken(reactionSnapshot(id), text, { stage: "b" });
    assert.equal(result.outcome, "understood", id + ": " + text);
    assert.equal(result.negationFlip, undefined, id + ": " + text);
  }
}

test("Warnzeichen und Implantat: Verharmlosen gilt nicht, Nachfragen und Nachsehen gelten", () => {
  assertNotUnderstood([
    ["ct.contrast.p03", "Don't worry, you can breathe OK."],
    ["ct.contrast.p03", "Your breathing is fine, don't worry."],
    ["ge.contrast.p02", "That is normal, you may feel warm."],
    ["ge.contrast.p02", "You will feel fine."],
    ["mr.safety.p04", "A pacemaker is fine, don't worry."],
  ]);
  assertUnderstood([
    ["ct.contrast.p03", "Are you short of breath?"],
    ["mr.contrast.p02", "Are you short of breath?"],
    ["ct.contrast.p03", "Can you swallow?"],
    ["ge.contrast.p02", "Let me look at your arm."],
    ["ge.contrast.p02", "Is it painful?"],
    ["mr.safety.p04", "Is it a pacemaker?"],
    ["mr.safety.p04", "What kind of device is it?"],
  ]);
});

test("No need kippt den Sinn wie ein not", () => {
  for (const [id, text] of [
    ["ge.contrast.p04", "No need to get the doctor."],
    ["mr.safety.p01", "No need to tell the doctor."],
    ["ct.contrast.p03", "No need to call the doctor."],
  ]) {
    const result = matchSpoken(reactionSnapshot(id), text, { stage: "b" });
    assert.equal(result.outcome, "partly", id + ": " + text);
    assert.equal(result.negationFlip, true, id + ": " + text);
  }
});

test("Hinter no steht nichts dazwischen, hinter not wenig", () => {
  assertNotUnderstood([
    ["mr.procedure.p01", "No, it uses X-rays."],
    ["kl.patientquestions.p04", "No, you will feel pain."],
    ["kl.patientquestions.p04", "I'm not sure, you may feel pain."],
    ["ct.anxiety.p01", "The scanner is a long tunnel, not a ring."],
  ]);
  assertUnderstood([
    ["kl.patientquestions.p04", "It is not going to hurt."],
    ["kl.patientquestions.p04", "It will not really hurt."],
    ["kl.patientquestions.p04", "There is no pain."],
    ["mr.procedure.p01", "It uses no X-rays."],
  ]);
});

test("Eine Verneinung in der getroffenen Alternative ist keine dazugekommene", () => {
  assertUnderstood([
    ["kl.patientquestions.p13", "Please don't move."],
    ["mr.stillness.p01", "Please don't move."],
    ["ge.procedure.p01", "I'm not sure."],
    ["ge.closing.p01", "I can't tell you."],
    ["ct.procedure.p01", "No, this is not an MRI."],
    ["sb.greeting.p03", "No, I'm not the doctor."],
  ]);
});

test("Ein Allerweltswort genügt nicht", () => {
  assertNotUnderstood([
    ["ge.safety.p03", "No problem."],
    ["ge.greeting.p03", "Sorry, Mr Harris. Please come with me."],
    ["rx.changing.p03", "No problem, please turn to your left."],
    ["mr.anxiety.p04", "Please stop moving and keep very still."],
    ["rx.procedure.p02", "Yes, it is a little dangerous."],
    ["mr.closing.p01", "Yes, drive home and relax."],
  ]);
  assertUnderstood([
    ["ge.greeting.p03", "Sorry, Mr Hill."],
    ["mr.anxiety.p04", "I am stopping the scan."],
    ["mr.anxiety.p04", "OK, I'm coming."],
  ]);
});

test("Fester Satz: Ein gekippter Sicherheitssatz rettet sich nicht über eine Fassung", () => {
  assert.equal(spokenReal("ge.contrast.s09", "Please tell me right away if you can breathe."), "partly");
  assert.notEqual(spokenReal("ct.contrast.s08", "It only feels like that. You are really peeing."), "understood");
  assert.equal(spokenReal("ct.contrast.s08", "It only feels like that. It is normal."), "understood");
});

test("Naheliegende richtige Antworten fallen nicht durch", () => {
  assertUnderstood([
    ["ge.safety.p01", "I need to ask the radiologist."],
    ["ge.safety.p01", "The doctor needs to know that."],
    ["ge.safety.p03", "I will tell the doctor."],
    ["ge.safety.p09", "I will tell the doctor."],
    ["ct.safety.p02", "I will tell the doctor."],
    ["kl.patientquestions.p22", "Did you take any tablets?"],
    ["mr.closing.p01", "Did you have any sedation?"],
    ["kl.patientquestions.p05", "You will feel nothing."],
    ["ge.greeting.p02", "Let me check."],
  ]);
});

test("Zahlen: Mischformen der Erkennung gelten, eine falsche Nummer nicht", () => {
  assertUnderstood([
    ["kl.numbers.p06", "555 oh one four two."],
    ["kl.numbers.p06", "555 O 142."],
    ["kl.numbers.p06", "555 0 142."],
    ["kl.numbers.p06", "Five five five O one four two."],
    ["kl.numbers.p06", "Triple five oh one four two."],
    ["kl.numbers.p09", "So your appointment is at quarter after ten?"],
  ]);
  assertNotUnderstood([
    ["kl.numbers.p06", "555 oh one two four."],
    ["kl.numbers.p09", "So your appointment is at quarter to ten?"],
  ]);
});

test("Einstufung: Fehlt beim Schreiben das unless, kippt der Satz", () => {
  const placement = JSON.parse(readFileSync(new URL("../daten/einstufung.json", import.meta.url), "utf8"));
  const item = placement.forms.flatMap((form) => form.items).find((entry) => entry.id === "pl.a.wr04");
  assert.equal(typed(item, "If you have been told otherwise, you can eat and drink as normal."), "wrong");
  for (const text of [item.en, ...item.variants]) {
    assert.equal(typed(item, text), "correct", text);
  }
});

test("Beruhigende Wendungen: Auch die natürlichen, die die App nicht lehrt, kippen keinen Sinn", () => {
  const forms = [
    "Don't you worry.", "You don't need to worry.", "You don't have to worry.", "Don't be scared.", "Don't panic.", "Don't be nervous.", "Never mind.", "Try not to be afraid.",
    "You don't need to be afraid.", "You don't have to be nervous.", "Don't be worried.", "Don't you be afraid.", "No need to worry.", "No worries.", "Never fear.",
  ];
  for (const unit of REAL.allUnits().filter((item) => item.type === "patient")) {
    const snapshot = reactionSnapshot(unit.id);
    for (const form of forms) {
      const result = matchSpoken(snapshot, form + " " + snapshot.en, { stage: "b" });
      assert.equal(result.outcome, "understood", unit.id + ": " + form);
      assert.equal(result.negationFlip, undefined, unit.id + ": " + form);
    }
  }
  const anxiety = reactionSnapshot("mr.anxiety.p04");
  assert.equal(matchSpoken(anxiety, "You don't need to worry, I will not stop the scan.", { stage: "b" }).negationFlip, true);
  assert.equal(matchSpoken(anxiety, "Don't panic, we can't stop the scan.", { stage: "b" }).negationFlip, true);
});

test("Fester Satz: Eine dazugekommene beruhigende Wendung dreht nichts um, ein echtes not bleibt erkannt", () => {
  const sentences = REAL.allUnits().filter((unit) => unit.type === "sentence");
  assert.equal(sentences.length, 325);
  for (const unit of sentences) {
    for (const form of ["Don't worry.", "No need to worry.", "You don't need to be afraid."]) {
      const result = matchSpoken(unit, form + " " + unit.en, { stage: "b" });
      assert.equal(result.outcome, "understood", unit.id + ": " + form);
      assert.equal(result.negationFlip, undefined, unit.id + ": " + form);
    }
  }
  assert.equal(typed(REAL.unit("ge.stillness.s08"), "Don't worry, you can breathe normally now."), "correct");
  // Das not der Wendung ist kein not move.
  for (const text of ["Don't worry, please move.", "Don't worry, you can move now."]) {
    assert.notEqual(spokenReal("ge.stillness.s01", text), "understood", text);
  }
  assert.equal(spokenReal("ge.stillness.s01", "Don't worry, please don't move."), "understood");
  assert.notEqual(spoken(reactionSnapshot("kl.patientquestions.p04"), "Don't worry, it will hurt.", "b"), "understood");
  const noMove = unitOf("Please do not move.", ["move"]);
  assert.equal(spoken(noMove, "Don't worry, please move.", "b"), "partly");
  assert.equal(matchSpoken(noMove, "Don't worry, please move.", { stage: "b" }).negationFlip, true);
  assert.equal(spoken(noMove, "Don't worry, please do not move.", "b"), "understood");
});

test("Stufe b: Geschärfte Schlüsselwörter lassen richtige Antworten durch, falsche nicht", () => {
  for (const [id, text] of [
    ["ge.stillness.s08", "You can breathe now."],
    ["ge.stillness.s08", "Now you can breathe."],
    ["ge.changing.s04", "Please wear this gown."],
    ["ge.contrast.s02", "The doctor will insert a small tube in your arm."],
    ["ge.contrast.s02", "I will place a small tube in your arm."],
    ["mr.noise.s02", "Please use these earplugs to protect your ears."],
    ["ct.anxiety.s01", "The scanner is a ring, not a tunnel."],
  ]) {
    assert.equal(spokenReal(id, text), "understood", id + ": " + text);
  }
  for (const [id, text] of [
    ["ge.changing.s04", "Take off your gown."],
    ["ge.contrast.s02", "The doctor will take the tube out of your arm."],
    ["ct.anxiety.s01", "It is only a ring."],
  ]) {
    assert.notEqual(spokenReal(id, text), "understood", id + ": " + text);
  }
});

test("Getippt: Natürliche Fassungen wichtiger Sätze gelten als richtig", () => {
  for (const [id, text] of [
    ["ge.stillness.s01", "Please stay still."],
    ["ge.stillness.s01", "Please hold still."],
    ["ge.contrast.s06", "Please let me know if you feel unwell."],
    ["ge.contrast.s06", "If you feel unwell, please tell me."],
    ["ge.contrast.s06", "Please tell me if you feel sick."],
    ["mr.callbutton.s02", "If you need help, please press the buzzer."],
    ["sb.greeting.s02", "Hello, I'm Anna."],
    ["ge.greeting.s02", "Hello, I'm Anna, your radiographer."],
    ["rx.changing.s05", "Please turn left."],
    ["kl.spell.s03", "Can you spell that?"],
  ]) {
    assert.equal(typed(REAL.unit(id), text), "correct", id + ": " + text);
  }
});
