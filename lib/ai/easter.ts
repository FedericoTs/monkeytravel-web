/**
 * Easter Sunday's date in a year, as YYYY-MM-DD in the Gregorian calendar: the Western churches' (Meeus/Jones/Butcher)
 * or the Orthodox churches' (Meeus's Julian computation, moved 13 days to the Gregorian calendar, which holds from
 * 1900 to 2099). Sights close on it whatever its weekday: Greece's sites and museums on the Orthodox one.
 */
export function easterSunday(year: number, church: "western" | "orthodox"): string {
  let month: number;
  let day: number;
  if (church === "western") {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    month = Math.floor((h + l - 7 * m + 114) / 31);
    day = ((h + l - 7 * m + 114) % 31) + 1;
  } else {
    const d = (19 * (year % 19) + 15) % 30;
    const e = (2 * (year % 4) + 4 * (year % 7) - d + 34) % 7;
    month = Math.floor((d + e + 114) / 31);
    day = ((d + e + 114) % 31) + 1;
    const gregorian = new Date(Date.UTC(year, month - 1, day + 13));
    month = gregorian.getUTCMonth() + 1;
    day = gregorian.getUTCDate();
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
