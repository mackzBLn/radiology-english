import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadContent } from "../js/core/content.js";
import { deriveKeywords, keywordLabel, matchSpoken, matchTyped } from "../js/core/matcher.js";

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
