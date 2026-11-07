import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXAMS, SCENARIO_ORDER, UNIT_FILES, buildContent, loadContent } from "../js/core/content.js";

const MINI = JSON.parse(readFileSync(new URL("./fixtures/content-mini.json", import.meta.url), "utf8"));

function readData(name) {
  return JSON.parse(readFileSync(new URL("../daten/" + name + ".json", import.meta.url), "utf8"));
}

const UNIT_FIELDS = [
  "id", "type", "file", "sectionId", "sectionKey", "strand", "exams", "en", "variants", "keywords",
  "situationDe", "meaningDe", "noteDe", "cefr", "core", "clinicDependent", "kind", "reactions", "source",
];

// Alle Einheiten direkt aus den Dateien, ohne den Code unter Test.
function rawEntries(files) {
  const entries = [];
  for (const name of UNIT_FILES) {
    const header = files[name];
    for (const section of header.sections) {
      for (const raw of section.sentences ?? []) entries.push({ raw, type: "sentence", header, section });
      for (const raw of section.patient ?? []) entries.push({ raw, type: "patient", header, section });
    }
    for (const raw of header.words ?? []) entries.push({ raw, type: "word", header, section: null });
  }
  return entries;
}

function idsOf(content, exam) {
  return content.examSections(exam).map((section) => [section.key, section.unitIds]);
}

// ----- Verhalten mit einem kleinen Beispiel -----

test("loadContent holt jede Datei einmal und nimmt auch Versprechen an", async () => {
  const asked = [];
  const content = await loadContent(async (name) => {
    asked.push(name);
    return MINI[name];
  });
  assert.deepEqual([...asked].sort(), Object.keys(MINI).sort());
  assert.equal(content.allUnits().length, rawEntries(MINI).length);
});

test("Eine Patientenäußerung aus gemeinsam trägt exams, Hinweis und Klinikvermerk", () => {
  const content = buildContent(MINI);
  const unit = content.unit("ge.safety.p01");
  assert.equal(unit.type, "patient");
  assert.equal(unit.file, "gemeinsam");
  assert.equal(unit.sectionId, "ge.safety");
  assert.equal(unit.sectionKey, "safety");
  assert.equal(unit.strand, "radiology");
  assert.deepEqual(unit.exams, ["mri", "xray"]);
  assert.equal(unit.clinicDependent, true);
  assert.equal(unit.noteDe, "Hinweis zur Äußerung.");
  assert.equal(unit.kind, "unclear");
  assert.equal(unit.reactions.length, 3);
  assert.equal(unit.reactions[0].clinicDependent, true);
  assert.deepEqual(unit.keywords, []);
  assert.equal(unit.situationDe, null);
  assert.equal(unit.core, false);
});

test("Ein Satz trägt die vereinbarten Felder", () => {
  const unit = buildContent(MINI).unit("ge.safety.s02");
  assert.deepEqual(Object.keys(unit).sort(), [...UNIT_FIELDS].sort());
  assert.equal(unit.type, "sentence");
  assert.equal(unit.en, "Could you be pregnant?");
  assert.equal(unit.core, true);
  assert.equal(unit.clinicDependent, true);
  assert.equal(unit.noteDe, "Ein kurzer Hinweis.");
  assert.equal(unit.kind, null);
  assert.deepEqual(unit.reactions, []);
  assert.deepEqual(unit.source, { ref: "quelle-a", locator: "Abschnitt 4" });
});

test("exams kommt aus der Datei, aus dem Feld oder bleibt leer", () => {
  const content = buildContent(MINI);
  assert.deepEqual(content.unit("mr.noise.s01").exams, ["mri"]);
  assert.deepEqual(content.unit("rx.safety.s01").exams, ["xray"]);
  assert.deepEqual(content.unit("ge.anxiety.s01").exams, ["mri", "ct"]);
  assert.deepEqual(content.unit("sb.questions.s01").exams, []);
  assert.deepEqual(content.unit("kl.repeat.p01").exams, []);
});

test("Ein Wort hat keinen Abschnitt, gemeinsame Wörter gelten für alle Untersuchungen", () => {
  const content = buildContent(MINI);
  const shared = content.unit("ge.w.scan");
  assert.equal(shared.type, "word");
  assert.equal(shared.sectionId, null);
  assert.equal(shared.sectionKey, null);
  assert.deepEqual(shared.exams, EXAMS);
  assert.notEqual(shared.exams, EXAMS);
  assert.deepEqual(content.unit("mr.w.coil").exams, ["mri"]);
  assert.equal(content.unit("mr.w.coil").noteDe, "Ein Wort aus dem MRT.");
});

