/*
 * Gleicht getippte und gesprochene Antworten mit einer Einheit ab. Eine Einheit braucht nur en, variants, keywords und
 * optional softKeywords, so passen auch die Schnappschüsse aus planSpeech. Leerzeichen um Satzzeichen und am Ende zählen
 * nicht (Gerätetest Lauf 5). Die confidence der Erkennung wird nie genutzt.
 *
 * missingKeywords nennt die Schlüsselwörter wie in den Daten, also auch mit |. Zum Anzeigen gibt es keywordLabel.
 * words nennt die Wörter so, wie sie in der besten Fassung stehen, ohne Satzzeichen am Rand: I'm bleibt I'm.
 * negationFlip: true steht nur dann im Ergebnis, wenn ein not, never oder no fehlt oder dazukommt, also der Sinn kippen kann.
 * Gesprochen gilt das höchstens als partly, sonst wäre der gegenteilige Satz gelernt. Getippt bleibt es close, die Bahn und der Test werten es als falsch.
 * Bei softKeywords zählt nur ein zusätzliches not oder never: Freie Antworten kommen auch ohne aus, ein dazugekommenes kippt aber den Sinn (Sitzung, 07.11.2026).
 * Beruhigende Wendungen wie Don't worry oder Don't panic drehen keinen Sinn um und zählen dann nicht mit (Prüfung, 07.11.2026). Fehlen sie im festen Satz, zählt das wie jedes not.
 */

import { analyzeWords, apostropheReading, spellingForms, surfaceWords, tokens } from "./normalize.js";

const WORD_SHARE = 0.8;
const PARTLY_WORD_SHARE = 0.5;
const PARTLY_KEYWORD_SHARE = 0.5;
const SOFT_UNDERSTOOD_SHARE = 0.6;
const SOFT_PARTLY_SHARE = 0.3;
const TYPO_MIN_LETTERS = 4;
const TYPO_WORD_LIMIT = 2;
const DERIVED_KEYWORD_LIMIT = 4;
const DERIVED_MIN_CHARS = 3;
// Zwischen den Teilen eines Schlüsselworts dürfen Wörter stehen: take it off, get slowly up.
const PHRASE_GAP = 3;
const NOT_GAP = 2;

const PLEASE = "please";
const QUESTION_STARTS = new Set("do does did am is are was were have has had can could will would shall should may might must".split(" "));

const TYPED_RANK = { wrong: 0, close: 1, correct: 2 };
const SPOKEN_RANK = { notUnderstood: 0, partly: 1, understood: 2 };

const FUNCTION_WORDS = new Set(
  `a an the this that these those there here i me my mine myself we us our ours you your yours yourself he him his she her hers
  they them their theirs it its who whom whose what which when where why how if then than so as at by for from in into of off on
  onto out over to up down under with without about after before during until till while because and or but not no yes do does
  did done doing be am is are was were been being have has had having can cannot could will would shall should may might must want
  need let get got go going went some any all both each every much many more most few little very too also just only
  again still now soon well really quite maybe perhaps please sorry thanks thank okay ok alright right sure hello hi bye
  goodbye dear mr mrs ms miss sir madam one something anything nothing everything someone anyone everyone
  tell telling afraid hear like feel hard trouble`.split(/\s+/),
);

// Formen desselben Worts zählen gleich: Is it hard to breathe? und Do you have trouble breathing?
const BREATHE_FORMS = "breathe|breathing|breath";
const SAME_WORD = new Map([["breathe", BREATHE_FORMS], ["breathing", BREATHE_FORMS], ["breath", BREATHE_FORMS]]);
const SORRY = "sorry";

// Was nach einer Verneinung beruhigt: Don't worry, Try not to worry (beide lehrt sb.reassure.s01), You don't need to be afraid, Don't panic, No need to worry, Never mind.
const CALM_WORDS = ["worry", "panic", "be afraid", "be scared", "be nervous", "be worried", "be frightened"];
const CALM_LEADS = ["", "you ", "to ", "need to ", "have to "];
const REASSURING = new Map([
  ["not", CALM_LEADS.flatMap((lead) => CALM_WORDS.map((calm) => (lead + calm).split(" ")))],
  ["never", [["mind"], ["fear"]]],
  ["no", [["worries"], ...CALM_WORDS.map((calm) => ("need to " + calm).split(" "))]],
]);

