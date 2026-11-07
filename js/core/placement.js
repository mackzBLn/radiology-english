/*
 * Einstufung: wertet eine Fassung aus, wählt die nächste Fassung und baut den Lernplan. Ändert keine Lerneinheiten.
 * notMeasured und fehlende Antworten zählen nie als falsch.
 *
 * Ergebnis: { form, parts: { speaking, listening, writing }, overall, strengths, gaps }.
 * Ein Teil: { measured, level, belowA1, levels: { A1: { correct, wrong, notMeasured }, ... } }. Ohne Messung ist level null.
 * overall ist eine Stufe oder null, wenn nichts gemessen wurde. Als Versuch gespeichert kommt noch at dazu.
 */

export const LEVELS = ["A1", "A2", "B1", "B2"];
export const WEIGHTS = { speaking: 0.5, listening: 0.3, writing: 0.2 };

const PART_NAMES = Object.keys(WEIGHTS);
const PART_LABELS = { speaking: "Sprechen", listening: "Hören", writing: "Schreiben" };
const REACHED_SHARE = 0.6;
const LOWER_SHARE = 0.5;
const STRONG_FROM = LEVELS.indexOf("B1");
const BASIC_BELOW = LEVELS.indexOf("A2");

function countsOf(items, answers) {
  const levels = Object.fromEntries(LEVELS.map((level) => [level, { correct: 0, wrong: 0, notMeasured: 0 }]));
  for (const item of items) {
    const answer = answers[item.id];
    const bucket = answer === "correct" || answer === "wrong" ? answer : "notMeasured";
    if (levels[item.level]) {
      levels[item.level][bucket] += 1;
    }
  }
  return levels;
}

// Höchste Stufe mit mindestens 60 %, jede niedrigere mit mindestens 50 %. Eine Stufe ohne Messung sagt nichts aus.
function reachedLevel(levels) {
  let reached = null;
  for (const level of LEVELS) {
    const { correct, wrong } = levels[level];
    const measured = correct + wrong;
    if (measured === 0) {
      continue;
    }
    const share = correct / measured;
    if (share >= REACHED_SHARE) {
      reached = level;
    }
    if (share < LOWER_SHARE) {
      break;
    }
  }
  return reached;
}

function scorePart(items, answers) {
  const levels = countsOf(items, answers);
  const measured = LEVELS.some((level) => levels[level].correct + levels[level].wrong > 0);
  if (!measured) {
    return { measured: false, level: null, belowA1: false, levels };
  }
  const reached = reachedLevel(levels);
  return { measured: true, level: reached ?? LEVELS[0], belowA1: reached === null, levels };
}

// Gewichtetes Mittel über die gemessenen Teile. In Zehnteln gerechnet, damit kein Rundungsfehler die Stufe kippt.
function overallLevel(parts) {
  let sum = 0;
  let weights = 0;
  for (const part of PART_NAMES) {
    if (parts[part].measured) {
      const weight = Math.round(WEIGHTS[part] * 10);
      sum += weight * LEVELS.indexOf(parts[part].level);
      weights += weight;
    }
  }
  return weights === 0 ? null : LEVELS[Math.round(sum / weights)];
}

function withSummary(text, items, level) {
  const summary = items.find((item) => item.level === level && item.descriptor?.summaryDe)?.descriptor.summaryDe;
  return summary ? text + " (" + summary + ")." : text + ".";
}

function describe(parts, itemsOfPart) {
  const strengths = [];
  const gaps = [];
  for (const part of PART_NAMES) {
    const label = PART_LABELS[part];
    const result = parts[part];
    const items = itemsOfPart(part);
    if (!result.measured) {
      gaps.push(label + " wurde diesmal nicht gemessen. Das zählt nicht als Fehler.");
      continue;
    }
    if (!result.belowA1) {
      strengths.push(withSummary(label + ": Du schaffst Stufe " + result.level, items, result.level));
    }
    const nextIndex = result.belowA1 ? 0 : LEVELS.indexOf(result.level) + 1;
    if (nextIndex < LEVELS.length) {
      gaps.push(withSummary(label + ": Stufe " + LEVELS[nextIndex] + " sitzt noch nicht", items, LEVELS[nextIndex]));
    }
    const open = LEVELS.reduce((sum, level) => sum + result.levels[level].notMeasured, 0);
    if (open > 0) {
      gaps.push(label + ": " + (open === 1 ? "1 Aufgabe wurde" : open + " Aufgaben wurden") + " nicht gemessen. Das zählt nicht als Fehler.");
    }
  }
  return { strengths, gaps };
}