test("words liefert gemeinsame Wörter zuerst und nur die der Untersuchung", () => {
  const content = buildContent(MINI);
  const ids = (exam) => content.words(exam).map((unit) => unit.id);
  assert.deepEqual(ids("mri"), ["ge.w.scan", "mr.w.coil"]);
  assert.deepEqual(ids("ct"), ["ge.w.scan", "ct.w.table"]);
  assert.deepEqual(ids("xray"), ["ge.w.scan", "rx.w.plate"]);
  assert.deepEqual(ids("gibt-es-nicht"), []);
  assert.equal(content.words().length, 4);
});

test("unit und allUnits", () => {
  const content = buildContent(MINI);
  assert.equal(content.unit("gibt.es.nicht"), null);
  const all = content.allUnits();
  const count = all.length;
  all.pop();
  assert.equal(content.allUnits().length, count);
});

test("source nimmt die ID oder das Feld source einer Einheit", () => {
  const content = buildContent(MINI);
  assert.equal(content.source("quelle-a").title, "Beispielquelle A");
  assert.equal(content.source("quelle-a").locator, null);
  const full = content.source(content.unit("ge.safety.p01").source);
  assert.equal(full.title, "Beispielquelle B");
  assert.equal(full.publisher, "Beispielverlag");
  assert.equal(full.url, "beispiel/b.html");
  assert.equal(full.retrieved, "2026-11-07");
  assert.equal(full.locator, "Teil 3");
  assert.equal(content.source("gibt-es-nicht"), null);
  assert.equal(content.source({ ref: "gibt-es-nicht", locator: "x" }), null);
  assert.equal(content.source(null), null);
  assert.equal(content.source(undefined), null);
});

test("sections liefert alle Abschnitte mit den vereinbarten Feldern", () => {
  const content = buildContent(MINI);
  const sections = content.sections();
  const grammar = sections.find((section) => section.id === "sb.questions");
  assert.deepEqual(grammar, {
    id: "sb.questions",
    key: "questions",
    titleDe: "Fragen stellen",
    strand: "grammar",
    file: "satzbau",
    exam: null,
    explanationDe: "Eine Regel und ein Merksatz.",
    explanationSource: { ref: "quelle-a", locator: "Abschnitt 1" },
    unitIds: ["sb.questions.s01"],
  });
  const own = sections.find((section) => section.id === "mr.safety");
  assert.equal(own.exam, "mri");
  assert.equal(own.explanationDe, null);
  assert.equal(own.explanationSource, null);
  assert.deepEqual(own.unitIds, ["mr.safety.s01", "mr.safety.p01"]);
  assert.equal(sections.find((section) => section.id === "ge.safety").exam, null);
  assert.equal(sections.length, 10);
});

test("examSections ordnet nach SCENARIO_ORDER, gemeinsame zuerst, nur passende exams", () => {
  const content = buildContent(MINI);
  assert.deepEqual(idsOf(content, "mri"), [
    ["greeting", ["ge.greeting.s01"]],
    ["safety", ["ge.safety.s01", "ge.safety.p01", "mr.safety.s01", "mr.safety.p01"]],
    ["anxiety", ["ge.anxiety.s01"]],
    ["noise", ["mr.noise.s01"]],
    ["closing", ["ge.closing.s01"]],
  ]);
  assert.deepEqual(idsOf(content, "ct"), [
    ["greeting", ["ge.greeting.s01"]],
    ["safety", ["ge.safety.s01", "ge.safety.s02", "ct.safety.s01"]],
    ["anxiety", ["ge.anxiety.s01"]],
    ["closing", ["ge.closing.s01"]],
  ]);
  assert.deepEqual(idsOf(content, "xray"), [
    ["greeting", ["ge.greeting.s01"]],
    ["safety", ["ge.safety.s02", "ge.safety.p01", "rx.safety.s01"]],
    ["closing", ["ge.closing.s01"]],
  ]);
  assert.deepEqual(content.examSections("gibt-es-nicht"), []);
});

test("examSections liefert genau key, titleDe und unitIds", () => {
  const [first] = buildContent(MINI).examSections("mri");
  assert.deepEqual(first, { key: "greeting", titleDe: "Begrüßung", unitIds: ["ge.greeting.s01"] });
});

test("cases und checklist kommen aus faelle", () => {
  const content = buildContent(MINI);
  assert.deepEqual(content.cases, MINI.faelle.cases);
  assert.deepEqual(content.checklist, MINI.faelle.checklist);
});