// ----- Schlüsselwörter -----

export function keywordLabel(keyword) {
  return String(keyword).split("|")[0].trim();
}

// Inhaltswörter eines Satzes ab 3 Zeichen, ohne Funktionswörter, höchstens 4. Für Sätze ohne eigene Schlüsselwörter.
// Bleibt keines übrig, trägt sorry den Satz: I'm sorry to hear that. Sonst zählte nur der Anteil der Wörter, und Oh, I'm sorry wäre nicht erkannt.
export function deriveKeywords(text) {
  const result = [];
  let saysSorry = false;
  for (const surface of surfaceWords(text)) {
    const word = surface.toLowerCase().replace(/[‘’]/g, "'");
    const stem = word.replace(/'(?:s|ll|re|ve|d|m)$/, "");
    const chars = stem.replace(/[^\p{L}\p{N}]/gu, "");
    const isContent = !word.endsWith("n't") && !FUNCTION_WORDS.has(stem) && chars.length >= DERIVED_MIN_CHARS;
    const keyword = SAME_WORD.get(stem) ?? stem;
    saysSorry ||= stem === SORRY;
    if (isContent && !result.includes(keyword)) {
      result.push(keyword);
    }
    if (result.length === DERIVED_KEYWORD_LIMIT) {
      break;
    }
  }
  return result.length === 0 && saysSorry ? [SORRY] : result;
}

// Die Schlüsselwörter einer passenden Reaktion: die eigenen aus den Daten, sonst abgeleitet. Eigene stehen dort, wo der Wert oder das not der Lernstoff ist.
export function reactionKeywords(reaction) {
  return reaction.keywords ?? deriveKeywords(reaction.en);
}

// Hinter no steht nichts dazwischen, hinter not wenig: In No, you will feel pain steht kein no pain, und ein Komma sieht der Abgleich nicht.
function gapAfter(word) {
  return word === "no" ? 0 : word === "not" ? NOT_GAP : PHRASE_GAP;
}

// Die Stellen einer Wortfolge in der Liste, zwischen ihren Teilen dürfen Wörter stehen. Nicht gefunden: null.
function findPhrase(list, phrase) {
  for (let start = 0; start < list.length; start += 1) {
    if (list[start] !== phrase[0]) {
      continue;
    }
    const positions = [start];
    for (let part = 1; part < phrase.length; part += 1) {
      const next = list.indexOf(phrase[part], positions.at(-1) + 1);
      if (next === -1 || next - positions.at(-1) - 1 > gapAfter(phrase[part - 1])) {
        break;
      }
      positions.push(next);
    }
    if (positions.length === phrase.length) {
      return positions;
    }
  }
  return null;
}

function keywordPresent(list, keyword) {
  return String(keyword)
    .split("|")
    .map((alternative) => tokens(alternative))
    .some((phrase) => phrase.length > 0 && findPhrase(list, phrase) !== null);
}

function missingKeywordsIn(list, keywords) {
  return keywords.filter((keyword) => !keywordPresent(list, keyword));
}

// Jedes Schlüsselwort wird zu einem Platzhalter an der Stelle seines ersten Wortes. So zählt jede Alternative gleich, auch getrennt: take it off.
function markKeywords(list, keywords) {
  let marked = list;
  keywords.forEach((keyword, index) => {
    for (const alternative of String(keyword).split("|")) {
      const phrase = tokens(alternative);
      const positions = phrase.length > 0 ? findPhrase(marked, phrase) : null;
      if (positions) {
        const rest = new Set(positions.slice(1));
        marked = marked.map((word, at) => (at === positions[0] ? "#" + index : word)).filter((_, at) => !rest.has(at));
        return;
      }
    }
  });
  return marked;
}

// ----- Ausrichten -----

// Abstand 1, ein vertauschtes Nachbarpaar zählt als ein Fehler.
function oneEditApart(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 1) {
    return false;
  }
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const restA = endA - start;
  const restB = endB - start;
  if (restA <= 1 && restB <= 1) {
    return true;
  }
  return restA === 2 && restB === 2 && a[start] === b[start + 1] && a[start + 1] === b[start];
}

function isTypo(typed, target) {
  return spellingForms(target).some((form) => form.length >= TYPO_MIN_LETTERS && oneEditApart(typed, form));
}

