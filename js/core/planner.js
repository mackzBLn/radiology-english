/*
 * Plant die Übungen für Bahn und Sprechen. Ändert den Lernstand nicht. Zufall kommt als rng, gleicher rng heißt gleicher Plan.
 * Die Pläne bestehen nur aus JSON-Werten, damit sie in der Sitzung liegen können. answer gibt es nur bei buildSentence.
 */

import { EXAMS } from "./content.js";
import { toDateString } from "./dates.js";
import { matchTyped, reactionKeywords } from "./matcher.js";
import { normalizeText, surfaceWords, tokens } from "./normalize.js";
import { isDue, isNew, isWeak } from "./srs.js";
import { unitState } from "./state.js";

const NEW_UNIT_LIMIT = 15;
const WRONG_OPTIONS = 3;
// Ab diesem Anteil gemeinsamer Wörter, bezogen auf den kürzeren Text, kann auch die falsche Antwort passen.
const SIMILAR_OVERLAP = 0.7;
const TRAIN_WEIGHTS = { sentence: 3, patient: 2, word: 1 };
const SPEECH_WEIGHTS = { sentence: 3, patient: 2 };
// Ein neuer Satz belegt zwei Plätze: present und gleich danach pickEnglish.
const TRAIN_COSTS = { sentence: 2, patient: 1, word: 1 };
const SPEECH_COSTS = { sentence: 1, patient: 1 };

const KINDS = {
  sentence: ["present", "pickEnglish", "hearMeaning", "buildSentence", "typeSentence"],
  patient: ["hearReact"],
  word: ["wordHear", "wordPick"],
};

/*
 * Paare, die canAlsoBeRight nicht erkennt, weil die Wörter verschieden sind. Der andere Satz wäre in dieser Lage auch richtig.
 * ge.contrast.s05 beruhigt bei warmem Gefühl und Geschmack. Bei den Warnzeichen darf das keine Antwort zum Antippen sein.
 */
const NOT_TOGETHER = [
  ["rx.stillness.s01", "rx.stillness.s02"],
  ["ge.callbutton.s02", "ge.callbutton.s03"],
  ["mr.closing.s02", "mr.closing.s03"],
  ["sb.wellbeing.s05", "sb.wellbeing.s06"],
  ["kl.repeat.s02", "kl.repeat.s03"],
  ["sb.waiting.s03", "sb.waiting.s04"],
  ["sb.reassure.s06", "sb.reassure.s07"],
  ["sb.reassure.s04", "sb.reassure.s05"],
  ["ge.stillness.s07", "ge.stillness.s08"],
  ["kl.rescue.s02", "kl.rescue.s03"],
  ["sb.tenses.s04", "sb.tenses.s13"],
  ["ge.contrast.s05", "ge.contrast.s06"],
  ["ge.contrast.s05", "ge.contrast.s09"],
  ["ge.contrast.s05", "ge.contrast.s13"],
  ["ge.contrast.s05", "ge.contrast.s14"],
];

function excludedTogether(a, b) {
  return NOT_TOGETHER.some(([first, second]) => (first === a && second === b) || (first === b && second === a));
}