// ----- Die echten Daten aus daten/ -----

const FILES = Object.fromEntries([...UNIT_FILES, "faelle", "quellen"].map((name) => [name, readData(name)]));
const REAL = await loadContent((name) => readData(name));
const ENTRIES = rawEntries(FILES);

test("Daten: Kopf jeder Datei", () => {
  for (const name of UNIT_FILES) {
    assert.equal(FILES[name].formatVersion, 1, name);
    assert.equal(FILES[name].file, name);
  }
  assert.equal(FILES.satzbau.strand, "grammar");
  assert.equal(FILES.klaeren.strand, "clarify");
  assert.equal(FILES.mrt.exam, "mri");
  assert.equal(FILES.ct.exam, "ct");
  assert.equal(FILES.roentgen.exam, "xray");
});

test("Daten: alle IDs sind eindeutig", () => {
  const ids = [];
  for (const name of UNIT_FILES) {
    ids.push(...FILES[name].sections.map((section) => section.id));
  }
  ids.push(...ENTRIES.map((entry) => entry.raw.id));
  ids.push(...FILES.faelle.checklist.map((item) => item.id));
  for (const item of FILES.faelle.cases) {
    ids.push(item.id, ...item.answers.map((answer) => answer.id), ...item.twists.map((twist) => twist.id));
  }
  ids.push(...FILES.quellen.sources.map((source) => source.id));
  const seen = new Set();
  const repeated = ids.filter((id) => seen.size === seen.add(id).size);
  assert.deepEqual(repeated, []);
});

test("Daten: jede Einheit aus den Dateien ist da und vollständig aufbereitet", () => {
  assert.equal(REAL.allUnits().length, ENTRIES.length);
  for (const { raw, type, header, section } of ENTRIES) {
    const unit = REAL.unit(raw.id);
    assert.ok(unit, raw.id);
    assert.deepEqual(Object.keys(unit).sort(), [...UNIT_FIELDS].sort(), raw.id);
    assert.equal(unit.type, type, raw.id);
    assert.equal(unit.file, header.file, raw.id);
    assert.equal(unit.strand, header.strand, raw.id);
    assert.equal(unit.sectionId, section ? section.id : null, raw.id);
    assert.equal(unit.sectionKey, section ? section.key : null, raw.id);
    assert.equal(unit.en, raw.en, raw.id);
    assert.deepEqual(unit.variants, raw.variants, raw.id);
    assert.deepEqual(unit.keywords, raw.keywords ?? [], raw.id);
    assert.equal(unit.noteDe, raw.noteDe ?? null, raw.id);
    assert.equal(unit.clinicDependent, raw.clinicDependent === true, raw.id);
    assert.equal(unit.core, raw.core === true, raw.id);
    assert.equal(unit.kind, raw.kind ?? null, raw.id);
    assert.deepEqual(unit.reactions, raw.reactions ?? [], raw.id);
    assert.deepEqual(unit.source, raw.source, raw.id);
  }
});

test("Daten: jede Einheit findet ihre Quelle", () => {
  for (const unit of REAL.allUnits()) {
    const source = REAL.source(unit.source);
    assert.ok(source, unit.id + " sucht " + JSON.stringify(unit.source));
    assert.ok(source.title && source.publisher && source.url && source.retrieved, unit.id);
    assert.ok(source.locator, unit.id);
    for (const reaction of unit.reactions) {
      assert.ok(REAL.source(reaction.source), unit.id + " Reaktion " + reaction.en);
    }
  }
});

test("Daten: auch Erklärungen und Fälle finden ihre Quelle", () => {
  for (const section of REAL.sections()) {
    if (section.explanationSource) {
      assert.ok(REAL.source(section.explanationSource), section.id);
    }
  }
  for (const item of REAL.cases) {
    for (const entry of [...item.answers, ...item.twists]) {
      assert.ok(REAL.source(entry.source), entry.id);
    }
  }
});

test("Daten: Patientenäußerungen haben genau eine passende Reaktion", () => {
  const patient = REAL.allUnits().filter((unit) => unit.type === "patient");
  assert.ok(patient.length > 0);
  for (const unit of patient) {
    assert.equal(unit.reactions.filter((reaction) => reaction.fits === true).length, 1, unit.id);
    assert.ok(unit.reactions.filter((reaction) => reaction.fits === false).length >= 2, unit.id);
  }
});