/*
 * Längste gemeinsame Folge von target und input. typoLimit Paare dürfen einen Tippfehler auseinander sein.
 * Liefert die Paare { target, input, typo } als Stellen und die Zahl der Tippfehler.
 */
function align(target, input, typoLimit = 0) {
  const TYPO_COST = 1;
  const MATCH_VALUE = TYPO_WORD_LIMIT * TYPO_COST + 1;
  const rows = target.length;
  const columns = input.length;
  const table = Array.from({ length: rows + 1 }, () => Array.from({ length: columns + 1 }, () => new Array(typoLimit + 1).fill(0)));

  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      for (let left = 0; left <= typoLimit; left += 1) {
        let value = Math.max(table[row + 1][column][left], table[row][column + 1][left]);
        if (target[row] === input[column]) {
          value = Math.max(value, MATCH_VALUE + table[row + 1][column + 1][left]);
        } else if (left > 0 && isTypo(input[column], target[row])) {
          value = Math.max(value, MATCH_VALUE - TYPO_COST + table[row + 1][column + 1][left - 1]);
        }
        table[row][column][left] = value;
      }
    }
  }

  const pairs = [];
  let typos = 0;
  let row = 0;
  let column = 0;
  let left = typoLimit;
  while (row < rows && column < columns) {
    const value = table[row][column][left];
    if (target[row] === input[column] && value === MATCH_VALUE + table[row + 1][column + 1][left]) {
      pairs.push({ target: row, input: column, typo: false });
      row += 1;
      column += 1;
    } else if (left > 0 && target[row] !== input[column] && isTypo(input[column], target[row]) && value === MATCH_VALUE - TYPO_COST + table[row + 1][column + 1][left - 1]) {
      pairs.push({ target: row, input: column, typo: true });
      typos += 1;
      row += 1;
      column += 1;
      left -= 1;
    } else if (value === table[row + 1][column][left]) {
      row += 1;
    } else {
      column += 1;
    }
  }
  return { pairs, typos };
}

function sameWords(a, b) {
  return a.join("") === b.join("");
}

function notCount(list) {
  return list.filter((token) => token === "not" || token === "never").length;
}

function isReassuring(list, index) {
  return REASSURING.get(list[index])?.some((after) => after.every((word, offset) => list[index + 1 + offset] === word)) === true;
}

// Das not einer beruhigenden Wendung gehört nicht zum Rest des Satzes: In Don't worry, you can move now steht kein not move.
function withoutReassuring(list) {
  return list.filter((_, index) => !isReassuring(list, index));
}

// Für freie Antworten: Beruhigen kippt keinen Sinn, Don't worry, I will stop the scan. No need kippt ihn dagegen: No need to tell the doctor (Prüfung, 07.11.2026).
function softNotCount(list) {
  return list.filter((token, index) => (token === "not" || token === "never" || (token === "no" && list[index + 1] === "need")) && !isReassuring(list, index)).length;
}

// Die Alternative selbst darf ein not tragen, etwa Please don't move bei still|not move. Das ist dann keine dazugekommene Verneinung.
function notsInHits(list, keywords) {
  return keywords.reduce((sum, keyword) => {
    const hit = String(keyword)
      .split("|")
      .map((alternative) => tokens(alternative))
      .find((phrase) => phrase.length > 0 && findPhrase(list, phrase) !== null);
    return sum + (hit ? notCount(hit) : 0);
  }, 0);
}

// no kippt den Sinn ebenso: You have no allergies. Am Satzanfang neben einem not ist es nur die Antwort: No, it does not hurt.
function negationCount(list) {
  const nots = notCount(list);
  return nots + list.filter((token, index) => token === "no" && (index > 0 || nots === 0 || isReassuring(list, index))).length;
}

// Für feste Sätze: Eine dazugekommene beruhigende Wendung dreht nichts um: Don't worry, the scan is nearly over. Fehlt sie dagegen im Satz, zählt das wie jedes not.
function negationsDiffer(target, reading) {
  const calmCount = (list) => list.filter((_, index) => isReassuring(list, index)).length;
  const added = Math.max(0, calmCount(reading) - calmCount(target));
  return negationCount(target) !== negationCount(reading) - added;
}