function shuffle(list, rng) {
  const result = [...list];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.min(Math.floor(rng() * (index + 1)), index);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function byKeys(...keys) {
  return (a, b) => {
    for (const key of keys) {
      const left = key(a);
      const right = key(b);
      if (left < right) {
        return -1;
      }
      if (left > right) {
        return 1;
      }
    }
    return 0;
  };
}

// ----- Falsche Antworten -----

function formsOf(unit) {
  return [unit.en, ...unit.variants].map(normalizeText);
}

function keywordsOf(unit) {
  return unit.keywords.flatMap((keyword) => keyword.split("|")).map(normalizeText);
}

// Dieselbe Fassung oder dieselbe Bedeutung: Das wäre gar keine falsche Antwort.
function meansTheSame(candidate, unit) {
  const forms = formsOf(unit);
  const meaning = normalizeText(unit.meaningDe);
  return formsOf(candidate).some((form) => forms.includes(form)) || (meaning !== "" && normalizeText(candidate.meaningDe) === meaning);
}

function sharesKeyword(candidate, unit) {
  const keywords = keywordsOf(unit);
  return keywordsOf(candidate).some((keyword) => keywords.includes(keyword));
}

function wordOverlap(textA, textB) {
  const [shorter, longer] = [tokens(textA), tokens(textB)].sort((a, b) => a.length - b.length);
  if (shorter.length === 0) {
    return 0;
  }
  const rest = [...longer];
  const shared = shorter.filter((word) => {
    const position = rest.indexOf(word);
    if (position === -1) {
      return false;
    }
    rest.splice(position, 1);
    return true;
  });
  return shared.length / shorter.length;
}

// Eine falsche Antwort, die auch richtig sein kann: Der eigene Abgleich nimmt sie an, oder die Sätze oder Bedeutungen ähneln sich zu sehr.
export function canAlsoBeRight(candidate, unit) {
  return (
    matchTyped(unit, candidate.en).outcome !== "wrong" ||
    matchTyped(candidate, unit.en).outcome !== "wrong" ||
    wordOverlap(unit.en, candidate.en) >= SIMILAR_OVERLAP ||
    wordOverlap(unit.meaningDe, candidate.meaningDe) >= SIMILAR_OVERLAP
  );
}

/*
 * Bis zu drei falsche Antworten, zuerst aus demselben Abschnitt, dann aus derselben Datei. textOf sagt, was angezeigt wird.
 * Erst ohne gemeinsames Schlüsselwort, denn sonst kann auch die falsche Antwort passen. Reicht das nicht, ohne diese Bedingung.
 * Was auch richtig sein kann, kommt in keinem der beiden Durchläufe infrage.
 */
function chooseWrong(content, unit, rng, textOf) {
  const sameType = content.allUnits().filter((candidate) => candidate.type === unit.type && candidate.id !== unit.id);
  const section = unit.sectionId ? shuffle(sameType.filter((candidate) => candidate.sectionId === unit.sectionId), rng) : [];
  const file = shuffle(sameType.filter((candidate) => candidate.file === unit.file && !section.includes(candidate)), rng);
  const pool = [...section, ...file];
  const used = new Set([...formsOf(unit), normalizeText(textOf(unit))]);
  const chosen = [];
  for (const allowed of [(candidate) => !sharesKeyword(candidate, unit), () => true]) {
    for (const candidate of pool) {
      if (chosen.length === WRONG_OPTIONS) {
        return chosen;
      }
      const text = normalizeText(textOf(candidate));
      if (!used.has(text) && !meansTheSame(candidate, unit) && allowed(candidate) && !excludedTogether(candidate.id, unit.id) && !canAlsoBeRight(candidate, unit)) {
        used.add(text);
        chosen.push(candidate);
      }
    }
  }
  return chosen;
}

function englishOption(unit, correct) {
  return {
    text: unit.en,
    correct,
    meaningDe: unit.meaningDe,
    source: unit.source,
    ...(unit.clinicDependent ? { clinicDependent: true } : {}),
  };
}

function meaningOption(unit, correct) {
  return { text: unit.meaningDe, correct };
}

function reactionOption(reaction) {
  const option = { text: reaction.en, correct: reaction.fits === true, meaningDe: reaction.meaningDe, source: reaction.source };
  if (reaction.whyDe) {
    option.whyDe = reaction.whyDe;
  }
  if (reaction.clinicDependent === true) {
    option.clinicDependent = true;
  }
  return option;
}

function reactionOptions(unit) {
  const fitting = unit.reactions.filter((reaction) => reaction.fits === true);
  const used = new Set(fitting.map((reaction) => normalizeText(reaction.en)));
  const wrong = unit.reactions.filter((reaction) => {
    const text = normalizeText(reaction.en);
    if (reaction.fits === true || used.has(text)) {
      return false;
    }
    used.add(text);
    return true;
  });
  return [...fitting, ...wrong].map(reactionOption);
}

// Die Wörter gemischt, aber nie schon in der richtigen Folge.
function mixedWords(answer, rng) {
  const mixed = shuffle(answer, rng);
  const unchanged = mixed.every((word, index) => word === answer[index]);
  return unchanged ? [...mixed.slice(1), ...mixed.slice(0, 1)] : mixed;
}

function withChoices(unit, kind, rng, correctOption, wrongOptions) {
  return { unitId: unit.id, kind, options: shuffle([correctOption, ...wrongOptions], rng) };
}

// Die Arten, die für diese Einheit vorgesehen sind.
export function kindsFor(unit) {
  return [...KINDS[unit.type]];
}

// Patienten sagen dasselbe verschieden. Beim ersten Mal der Satz, danach reihum die Fassungen, so hört sie mit der Zeit alle üblichen (Vorgabe).
export function hearingForm(unit, seen = 0) {
  const forms = [unit.en, ...unit.variants];
  return forms[seen % forms.length];
}

// seen: wie oft die Einheit schon dran war. Wählt bei hearReact die Fassung zum Anhören, sie steht als heardEn in der Übung, wenn sie nicht en ist.
export function buildExercise({ content, unit, kind, rng, seen = 0 }) {
  if (!KINDS[unit.type].includes(kind)) {
    throw new RangeError("Die Art " + kind + " passt nicht zu " + unit.id);
  }
  const english = (candidate) => candidate.en;
  const meaning = (candidate) => candidate.meaningDe;
  switch (kind) {
    case "present":
    case "typeSentence":
      return { unitId: unit.id, kind, options: [] };
    case "hearReact": {
      const heard = hearingForm(unit, seen);
      return { unitId: unit.id, kind, options: shuffle(reactionOptions(unit), rng), ...(heard === unit.en ? {} : { heardEn: heard }) };
    }
    case "buildSentence": {
      const answer = surfaceWords(unit.en);
      return { unitId: unit.id, kind, options: mixedWords(answer, rng).map((text) => ({ text })), answer };
    }
    case "pickEnglish":
    case "wordPick":
      return withChoices(unit, kind, rng, englishOption(unit, true), chooseWrong(content, unit, rng, english).map((candidate) => englishOption(candidate, false)));
    default:
      return withChoices(unit, kind, rng, meaningOption(unit, true), chooseWrong(content, unit, rng, meaning).map((candidate) => meaningOption(candidate, false)));
  }
}

// ----- Welche Einheiten -----

/*
 * Die Einheiten eines Fokus in ihrer Reihenfolge: null alle, eine Untersuchung (mri) mit ihren Wörtern,
 * ein Szenario (mri:safety) oder eine Abschnitts-ID (sb.questions). Unbekannt: leer.
 */
export function focusUnits(content, focus = null) {
  if (focus === null) {
    return content.allUnits();
  }
  const pick = (ids) => ids.map((id) => content.unit(id)).filter(Boolean);
  if (EXAMS.includes(focus)) {
    return [...pick(content.examSections(focus).flatMap((section) => section.unitIds)), ...content.words(focus)];
  }
  const [exam, key] = String(focus).split(":");
  if (key !== undefined) {
    const scenario = EXAMS.includes(exam) ? content.examSections(exam).find((section) => section.key === key) : null;
    return scenario ? pick(scenario.unitIds) : [];
  }
  const section = content.sections().find((item) => item.id === focus);
  return section ? pick(section.unitIds) : [];
}

function entriesOf(content, state, focus) {
  return focusUnits(content, focus).map((unit, position) => ({ unit, progress: unitState(state, unit.id), position }));
}

function planOrder(state) {
  const order = state.placement?.plan?.order;
  return Array.isArray(order) ? order : [];
}

// Rang nach dem Lernplan. Wörter haben keinen Abschnitt, sie zählen zur Datei. Was der Plan nicht nennt, kommt danach.
function planRank(content, state) {
  const sectionRank = new Map();
  planOrder(state).forEach((id, index) => {
    if (!sectionRank.has(id)) {
      sectionRank.set(id, index);
    }
  });
  const fileRank = new Map();
  for (const section of content.sections()) {
    const rank = sectionRank.get(section.id) ?? Infinity;
    fileRank.set(section.file, Math.min(rank, fileRank.get(section.file) ?? Infinity));
  }
  return (unit) => (unit.type === "word" ? fileRank.get(unit.file) : sectionRank.get(unit.sectionId)) ?? Infinity;
}

const weakestFirst = byKeys(
  (entry) => entry.progress.box,
  (entry) => (isWeak(entry.progress) ? 0 : 1),
  (entry) => entry.progress.due,
  (entry) => entry.position,
);

function newOrder(rank) {
  return byKeys(
    (entry) => (entry.unit.core ? 0 : 1),
    (entry) => rank(entry.unit),
    (entry) => entry.position,
  );
}

/*
 * Verteilt freie Plätze nach Gewicht, soweit vorhanden und soweit der Platz reicht. Die Folge der Arten ist zugleich
 * die Reihenfolge im Plan, so wechseln sich Sätze, Äußerungen und Wörter ab.
 */
function allocate(available, weights, costs, unitLimit, slots) {
  const counts = Object.fromEntries(Object.keys(weights).map((type) => [type, 0]));
  const sequence = [];
  let left = slots;
  while (sequence.length < unitLimit) {
    let next = null;
    for (const type of Object.keys(weights)) {
      const fits = counts[type] < available[type] && costs[type] <= left;
      if (fits && (next === null || counts[type] / weights[type] < counts[next] / weights[next])) {
        next = type;
      }
    }
    if (next === null) {
      break;
    }
    counts[next] += 1;
    left -= costs[next];
    sequence.push(next);
  }
  return sequence;
}

// Äußerungen und Wörter kommen bevorzugt von dort, wo die neuen Sätze gerade stehen.
function chooseNew(fresh, rank, weights, costs, unitLimit, slots) {
  const ofType = (type) => fresh.filter((entry) => entry.unit.type === type);
  const available = Object.fromEntries(Object.keys(weights).map((type) => [type, ofType(type).length]));
  const sequence = allocate(available, weights, costs, unitLimit, slots);
  const count = (type) => sequence.filter((item) => item === type).length;

  const sentences = ofType("sentence").sort(newOrder(rank)).slice(0, count("sentence"));
  const sections = new Set(sentences.map((entry) => entry.unit.sectionId));
  const files = new Set(sentences.map((entry) => entry.unit.file));
  const patients = ofType("patient")
    .sort((a, b) => (sections.has(a.unit.sectionId) ? 0 : 1) - (sections.has(b.unit.sectionId) ? 0 : 1) || newOrder(rank)(a, b))
    .slice(0, count("patient"));
  const words = ofType("word")
    .sort((a, b) => (files.has(a.unit.file) ? 0 : 1) - (files.has(b.unit.file) ? 0 : 1) || newOrder(rank)(a, b))
    .slice(0, count("word"));

  const queues = { sentence: sentences, patient: patients, word: words };
  return sequence.map((type) => queues[type].shift());
}

// ----- Bahn -----

function dueKind(unit, progress) {
  if (unit.type === "patient") {
    return "hearReact";
  }
  if (unit.type === "word") {
    return progress.box >= 2 ? "wordPick" : "wordHear";
  }
  // Noch nie geübt, etwa nach einer Partner-Bewertung: Wie bei jedem neuen Satz zuerst antippen, davor hören und lesen (withFirstSight).
  if (progress.box === 0 && (progress.seen ?? 0) === 0) {
    return "pickEnglish";
  }
  // Wiederholt wird durch Abrufen, sie findet den Satz selbst: erst aus seinen Wörtern, dann frei (Vorgabe 5.7).
  return progress.box <= 2 ? "buildSentence" : "typeSentence";
}

function newKinds(unit) {
  if (unit.type === "sentence") {
    return ["present", "pickEnglish"];
  }
  return unit.type === "patient" ? ["hearReact"] : ["wordHear"];
}

export function planTrain({ content, state, today, rng, size = 30, focus = null }) {
  const entries = entriesOf(content, state, focus);
  const dueLimit = Math.floor((size * 7) / 10);
  const due = entries.filter((entry) => isDue(entry.progress, today)).sort(weakestFirst).slice(0, dueLimit);
  const fresh = entries.filter((entry) => isNew(entry.progress));
  const chosen = chooseNew(fresh, planRank(content, state), TRAIN_WEIGHTS, TRAIN_COSTS, NEW_UNIT_LIMIT, size - due.length);

  const plan = due.map(({ unit, progress }) => buildExercise({ content, unit, kind: dueKind(unit, progress), rng, seen: progress.seen }));
  for (const { unit } of chosen) {
    for (const kind of newKinds(unit)) {
      plan.push(buildExercise({ content, unit, kind, rng }));
    }
  }
  return plan;
}

// ----- Sprechen -----

// Alles, was die Sprech-Ansicht ohne Inhaltsdaten braucht, denn sie lädt die Seite neu.
function speechSnapshot(content, unit) {
  if (unit.type === "patient") {
    const reaction = unit.reactions.find((item) => item.fits === true);
    return {
      en: reaction.en,
      variants: [],
      keywords: reactionKeywords(reaction),
      softKeywords: true,
      situationDe: unit.situationDe,
      meaningDe: reaction.meaningDe,
      noteDe: unit.noteDe,
      clinicDependent: unit.clinicDependent || reaction.clinicDependent === true,
      prompt: unit.en,
      source: content.source(reaction.source),
    };
  }
  return {
    en: unit.en,
    variants: [...unit.variants],
    keywords: [...unit.keywords],
    softKeywords: false,
    situationDe: unit.situationDe,
    meaningDe: unit.meaningDe,
    noteDe: unit.noteDe,
    clinicDependent: unit.clinicDependent,
    prompt: null,
    source: content.source(unit.source),
  };
}

function speechStage(unit, progress) {
  return unit.type === "sentence" && progress.spokenA !== true ? "a" : "b";
}

// Was heute schwach gewertet wurde, kommt morgen wieder, nicht schon in der nächsten Runde.
function weakToday(progress, today) {
  return isWeak(progress) && typeof progress.lastAt === "string" && toDateString(new Date(progress.lastAt)) === today;
}

/*
 * Fällige zuerst. Danach, was in der Bahn schon lief, aber noch nicht bis Stufe b gesprochen ist: Sonst wartet ein Satz
 * auf seinen Tag, obwohl ihm für „gelernt“ nur das Sprechen fehlt. Zuletzt neue Einheiten.
 * Eine Patientenäußerung trägt zusätzlich promptSource, die Quelle der Äußerung selbst. snapshot.source ist die der Reaktion.
 */
export function planSpeech({ content, state, today, size = 12, focus = null }) {
  const entries = entriesOf(content, state, focus).filter((entry) => entry.unit.type !== "word");
  const rank = planRank(content, state);
  const due = entries.filter((entry) => isDue(entry.progress, today)).sort(weakestFirst);
  const started = entries
    .filter((entry) => !isDue(entry.progress, today) && !isNew(entry.progress) && entry.progress.spokenB !== true && !weakToday(entry.progress, today))
    .sort(newOrder(rank));
  const known = [...due, ...started].slice(0, size);
  const fresh = entries.filter((entry) => isNew(entry.progress));
  const chosen = chooseNew(fresh, rank, SPEECH_WEIGHTS, SPEECH_COSTS, size - known.length, size - known.length);
  return [...known, ...chosen].map(({ unit, progress }) => ({
    unitId: unit.id,
    stage: speechStage(unit, progress),
    snapshot: speechSnapshot(content, unit),
    ...(unit.type === "patient" ? { promptSource: content.source(unit.source) } : {}),
  }));
}
