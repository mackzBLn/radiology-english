/*
 * Macht englische Sätze vergleichbar: Kleinschreibung, gerade Apostrophe, keine Satzzeichen, Kurzformen ausgeschrieben,
 * britisch und amerikanisch gleich, Zahlen als Wörter. Leerzeichen um Satzzeichen zählen nicht (Gerätetest Lauf 5).
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Unicode_character_class_escape
 *   https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize
 */

const CURLY_APOSTROPHES = /[‘’‛ʹʼ`´′]/g;
const COMBINING_MARKS = /\p{M}/gu;
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const DOTTED_ABBREVIATION = /^\p{L}(?:\.\p{L})+$/u;
const WORD_PIECES = /\d+(?:st|nd|rd|th)(?![\p{L}\p{N}])|\d+|[\p{L}']+/gu;
const CONTRACTION = /^(.+?)(n't|'ll|'re|'ve|'d|'m|'s)$/;

const CONTRACTION_ENDINGS = { "n't": "not", "'ll": "will", "'re": "are", "'ve": "have", "'d": "would", "'m": "am", "'s": "is" };

// ----- Kurzformen -----

const FIXED_FORMS = new Map([
  ["can't", ["can", "not"]],
  ["cant", ["can", "not"]],
  ["cannot", ["can", "not"]],
  ["won't", ["will", "not"]],
  ["wont", ["will", "not"]],
  ["shan't", ["shall", "not"]],
  ["shant", ["shall", "not"]],
  ["ain't", ["is", "not"]],
  ["let's", ["let", "us"]],
  ["lets", ["let", "us"]],
  ["alright", ["all", "right"]],
  ["gonna", ["going", "to"]],
  ["wanna", ["want", "to"]],
  ["gotta", ["got", "to"]],
  // Ohne Apostroph getippt. Beide Seiten des Abgleichs laufen durch dieselbe Regel, ein seltenes Wort wie its stört also nicht.
  ["im", ["i", "am"]],
  ["ive", ["i", "have"]],
  ["youre", ["you", "are"]],
  ["youve", ["you", "have"]],
  ["youll", ["you", "will"]],
  ["youd", ["you", "would"]],
  ["weve", ["we", "have"]],
  ["theyre", ["they", "are"]],
  ["theyve", ["they", "have"]],
  ["theyll", ["they", "will"]],
  ["theyd", ["they", "would"]],
  ["hes", ["he", "is"]],
  ["shes", ["she", "is"]],
  ["its", ["it", "is"]],
  ["itll", ["it", "will"]],
  ["thats", ["that", "is"]],
  ["thatll", ["that", "will"]],
  ["theres", ["there", "is"]],
  ["heres", ["here", "is"]],
  ["whats", ["what", "is"]],
  ["whos", ["who", "is"]],
  ["wheres", ["where", "is"]],
  ["whens", ["when", "is"]],
  ["hows", ["how", "is"]],
]);

for (const stem of ["is", "are", "was", "were", "do", "does", "did", "have", "has", "had", "would", "could", "should", "must", "need", "might"]) {
  FIXED_FORMS.set(stem + "nt", [stem, "not"]);
}

// Diese Formen ohne Apostroph sind zugleich häufige eigene Wörter. Sie bleiben in tokens, der Abgleich prüft beide Lesarten.
const AMBIGUOUS_PLAIN_FORMS = new Map([
  ["well", ["we", "will"]],
  ["were", ["we", "are"]],
  ["wed", ["we", "would"]],
  ["ill", ["i", "will"]],
  ["id", ["i", "would"]],
  ["hell", ["he", "will"]],
  ["hed", ["he", "would"]],
  ["shell", ["she", "will"]],
  ["shed", ["she", "would"]],
]);

function expandContraction(piece) {
  const fixed = FIXED_FORMS.get(piece);
  if (fixed) {
    return fixed;
  }
  const match = CONTRACTION.exec(piece);
  if (match) {
    return [...expandContraction(match[1]), CONTRACTION_ENDINGS[match[2]]];
  }
  const plain = piece.replaceAll("'", "");
  return plain ? [plain] : [];
}

// ----- Zahlen, einheitlich als Wörter, damit ein Tippfehler in „thirty“ ein Tippfehler bleibt -----

const UNITS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORDINAL_UNITS = [
  "zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth",
  "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth",
];
const ORDINAL_TENS = ["", "", "twentieth", "thirtieth", "fortieth", "fiftieth", "sixtieth", "seventieth", "eightieth", "ninetieth"];
const NUMBER_WORDS = new Set([...UNITS.slice(1), ...TENS.slice(2)]);

function cardinalWords(n) {
  if (n < 20) {
    return [UNITS[n]];
  }
  if (n < 100) {
    const unit = n % 10;
    return unit ? [TENS[Math.floor(n / 10)], UNITS[unit]] : [TENS[Math.floor(n / 10)]];
  }
  const rest = n % 100;
  return [UNITS[Math.floor(n / 100)], "hundred", ...(rest ? cardinalWords(rest) : [])];
}

function ordinalWords(n) {
  if (n < 20) {
    return [ORDINAL_UNITS[n]];
  }
  if (n < 100) {
    const unit = n % 10;
    return unit ? [TENS[Math.floor(n / 10)], ORDINAL_UNITS[unit]] : [ORDINAL_TENS[Math.floor(n / 10)]];
  }
  return null;
}

// Vierstellig wie eine Jahreszahl: 1971 heißt nineteen seventy one. Führende Null und lange Ziffernfolgen Ziffer für Ziffer.
function digitWords(digits) {
  if ((digits.length > 1 && digits.startsWith("0")) || digits.length > 4) {
    return [...digits].map((digit) => UNITS[Number(digit)]);
  }
  const n = Number(digits);
  if (n < 1000) {
    return cardinalWords(n);
  }
  if (n % 1000 === 0) {
    return [UNITS[n / 1000], "thousand"];
  }
  const high = Math.floor(n / 100);
  const low = n % 100;
  if (n > 2000 && n < 2010) {
    return ["two", "thousand", UNITS[low]];
  }
  if (low === 0) {
    return [...cardinalWords(high), "hundred"];
  }
  return low < 10 ? [...cardinalWords(high), "oh", UNITS[low]] : [...cardinalWords(high), ...cardinalWords(low)];
}

function expandPiece(piece) {
  const ordinal = /^(\d+)(?:st|nd|rd|th)$/.exec(piece);
  if (ordinal) {
    return ordinalWords(Number(ordinal[1])) ?? [piece];
  }
  if (/^\d+$/.test(piece)) {
    return digitWords(piece);
  }
  return expandContraction(piece);
}

// ----- Britisch und amerikanisch: gerechnet wird mit der britischen Form -----

const REGULAR_ENDINGS = ["", "s"];
const PLAIN = [""];
const VERB_ENDINGS = ["e", "es", "ed", "ing", "er", "ers", "ation"];

const SPELLING_PAIRS = [
  ["jewellery", "jewelry", PLAIN],
  ["jeweller", "jeweler", REGULAR_ENDINGS],
  ["anaesthetic", "anesthetic", REGULAR_ENDINGS],
  ["anaesthetist", "anesthetist", REGULAR_ENDINGS],
  ["anaesthesia", "anesthesia", PLAIN],
  ["centre", "center", REGULAR_ENDINGS],
  ["grey", "gray", PLAIN],
  ["colour", "color", ["", "s", "ed", "ing", "ful"]],
  ["tumour", "tumor", REGULAR_ENDINGS],
  ["metre", "meter", REGULAR_ENDINGS],
  ["centimetre", "centimeter", REGULAR_ENDINGS],
  ["millimetre", "millimeter", REGULAR_ENDINGS],
  ["kilometre", "kilometer", REGULAR_ENDINGS],
  ["litre", "liter", REGULAR_ENDINGS],
  ["millilitre", "milliliter", REGULAR_ENDINGS],
  ["favour", "favor", ["", "s", "ite", "ites"]],
  ["neighbour", "neighbor", REGULAR_ENDINGS],
  ["behaviour", "behavior", PLAIN],
  ["labour", "labor", PLAIN],
  ["honour", "honor", REGULAR_ENDINGS],
  ["rumour", "rumor", REGULAR_ENDINGS],
  ["flavour", "flavor", REGULAR_ENDINGS],
  ["humour", "humor", PLAIN],
  ["odour", "odor", REGULAR_ENDINGS],
  ["orthopaedic", "orthopedic", REGULAR_ENDINGS],
  ["paediatric", "pediatric", REGULAR_ENDINGS],
  ["paediatrician", "pediatrician", REGULAR_ENDINGS],
  ["oesophagus", "esophagus", PLAIN],
  ["diarrhoea", "diarrhea", PLAIN],
  ["foetus", "fetus", PLAIN],
  ["oedema", "edema", PLAIN],
  ["anaemia", "anemia", PLAIN],
  ["anaemic", "anemic", PLAIN],
  ["leukaemia", "leukemia", PLAIN],
  ["haemorrhage", "hemorrhage", REGULAR_ENDINGS],
  ["haemoglobin", "hemoglobin", PLAIN],
  ["gynaecologist", "gynecologist", REGULAR_ENDINGS],
  ["gynaecology", "gynecology", PLAIN],
  ["caesarean", "cesarean", REGULAR_ENDINGS],
  ["practise", "practice", ["", "s", "d"]],
  ["practising", "practicing", PLAIN],
  ["licence", "license", REGULAR_ENDINGS],
  ["programme", "program", REGULAR_ENDINGS],
  ["aluminium", "aluminum", PLAIN],
  ["sulphate", "sulfate", REGULAR_ENDINGS],
  ["defence", "defense", PLAIN],
  ["offence", "offense", REGULAR_ENDINGS],
  ["travelled", "traveled", PLAIN],
  ["travelling", "traveling", PLAIN],
  ["traveller", "traveler", REGULAR_ENDINGS],
  ["cancelled", "canceled", PLAIN],
  ["cancelling", "canceling", PLAIN],
  ["labelled", "labeled", PLAIN],
  ["labelling", "labeling", PLAIN],
  ["dialled", "dialed", PLAIN],
  ["dialling", "dialing", PLAIN],
  ["counsellor", "counselor", REGULAR_ENDINGS],
  ["organis", "organiz", VERB_ENDINGS],
  ["realis", "realiz", VERB_ENDINGS],
  ["recognis", "recogniz", VERB_ENDINGS],
  ["apologis", "apologiz", VERB_ENDINGS],
  ["minimis", "minimiz", VERB_ENDINGS],
  ["immobilis", "immobiliz", VERB_ENDINGS],
  ["stabilis", "stabiliz", VERB_ENDINGS],
  ["hospitalis", "hospitaliz", VERB_ENDINGS],
  ["analys", "analyz", ["e", "es", "ed", "ing"]],
  ["paralys", "paralyz", ["e", "es", "ed", "ing"]],
  ["catalogue", "catalog", REGULAR_ENDINGS],
  ["dialogue", "dialog", REGULAR_ENDINGS],
  ["mum", "mom", REGULAR_ENDINGS],
  ["doughnut", "donut", REGULAR_ENDINGS],
  ["towards", "toward", PLAIN],
  ["whilst", "while", PLAIN],
  ["learnt", "learned", PLAIN],
  ["spelt", "spelled", PLAIN],
  ["burnt", "burned", PLAIN],
  ["got", "gotten", PLAIN],
  ["pyjamas", "pajamas", PLAIN],
  ["moustache", "mustache", REGULAR_ENDINGS],
  ["ageing", "aging", PLAIN],
  ["judgement", "judgment", REGULAR_ENDINGS],
  ["ok", "okay", PLAIN],
  ["mr", "mister", PLAIN],
  ["doctor", "dr", PLAIN],
];

const SPELLING = new Map();
const OTHER_SPELLINGS = new Map();

for (const [british, american, endings] of SPELLING_PAIRS) {
  for (const ending of endings) {
    SPELLING.set(american + ending, british + ending);
    OTHER_SPELLINGS.set(british + ending, american + ending);
  }
}

// Zwei Wörter, die zusammen eines sind.
const JOINED_WORDS = new Map([
  ["x ray", "xray"],
  ["x rays", "xrays"],
  ["ear plug", "earplug"],
  ["ear plugs", "earplugs"],
  ["o clock", "oclock"],
  ["head phones", "headphones"],
  ["pace maker", "pacemaker"],
  ["pace makers", "pacemakers"],
  ["wheel chair", "wheelchair"],
  ["wheel chairs", "wheelchairs"],
  ["make up", "makeup"],
  ["hand bag", "handbag"],
  ["pain killer", "painkiller"],
  ["pain killers", "painkillers"],
  ["sun glasses", "sunglasses"],
  ["bath room", "bathroom"],
]);

// ----- Satz zerlegen -----

// Die Wörter so, wie sie im Satz stehen, ohne Satzzeichen am Rand. Zum Anzeigen und für buildSentence.
export function surfaceWords(text) {
  return String(text ?? "")
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(EDGE_PUNCTUATION, ""))
    .filter(Boolean);
}

function expandSurface(surface) {
  // Erst die Apostrophe: NFKD zerlegt den Akut U+00B4 sonst in Leerzeichen und Zeichen.
  let word = surface.replace(CURLY_APOSTROPHES, "'").normalize("NFKD").replace(COMBINING_MARKS, "").toLowerCase();
  if (DOTTED_ABBREVIATION.test(word)) {
    word = word.replaceAll(".", "");
  }
  // 1,000 ist eine Zahl, 6:00 und 6.00 sind volle Stunden.
  word = word.replace(/(\d),(?=\d{3}(?!\d))/g, "$1").replace(/(?<!\d)(\d{1,2})[:.]00(?!\d)/g, "$1 oclock");
  return (word.match(WORD_PIECES) ?? []).flatMap(expandPiece);
}

function joinPairs(items) {
  const result = [];
  for (let index = 0; index < items.length; index += 1) {
    const next = items[index + 1];
    const joined = next ? JOINED_WORDS.get(items[index].token + " " + next.token) : undefined;
    if (joined) {
      result.push({ token: joined, owners: [...items[index].owners, ...next.owners] });
      index += 1;
    } else {
      result.push(items[index]);
    }
  }
  return result;
}

// a hundred und hundred werden one hundred, das and in one hundred and five entfällt.
function settleHundreds(items) {
  const rest = [...items];
  const result = [];
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    const previous = result[result.length - 1];
    const next = rest[index + 1];
    if (item.token === "hundred") {
      if (previous?.token === "a") {
        result[result.length - 1] = { ...previous, token: "one" };
      } else if (!NUMBER_WORDS.has(previous?.token)) {
        result.push({ token: "one", owners: item.owners });
      }
    }
    if (item.token === "and" && previous?.token === "hundred" && NUMBER_WORDS.has(next?.token)) {
      rest[index + 1] = { ...next, owners: [...item.owners, ...next.owners] };
    } else {
      result.push(item);
    }
  }
  return result;
}

/*
 * Der Satz in Wörtern und in vergleichbaren Bausteinen:
 * surfaces: die Wörter wie im Satz. tokens: die Bausteine. owners[i]: aus welchen Wörtern der Baustein i stammt.
 * So kann der Abgleich sein Ergebnis wieder auf die Wörter des Satzes zurückführen, I'm bleibt dann I'm.
 */
export function analyzeWords(text) {
  const surfaces = surfaceWords(text);
  const items = [];
  surfaces.forEach((surface, index) => {
    for (const token of expandSurface(surface)) {
      items.push({ token, owners: [index] });
    }
  });
  const settled = settleHundreds(joinPairs(items)).map((item) => ({ ...item, token: SPELLING.get(item.token) ?? item.token }));
  return { surfaces, tokens: settled.map((item) => item.token), owners: settled.map((item) => item.owners) };
}

export function tokens(text) {
  return analyzeWords(text).tokens;
}

export function normalizeText(text) {
  return tokens(text).join(" ");
}

// Die Schreibweisen eines Bausteins, zum Prüfen auf Tippfehler: jewlery liegt neben jewelry, nicht neben jewellery.
export function spellingForms(token) {
  const other = OTHER_SPELLINGS.get(token);
  return other ? [token, other] : [token];
}

// Die zweite Lesart einer Eingabe ohne Apostroph: well wird we will, were wird we are. null, wenn es keine gibt.
export function apostropheReading(tokenList) {
  if (!tokenList.some((token) => AMBIGUOUS_PLAIN_FORMS.has(token))) {
    return null;
  }
  return tokenList.flatMap((token) => AMBIGUOUS_PLAIN_FORMS.get(token) ?? [token]);
}