test("Daten: Szenarien je Untersuchung", () => {
  const keys = (exam) => REAL.examSections(exam).map((section) => section.key);
  assert.equal(SCENARIO_ORDER.length, 10);
  assert.deepEqual(keys("mri"), SCENARIO_ORDER);
  assert.deepEqual(keys("ct"), SCENARIO_ORDER.filter((key) => key !== "noise"));
  assert.deepEqual(keys("xray"), SCENARIO_ORDER.filter((key) => !["anxiety", "callButton", "noise"].includes(key)));
});

test("Daten: Röntgen enthält keine gemeinsame Einheit zu Platzangst und Klingel", () => {
  const shared = REAL.allUnits().filter((unit) => unit.file === "gemeinsam" && unit.type !== "word");
  for (const unit of shared.filter((item) => ["anxiety", "callButton", "noise"].includes(item.sectionKey))) {
    assert.equal(unit.exams.includes("xray"), false, unit.id);
  }
});

test("Daten: jeder Abschnitt aus gemeinsam und den Untersuchungen gehört zu einem Szenario", () => {
  for (const section of REAL.sections().filter((item) => item.strand === "radiology")) {
    assert.ok(SCENARIO_ORDER.includes(section.key), section.id);
  }
});

test("Daten: gemeinsame Einheiten erscheinen genau bei den Untersuchungen aus exams", () => {
  const shared = REAL.allUnits().filter((unit) => unit.file === "gemeinsam" && unit.type !== "word");
  assert.ok(shared.length > 0);
  for (const unit of shared) {
    assert.ok(unit.exams.length >= 2, unit.id);
  }
  for (const exam of EXAMS) {
    const listed = REAL.examSections(exam).flatMap((section) => section.unitIds);
    assert.equal(new Set(listed).size, listed.length, exam + " nennt eine Einheit doppelt");
    for (const unit of shared) {
      assert.equal(listed.includes(unit.id), unit.exams.includes(exam), unit.id + " bei " + exam);
    }
  }
});

test("Daten: eigene Einheiten erscheinen nur bei ihrer Untersuchung, gemeinsame stehen davor", () => {
  for (const exam of EXAMS) {
    const own = REAL.allUnits().filter((unit) => unit.file !== "gemeinsam" && unit.type !== "word" && unit.exams.includes(exam));
    const listed = REAL.examSections(exam).flatMap((section) => section.unitIds);
    for (const unit of own) {
      assert.ok(listed.includes(unit.id), unit.id);
    }
    for (const section of REAL.examSections(exam)) {
      const files = section.unitIds.map((id) => REAL.unit(id).file);
      const firstOwn = files.findIndex((file) => file !== "gemeinsam");
      if (firstOwn >= 0) {
        assert.ok(files.slice(firstOwn).every((file) => file !== "gemeinsam"), exam + " " + section.key);
      }
      for (const id of section.unitIds) {
        assert.ok(REAL.unit(id).exams.includes(exam), id + " bei " + exam);
      }
    }
  }
});

test("Daten: Wörter je Untersuchung", () => {
  const sharedWords = FILES.gemeinsam.words.map((word) => word.id);
  const expected = { mri: FILES.mrt.words, ct: FILES.ct.words, xray: FILES.roentgen.words };
  assert.ok(sharedWords.length > 0);
  for (const exam of EXAMS) {
    assert.deepEqual(
      REAL.words(exam).map((unit) => unit.id),
      [...sharedWords, ...expected[exam].map((word) => word.id)],
      exam,
    );
  }
});

test("Daten: Fälle und Prüfpunkte", () => {
  assert.deepEqual(REAL.checklist.map((item) => item.id), ["fa.check.1", "fa.check.2", "fa.check.3", "fa.check.4", "fa.check.5"]);
  for (const exam of EXAMS) {
    assert.deepEqual(
      REAL.cases.filter((item) => item.exam === exam).map((item) => [item.id, item.type]),
      [["fa." + exam + ".1", "practice"], ["fa." + exam + ".2", "practice"], ["fa." + exam + ".3", "final"]],
    );
  }
});

test("Daten: Grammatik-Abschnitte haben eine Erklärung, der Strang stimmt", () => {
  const grammarOnly = REAL.sections().filter((section) => section.explanationDe !== null);
  assert.ok(grammarOnly.length > 0);
  for (const section of grammarOnly) {
    assert.equal(section.file, "satzbau", section.id);
    assert.ok(section.explanationSource, section.id);
  }
  for (const section of REAL.sections()) {
    assert.deepEqual(section.unitIds.map((id) => REAL.unit(id).sectionId), section.unitIds.map(() => section.id), section.id);
  }
});
