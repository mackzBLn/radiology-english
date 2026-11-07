/*
 * Inhaltsdaten: lädt die Dateien aus daten/ und bereitet Sätze, Patientenäußerungen und Wörter
 * einheitlich als Einheiten auf. fetchJson(name) liefert das JSON aus daten/<name>.json.
 */

export const EXAMS = ["mri", "ct", "xray"];

export const SCENARIO_ORDER = [
  "greeting",
  "procedure",
  "safety",
  "changing",
  "stillness",
  "contrast",
  "anxiety",
  "callButton",
  "noise",
  "closing",
];

export const UNIT_FILES = ["satzbau", "klaeren", "gemeinsam", "mrt", "ct", "roentgen"];

const SHARED_FILE = "gemeinsam";
const OTHER_FILES = ["faelle", "quellen"];

// Eigene Datei: ihre Untersuchung. Gemeinsam: das Feld exams. Gemeinsame Wörter tragen keins und gelten für alle drei.
function examsOf(raw, type, header) {
  if (header.exam) {
    return [header.exam];
  }
  if (Array.isArray(raw.exams)) {
    return raw.exams;
  }
  return type === "word" && header.file === SHARED_FILE ? [...EXAMS] : [];
}

// Ein Wörterbuch nennt als Stelle „Eintrag <wort>“. Mit entryBase in daten/quellen.json führt der Link direkt zum Eintrag, nicht auf die Startseite.
function withEntryAddress(source) {
  const word = source.entryBase ? /^Eintrag (.+)$/.exec(source.locator ?? "")?.[1] : null;
  return word ? { ...source, url: source.entryBase + word.trim().toLowerCase().replaceAll(" ", "-") } : source;
}

function buildUnit(raw, type, header, section) {
  return {
    id: raw.id,
    type,
    file: header.file,
    sectionId: section ? section.id : null,
    sectionKey: section ? section.key : null,
    strand: header.strand,
    exams: examsOf(raw, type, header),
    en: raw.en,
    variants: raw.variants ?? [],
    keywords: raw.keywords ?? [],
    situationDe: raw.situationDe ?? null,
    meaningDe: raw.meaningDe ?? null,
    noteDe: raw.noteDe ?? null,
    cefr: raw.cefr ?? null,
    core: raw.core === true,
    clinicDependent: raw.clinicDependent === true,
    kind: raw.kind ?? null,
    reactions: raw.reactions ?? [],
    source: raw.source ?? null,
  };
}

// files: je Dateiname das gelesene JSON. Eigene Funktion, damit Tests ohne fetchJson auskommen.
export function buildContent(files) {
  const units = [];
  const unitsById = new Map();
  const sections = [];

  function addUnit(unit) {
    units.push(unit);
    unitsById.set(unit.id, unit);
    return unit.id;
  }

  for (const name of UNIT_FILES) {
    const header = files[name];
    for (const section of header.sections) {
      const unitIds = [];
      for (const raw of section.sentences ?? []) {
        unitIds.push(addUnit(buildUnit(raw, "sentence", header, section)));
      }
      for (const raw of section.patient ?? []) {
        unitIds.push(addUnit(buildUnit(raw, "patient", header, section)));
      }
      sections.push({
        id: section.id,
        key: section.key,
        titleDe: section.titleDe,
        strand: header.strand,
        file: header.file,
        exam: header.exam ?? null,
        explanationDe: section.explanationDe ?? null,
        explanationSource: section.explanationSource ?? null,
        unitIds,
      });
    }
    for (const raw of header.words ?? []) {
      addUnit(buildUnit(raw, "word", header, null));
    }
  }

  const sourcesById = new Map(files.quellen.sources.map((source) => [source.id, source]));

  return {
    cases: files.faelle.cases,
    checklist: files.faelle.checklist,

    unit(id) {
      return unitsById.get(id) ?? null;
    },

    allUnits() {
      return [...units];
    },

    // ref ist die ID einer Quelle oder das Feld source einer Einheit, dann kommt die Stelle mit.
    source(ref) {
      const isField = ref !== null && typeof ref === "object";
      const found = sourcesById.get(isField ? ref.ref : ref);
      if (!found) {
        return null;
      }
      return withEntryAddress({ ...found, locator: isField ? ref.locator ?? null : null });
    },

    sections() {
      return [...sections];
    },

    // Je Szenario die gemeinsamen Einheiten dieser Untersuchung, danach ihre eigenen. Leere Szenarien entfallen.
    examSections(exam) {
      const result = [];
      for (const key of SCENARIO_ORDER) {
        const shared = sections.find((section) => section.file === SHARED_FILE && section.key === key);
        const own = sections.find((section) => section.exam === exam && section.key === key);
        const sharedIds = shared ? shared.unitIds.filter((id) => unitsById.get(id).exams.includes(exam)) : [];
        const unitIds = [...sharedIds, ...(own ? own.unitIds : [])];
        if (unitIds.length > 0) {
          result.push({ key, titleDe: (own ?? shared).titleDe, unitIds });
        }
      }
      return result;
    },

    // Gemeinsame Wörter zuerst. Ohne Angabe alle Wörter.
    words(exam) {
      return units.filter((unit) => unit.type === "word" && (exam === undefined || unit.exams.includes(exam)));
    },
  };
}

export async function loadContent(fetchJson) {
  const names = [...UNIT_FILES, ...OTHER_FILES];
  const loaded = await Promise.all(names.map((name) => fetchJson(name)));
  return buildContent(Object.fromEntries(names.map((name, index) => [name, loaded[index]])));
}