export function scorePlacement(form, answers) {
  const itemsOfPart = (part) => form.items.filter((item) => item.part === part);
  const parts = Object.fromEntries(PART_NAMES.map((part) => [part, scorePart(itemsOfPart(part), answers ?? {})]));
  return { form: form.id, parts, overall: overallLevel(parts), ...describe(parts, itemsOfPart) };
}

// A beim ersten Mal, danach immer abwechselnd.
export function chooseForm(attempts) {
  const last = attempts && attempts.length > 0 ? attempts[attempts.length - 1] : null;
  return last && last.form === "A" ? "B" : "A";
}

// ----- Lernplan -----

// Jede Abschnitts-ID kommt genau einmal vor: Was nicht ausdrücklich vorn steht, folgt hinten.
function sectionGroups(content) {
  const sections = content.sections();
  const ofFile = (...files) => sections.filter((section) => files.includes(section.file)).map((section) => section.id);
  const satzbau = sections.filter((section) => section.file === "satzbau");
  const patientSide = sections.filter((section) => section.key === "patientquestions").map((section) => section.id);
  return {
    satzbau: ofFile("satzbau"),
    // Nur die Grammatik-Abschnitte tragen eine Erklärung, das sagt das Inhaltsformat.
    grammar: satzbau.filter((section) => section.explanationDe !== null).map((section) => section.id),
    smallTalk: satzbau.filter((section) => section.explanationDe === null).map((section) => section.id),
    clarify: ofFile("klaeren"),
    clarifyOther: ofFile("klaeren").filter((id) => !patientSide.includes(id)),
    patientSide,
    shared: ofFile("gemeinsam"),
    exams: ofFile("mrt", "ct", "roentgen"),
  };
}

// Small Talk gleichmäßig zwischen die übrigen Abschnitte verteilt.
function withSmallTalkBetween(main, smallTalk) {
  const step = Math.ceil(main.length / (smallTalk.length + 1));
  const rest = [...smallTalk];
  const result = [];
  main.forEach((id, index) => {
    result.push(id);
    if ((index + 1) % step === 0 && rest.length > 0) {
      result.push(rest.shift());
    }
  });
  return [...result, ...rest];
}

export function buildPlan(result, content) {
  const groups = sectionGroups(content);
  const overall = LEVELS.indexOf(result.overall);
  const writing = result.parts?.writing;
  const weakBuilding = writing?.measured === true && LEVELS.indexOf(writing.level) < BASIC_BELOW;

  if (overall < BASIC_BELOW || weakBuilding) {
    return {
      order: [...groups.satzbau, ...groups.clarify, ...groups.shared, ...groups.exams],
      noteDe: "Du startest mit Satzbau und Nachfragen. Danach kommen die gemeinsamen Sätze und die Untersuchungen.",
    };
  }
  if (overall < STRONG_FROM) {
    return {
      order: [...withSmallTalkBetween([...groups.shared, ...groups.clarify, ...groups.exams], groups.smallTalk), ...groups.grammar],
      noteDe: "Du startest mit den gemeinsamen Sätzen und den Nachfragen. Danach kommen die Untersuchungen, Small Talk ist immer wieder dabei.",
    };
  }
  return {
    order: [...groups.exams, ...groups.patientSide, ...groups.shared, ...groups.clarifyOther, ...groups.smallTalk, ...groups.grammar],
    noteDe: "Du startest direkt mit den Untersuchungen und dem, was Patienten fragen. Grundlagen wiederholst du danach.",
  };
}

// ----- Vergleich -----

function levelOf(attempt, part) {
  const result = attempt?.parts?.[part];
  return result && result.measured !== false ? result.level ?? null : null;
}

// Je Teil beide Stufen, null heißt nicht gemessen. Dazu, ob es unter A1 lag, und dasselbe für die Gesamtstufe.
export function compareAttempts(first, latest) {
  const comparison = {};
  for (const part of PART_NAMES) {
    comparison[part] = {
      first: levelOf(first, part),
      latest: levelOf(latest, part),
      firstBelowA1: first?.parts?.[part]?.belowA1 === true,
      latestBelowA1: latest?.parts?.[part]?.belowA1 === true,
    };
  }
  comparison.overall = { first: first?.overall ?? null, latest: latest?.overall ?? null };
  return comparison;
}
