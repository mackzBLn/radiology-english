/*
 * Kalendertage als Zeichenkette "YYYY-MM-DD". Gerechnet wird in UTC, damit die Zeitumstellung keinen Tag verschiebt.
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/UTC
 *   https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date#date_components_and_time_zones
 */

const MS_PER_DAY = 86400000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(number, width) {
  return String(number).padStart(width, "0");
}

// Millisekunden der UTC-Mitternacht dieses Tages. Unmögliche Tage wie der 30. Februar werden abgelehnt.
function toUtcMs(dateString) {
  const match = DATE_PATTERN.exec(dateString);
  if (!match) {
    throw new RangeError("Kein Datum im Format YYYY-MM-DD: " + dateString);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const check = new Date(ms);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new RangeError("Diesen Tag gibt es nicht: " + dateString);
  }
  return ms;
}

export function isDateString(value) {
  try {
    toUtcMs(value);
    return true;
  } catch {
    return false;
  }
}

// Lokale Zeit: Der Tag soll der sein, den die Nutzerin auf ihrer Uhr sieht.
export function toDateString(date) {
  return pad(date.getFullYear(), 4) + "-" + pad(date.getMonth() + 1, 2) + "-" + pad(date.getDate(), 2);
}

export function addDays(dateString, n) {
  const shifted = new Date(toUtcMs(dateString) + n * MS_PER_DAY);
  return pad(shifted.getUTCFullYear(), 4) + "-" + pad(shifted.getUTCMonth() + 1, 2) + "-" + pad(shifted.getUTCDate(), 2);
}

// b minus a, in ganzen Tagen.
export function daysBetween(a, b) {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / MS_PER_DAY);
}
