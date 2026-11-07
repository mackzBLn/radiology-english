/*
 * Bewertet einen erkannten Text. Die Schnittstelle bleibt für Stufe 2 offen, in Stufe 1 steckt die Browser-Erkennung dahinter:
 * Sie liefert nur Text, also misst sie Verständlichkeit, nicht einzelne Laute. Darum bleiben accuracy und scores leer.
 * against nennt die Fassung, gegen die words ausgerichtet sind. Die confidence der Erkennung wird nie genutzt (Gerätetest Lauf 3, Befund 7).
 */

import { matchSpoken } from "../core/matcher.js";

export function createBrowserAssessor() {
  return {
    assess({ unit, transcript, stage }) {
      const match = matchSpoken(unit, transcript, { stage });
      return {
        outcome: match.outcome,
        words: match.words.map(({ word, status }) => ({ word, status, accuracy: null })),
        scores: { accuracy: null, fluency: null, prosody: null },
        provider: "browser",
        against: match.against,
        ...(match.negationFlip ? { negationFlip: true } : {}),
      };
    },
  };
}