// Nur please darf die Stelle wechseln: Remove your coat, please. Wortsalat ist falsch, andere freie Stellungen gehören in die Fassungen.
function pleaseMoved(target, reading, keywords) {
  if (!target.includes(PLEASE) || !reading.includes(PLEASE)) {
    return false;
  }
  const rest = (list) => markKeywords(list.filter((token) => token !== PLEASE), keywords);
  return sameWords(rest(target), rest(reading));
}

// Bei Fragen ist die Stellung des Hilfsverbs der Lernstoff: You do have a pacemaker ist fast richtig, nicht glatt richtig.
function questionOrderChanged(candidate, reading) {
  const [first, second] = candidate.tokens;
  if (second === undefined || !QUESTION_STARTS.has(first) || !String(candidate.text).trim().endsWith("?")) {
    return false;
  }
  const firstAt = reading.indexOf(first);
  const secondAt = reading.indexOf(second);
  return firstAt === -1 || (secondAt !== -1 && secondAt < firstAt);
}

// ----- Fassungen und Eingabe -----

function candidatesOf(unit) {
  return [unit.en, ...(unit.variants ?? [])]
    .map((text) => ({ text, ...analyzeWords(text) }))
    .filter((candidate) => candidate.tokens.length > 0);
}

function readingsOf(text) {
  const first = tokens(text);
  const second = apostropheReading(first);
  return second ? [first, second] : [first];
}

// Ohne eigene Schlüsselwörter zählen die der jeweiligen Fassung, sonst wäre eine richtige Fassung falsch.
function keywordsOf(unit, candidate) {
  return unit.keywords && unit.keywords.length > 0 ? unit.keywords : deriveKeywords(candidate.text);
}

// Das Beste aus allen Fassungen und Lesarten. Bei Gleichstand gewinnt die erste, also en vor den Fassungen.
function bestOf(unit, text, judge) {
  let best = null;
  const readings = readingsOf(text);
  for (const candidate of candidatesOf(unit)) {
    const keywords = keywordsOf(unit, candidate);
    for (const reading of readings) {
      const judged = { ...judge(candidate, keywords, reading), against: candidate.text };
      if (
        best === null ||
        judged.rank > best.rank ||
        (judged.rank === best.rank &&
          (judged.share > best.share || (judged.share === best.share && judged.missing.length < best.missing.length)))
      ) {
        best = judged;
      }
    }
  }
  return best;
}

// ----- Getippt -----

// Zwei getippte Wörter, die zusammen ein Wort der Fassung mit Tippfehler sind: ear pulgs für earplugs.
function joinSplitTypos(reading, target) {
  const result = [];
  for (let index = 0; index < reading.length; index += 1) {
    const next = reading[index + 1];
    const both = next !== undefined && !target.includes(reading[index]) && !target.includes(next) ? reading[index] + next : null;
    if (both && target.some((word) => isTypo(both, word))) {
      result.push(both);
      index += 1;
    } else {
      result.push(reading[index]);
    }
  }
  return result;
}

function judgeTyped(candidate, keywords, reading) {
  const target = candidate.tokens;
  const exact = align(target, reading);
  const exactShare = exact.pairs.length / target.length;
  const exactMissing = missingKeywordsIn(reading, keywords);
  if (sameWords(target, reading)) {
    return { rank: TYPED_RANK.correct, outcome: "correct", share: 1, missing: [] };
  }
  if (exactShare >= WORD_SHARE && exactMissing.length === 0) {
    // Fehlt nur das not, kippt der Sinn: The scan does hurt. Das bleibt fast richtig, die Regel mit 80 % hieße sonst richtig.
    const negationFlip = negationsDiffer(target, reading);
    const outcome = negationFlip || questionOrderChanged(candidate, reading) ? "close" : "correct";
    return { rank: TYPED_RANK[outcome], outcome, share: exactShare, missing: [], negationFlip };
  }

  const joined = joinSplitTypos(reading, target);
  const fuzzy = align(target, joined, TYPO_WORD_LIMIT);
  const fuzzyShare = fuzzy.pairs.length / target.length;
  const repaired = [...joined];
  for (const pair of fuzzy.pairs) {
    repaired[pair.input] = target[pair.target];
  }
  const fuzzyMissing = missingKeywordsIn(repaired, keywords);
  if (fuzzy.typos > 0 && fuzzyShare >= WORD_SHARE && fuzzyMissing.length === 0) {
    return { rank: TYPED_RANK.close, outcome: "close", share: fuzzyShare, missing: [], negationFlip: negationsDiffer(target, repaired) };
  }
  if (fuzzyMissing.length === 0 && pleaseMoved(target, repaired, keywords)) {
    return { rank: TYPED_RANK.close, outcome: "close", share: fuzzyShare, missing: [] };
  }
  return { rank: TYPED_RANK.wrong, outcome: "wrong", share: fuzzyShare, missing: fuzzyMissing };
}

