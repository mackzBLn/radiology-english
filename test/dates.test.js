import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, daysBetween, isDateString, toDateString } from "../js/core/dates.js";

test("toDateString nimmt die lokale Zeit und füllt mit Nullen auf", () => {
  assert.equal(toDateString(new Date(2026, 0, 5, 0, 0, 0)), "2026-01-05");
  assert.equal(toDateString(new Date(2026, 10, 7, 23, 59, 59)), "2026-11-07");
});

test("addDays geht über Monats- und Jahresgrenzen", () => {
  assert.equal(addDays("2026-11-07", 0), "2026-11-07");
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2027-01-01", -1), "2026-12-31");
  assert.equal(addDays("2026-11-07", 30), "2026-12-07");
});

test("addDays kennt Schaltjahre", () => {
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2027-02-28", 1), "2027-03-01");
});

test("Die Tage um die Zeitumstellung zählen als volle Tage", () => {
  assert.equal(addDays("2026-03-28", 1), "2026-03-29");
  assert.equal(addDays("2026-03-29", 1), "2026-03-30");
  assert.equal(addDays("2026-10-24", 1), "2026-10-25");
  assert.equal(addDays("2026-10-25", 1), "2026-10-26");
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2);
  assert.equal(daysBetween("2026-10-24", "2026-10-26"), 2);
});

test("daysBetween rechnet b minus a", () => {
  assert.equal(daysBetween("2026-11-07", "2026-11-07"), 0);
  assert.equal(daysBetween("2026-11-07", "2026-11-14"), 7);
  assert.equal(daysBetween("2026-11-14", "2026-11-07"), -7);
  assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
});

test("addDays und daysBetween passen zusammen", () => {
  for (const n of [-400, -30, -1, 0, 1, 14, 30, 400]) {
    assert.equal(daysBetween("2026-11-07", addDays("2026-11-07", n)), n);
  }
});

test("Falsche Daten werden abgelehnt", () => {
  assert.throws(() => addDays("07.11.2026", 1), RangeError);
  assert.throws(() => addDays("2026-02-30", 1), RangeError);
  assert.throws(() => daysBetween("2026-13-01", "2026-11-07"), RangeError);
  assert.equal(isDateString("2026-11-07"), true);
  assert.equal(isDateString("2026-11-31"), false);
  assert.equal(isDateString("heute"), false);
  assert.equal(isDateString(null), false);
});