function flipMark(best) {
  return best.negationFlip === true && best.outcome !== "wrong" && best.outcome !== "notUnderstood" ? { negationFlip: true } : {};
}

export function matchTyped(unit, text) {
  const best = bestOf(unit, text, judgeTyped);
  if (!best) {
    return { outcome: "wrong", against: null, missingKeywords: [] };
  }
  return { outcome: best.outcome, against: best.against, missingKeywords: best.missing, ...flipMark(best) };
}

// ----- Gesprochen -----

function spokenOutcome({ stage, soft, heardNothing, equal, wordShare, keywords, missing }) {
  if (heardNothing) {
    return "notUnderstood";
  }
  if (equal) {
    return "understood";
  }
  const keywordShare = keywords.length > 0 ? (keywords.length - missing.length) / keywords.length : null;
  const allKeywords = missing.length === 0;

  // Eine freie Antwort ohne Inhaltswort, etwa Yes, you are doing really well. Sie fällt sehr verschieden aus, darum genügt mehr als die Hälfte.
  if (stage === "b" && soft && keywordShare === null) {
    return wordShare > PARTLY_WORD_SHARE ? "understood" : wordShare >= SOFT_PARTLY_SHARE ? "partly" : "notUnderstood";
  }

  if (stage === "b" && keywordShare !== null) {
    if (soft) {
      return keywordShare >= SOFT_UNDERSTOOD_SHARE ? "understood" : keywordShare >= SOFT_PARTLY_SHARE ? "partly" : "notUnderstood";
    }
    return allKeywords ? "understood" : keywordShare >= PARTLY_KEYWORD_SHARE ? "partly" : "notUnderstood";
  }

  // Stufe a. Auch Stufe b, wenn ein Satz ohne softKeywords gar kein Inhaltswort hat: Sonst wäre jede Antwort verstanden.
  if (wordShare >= WORD_SHARE && allKeywords) {
    return "understood";
  }
  return wordShare >= PARTLY_WORD_SHARE || (keywordShare !== null && allKeywords) ? "partly" : "notUnderstood";
}

export function matchSpoken(unit, transcript, { stage = "a" } = {}) {
  const best = bestOf(unit, transcript, (candidate, keywords, reading) => {
    const { pairs } = align(candidate.tokens, reading);
    const hit = new Set(pairs.map((pair) => pair.target));
    const recognized = candidate.surfaces.map((_, surfaceIndex) =>
      candidate.owners.every((owners, tokenIndex) => !owners.includes(surfaceIndex) || hit.has(tokenIndex)),
    );
    const wordShare = recognized.filter(Boolean).length / candidate.surfaces.length;
    const calm = withoutReassuring(reading);
    const missing = missingKeywordsIn(calm, keywords);
    const plain = spokenOutcome({
      stage,
      soft: unit.softKeywords === true,
      heardNothing: reading.length === 0,
      equal: reading.length > 0 && sameWords(candidate.tokens, reading),
      wordShare,
      keywords,
      missing,
    });
    // Freie Antworten fallen verschieden aus, dort sagt ein fehlendes not nichts. Ein zusätzliches kippt aber den Sinn: I will not stop the scan.
    const negationFlip =
      unit.softKeywords === true ? softNotCount(reading) - notsInHits(calm, keywords) > softNotCount(candidate.tokens) : negationsDiffer(candidate.tokens, reading);
    const outcome = negationFlip && plain === "understood" ? "partly" : plain;
    return {
      rank: SPOKEN_RANK[outcome],
      outcome,
      share: wordShare,
      missing,
      words: candidate.surfaces.map((word, index) => ({ word, status: recognized[index] ? "recognized" : "missing" })),
      negationFlip,
    };
  });
  if (!best) {
    return { outcome: "notUnderstood", words: [], missingKeywords: [], against: null };
  }
  return { outcome: best.outcome, words: best.words, missingKeywords: best.missing, against: best.against, ...flipMark(best) };
}
