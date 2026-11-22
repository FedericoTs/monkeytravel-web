/**
 * The closing days of the sights plans hold most, each from its official page (or the city's or region's official
 * tourism page where the place's own is unreachable). The closing-day question (closing-days.ts) asks the model, and
 * its answer for the same place changes from one call to the next. For a listed place the list decides instead:
 * on a trip inside the window its dates were checked for, the model's answer for it is replaced by the trip's dates
 * the list shuts it on; on a later trip the list's dates are added to the model's answer. Places of any kind are
 * listed, gardens and markets too, and places open every day, so a wrong "closed" from the model doesn't move them.
 */
import type { Weekday } from "@/lib/ai/closing-days";
import { easterSunday } from "@/lib/ai/easter";
import { isMealStop } from "@/lib/trip/pace";

/** Sunday first, as Date.getUTCDay() counts (closing-days.ts imports this file, so its own list isn't used here). */
const WEEKDAYS: readonly Weekday[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The window the list's dated closures were checked for. Weekly and yearly rules hold beyond it. */
export const CHECKED_FROM = "2026-11-15";
export const CHECKED_UNTIL = "2027-03-31";

/** Days of every year, as month-day (MM-DD), both ends included. A span may run into the new year (12-29 to 01-03). */
type YearlySpan = { from: string; to: string };

type Rule =
  /** Shut every week on these days. With `holidayShift`, a Japanese national holiday on one of them opens the place
   * and the next day that is neither a holiday nor shut anyway is shut instead (Japan's museums and gardens). */
  | { weekly: Weekday[]; holidayShift?: "jp" }
  /** Shut on the nth (1-5) of a weekday in each month, e.g. the 2nd and 4th Tuesday. */
  | { nth: Weekday; of: number[] }
  /** Shut from one date to another, both included. */
  | { from: string; to: string }
  /** Shut on the same days every year. Only where the official page states it as a standing rule ("closed 1 January,
   * 1 May and 25 December"), not a dated notice. */
  | { yearly: YearlySpan }
  /** Shut on Thanksgiving Day in the US, the fourth Thursday of November. */
  | { thanksgiving: true }
  /** Shut on Easter Sunday, the Western churches' or the Orthodox churches', whose date moves each year. */
  | { easter: "western" | "orthodox" }
  /** Shut on Sundays except the last Sunday of the month. */
  | { sundaysButLast: true };

export type KnownClosing = {
  /** What a plan calls it. */
  names: RegExp;
  /** Names it shares with other places. */
  notNames?: RegExp;
  /** The trip's destination, as the traveller wrote it. */
  city: RegExp;
  /** None: open every day. */
  rules: Rule[];
  /** Days a rule above would shut it, that it is open. */
  openOn?: string[];
  /** Seasons of every year it is open every day, its weekly closure aside (Shinjuku Gyoen's cherry-blossom weeks). */
  openEveryYear?: YearlySpan[];
  /** Its opening hours through the year, from its official page. The first row that matches a date holds. */
  hours?: HoursRow[];
  /** The page the hours come from, when it isn't `source`. */
  hoursSource?: string;
  /** The official page the rules come from. */
  source: string;
};

/** Opening hours, local time ("09:00"), on the days of every year from one month-day to another, on some weekdays
 * only when `days` is given (the Louvre's late Wednesdays and Fridays come before its usual row). */
export type HoursRow = { from: string; to: string; days?: Weekday[]; open: string; close: string; lastEntry?: string };

/** A day's opening hours, in minutes after midnight. */
export type OpenHours = { open: number; close: number; lastEntry?: number };

/**
 * Japan's national holidays, from the Cabinet Office's list (https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html,
 * syukujitsu.csv), substitute holidays included. It covers the years the Cabinet Office has published; a trip after
 * them gets the plain weekly closure.
 */
export const JAPAN_HOLIDAYS = new Set([
  "2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20", "2026-04-29", "2026-05-03", "2026-05-04",
  "2026-05-05", "2026-05-06", "2026-07-20", "2026-08-11", "2026-09-21", "2026-09-22", "2026-09-23", "2026-10-12",
  "2026-11-03", "2026-11-23", "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-21", "2027-03-22",
  "2027-04-29", "2027-05-03", "2027-05-04", "2027-05-05", "2027-07-19", "2027-08-11", "2027-09-20", "2027-09-23",
  "2027-10-11", "2027-11-03", "2027-11-23",
]);

const TOKYO = /\btok[iy]o\b|\bt[oó]quio\b|東京/i;
const KYOTO = /\bkyoto\b|\bkioto\b|\bquioto\b|京都/i;
const BANGKOK = /\bbangkok\b|\bbangkoc\b|\bbanguecoque\b|กรุงเทพ/i;
const PARIS = /\bparis\b|\bparigi\b|\bpar[ií]s\b/i;
const ROME = /\brom[ae]\b|\broma\b/i;
const BARCELONA = /\bbarcelon[ae]\b/i;
const LONDON = /\blondon\b|\blondres\b|\blondra\b/i;
const NEW_YORK = /\bnew york\b|\bnueva york\b|\bnova york\b|\bnyc\b/i;
const MEXICO_CITY = /\bmexico city\b|\bciudad de m[eé]xico\b|\bcdmx\b|\bcitt[aà] del messico\b|\bcidade do m[eé]xico\b/i;
const KANAZAWA = /\bkanazawa\b|金沢/i;
/** Nara is a day out from Kyoto or Osaka as often as a stay. */
const NARA_KYOTO_OSAKA = /\bnara\b|奈良|\bkyoto\b|\bkioto\b|\bquioto\b|京都|\bosaka\b|大阪/i;
const ATHENS = /\bathens\b|\batene\b|\batenas\b|αθήνα/i;
const GRANADA = /\bgranada\b/i;
const EDINBURGH = /\bedinburgh\b|\bedimburgo\b/i;
/** Neuschwanstein is a day out from Munich or Füssen. */
const BAVARIA = /\bm[uü]nchen\b|\bmunich\b|\bm[uú]nich\b|\bmunique\b|\bmonaco di baviera\b|\bf[uü]ssen\b|\bschwangau\b|\bbavaria\b|\bbaviera\b|\bbayern\b/i;
const VIENNA = /\bvienna\b|\bwien\b|\bviena\b|\bvienne\b/i;
const HANOI = /\bha ?noi\b|\bh[aà] n[oộ]i\b/i;
const BALI = /\bbali\b|\bubud\b|\bseminyak\b|\bcanggu\b|\bcanga\b|\bkuta\b|\buluwat[ui]\b|\bsanur\b|\bnusa dua\b|\bdenpasar\b|\bjimbaran\b|\btampaksiring\b/i;
const GOA = /\bgoa\b|\bpanaji\b|\bpanjim\b/i;
const MUNNAR = /\bmunnar\b|\bkerala\b|\bidukki\b/i;
const OSAKA = /\bosaka\b|\bosaca\b|大阪/i;
const AGRA = /\bagra\b|आगरा/i;
const DELHI = /\bdelhi\b|\bnova d[eé]li\b|दिल्ली/i;
const JODHPUR = /\bjodhpur\b/i;
const HYDERABAD = /\bhyderabad\b|\bhaidarabad\b/i;
// Ajanta and Ellora are reached from Chhatrapati Sambhajinagar, until 2023 Aurangabad.
const AJANTA_ELLORA = /\baurangabad\b|\bsambhajinagar\b|\bajanta\b|\bellora\b/i;
const MUMBAI = /\bmumbai\b|\bbombay\b|\bbombaim\b|मुंबई/i;
const MYSURU = /\bmysuru\b|\bmysore\b/i;
const KOCHI = /\bkochi\b|\bcochin\b|\bmattancherry\b|\bernakulam\b|\bkerala\b/i;
const CHENNAI = /\bchennai\b|\bmadras\b/i;

const day = (date: string) => ({ from: date, to: date });
/** Shut every year from one month-day to another (or on one), e.g. yearly("12-29", "01-03"). */
const yearly = (from: string, to = from): Rule => ({ yearly: { from, to } });
const OPEN_EVERY_DAY: Rule[] = [];
/** India's national holidays: Republic Day, Independence Day and Gandhi Jayanti. */
const INDIA_NATIONAL_HOLIDAYS: Rule[] = [yearly("01-26"), yearly("08-15"), yearly("10-02")];

export const KNOWN_CLOSINGS: KnownClosing[] = [
  // Tokyo
  {
    // The two decks shut on alternate days, so one is always open; both shut over the New Year but on New Year's Day.
    names: /\btokyo metropolitan government\b|\bmetropolitan government (?:building|bldg)\b|\btocho\b|東京都庁/i,
    city: TOKYO,
    rules: [yearly("12-29", "12-31"), yearly("01-02", "01-03")],
    hours: [
      { from: "01-01", to: "12-31", open: "09:30", close: "22:00", lastEntry: "21:30" },
    ],
    source: "https://www.zaimu.metro.tokyo.lg.jp/tochousha/goannai/tenbou",
  },
  { names: /\bmeiji (?:jingu|shrine)\b|明治神宮/i, city: TOKYO, rules: OPEN_EVERY_DAY, hours: [{ from: "01-01", to: "01-31", open: "06:40", close: "16:20" }, { from: "02-01", to: "02-29", open: "06:20", close: "16:50" }, { from: "03-01", to: "03-31", open: "05:40", close: "17:20" }, { from: "04-01", to: "04-30", open: "05:10", close: "17:50" }, { from: "05-01", to: "05-31", open: "05:00", close: "18:10" }, { from: "06-01", to: "06-30", open: "05:00", close: "18:30" }, { from: "07-01", to: "07-31", open: "05:00", close: "18:20" }, { from: "08-01", to: "08-31", open: "05:00", close: "18:00" }, { from: "09-01", to: "09-30", open: "05:20", close: "17:20" }, { from: "10-01", to: "10-31", open: "05:40", close: "16:40" }, { from: "11-01", to: "11-30", open: "06:10", close: "16:10" }, { from: "12-01", to: "12-31", open: "06:40", close: "16:00" }], source: "https://www.meijijingu.or.jp/en/visit/" },
  { names: /\bsens[oō]-?ji\b|\basakusa kannon\b|浅草寺/i, city: TOKYO, rules: OPEN_EVERY_DAY, source: "https://www.senso-ji.jp/visit/" },
  {
    names: /\btokyo national museum\b|東京国立博物館|\bmuseo nacional de tokio\b|\bmuseo nazionale di tokyo\b|\bmuseu nacional de t[oó]quio\b/i,
    city: TOKYO,
    rules: [{ weekly: ["Monday"], holidayShift: "jp" }, day("2026-12-15"), { from: "2026-12-26", to: "2026-12-31" }],
    openOn: ["2027-03-29"],
    hours: [
      { from: "01-01", to: "12-31", days: ["Friday", "Saturday"], open: "09:30", close: "20:00", lastEntry: "19:30" },
      { from: "01-01", to: "12-31", open: "09:30", close: "17:00", lastEntry: "16:30" },
    ],
    source: "https://www.tnm.jp/modules/r_free_page/index.php?id=113&lang=en",
  },
  {
    names: /\bteamlab planets\b/i,
    city: TOKYO,
    rules: [day("2026-12-03"), day("2027-01-14")],
    source: "https://www.teamlab.art/e/planets/",
  },
  {
    // The east gardens only: the outer gardens and Nijubashi stay open.
    names: /\bimperial palace east gardens?\b|\beast gardens? of the imperial palace\b|\bhigashi[- ]?gyoen\b|皇居東御苑|\bjard[ií]n(?:es)? (?:del )?este del palacio imperial\b|\bgiardin[oi] orientali? del palazzo imperiale\b|\bjardi(?:m|ns) (?:do )?leste do pal[aá]cio imperial\b/i,
    city: TOKYO,
    rules: [{ weekly: ["Monday", "Friday"], holidayShift: "jp" }, yearly("12-28", "01-03")],
    openOn: ["2026-11-30", "2026-12-04"],
    hours: [
      { from: "03-01", to: "04-14", open: "09:00", close: "17:00", lastEntry: "16:30" },
      { from: "04-15", to: "08-31", open: "09:00", close: "18:00", lastEntry: "17:30" },
      { from: "09-01", to: "09-30", open: "09:00", close: "17:00", lastEntry: "16:30" },
      { from: "10-01", to: "10-31", open: "09:00", close: "16:30", lastEntry: "16:00" },
      { from: "11-01", to: "02-29", open: "09:00", close: "16:00", lastEntry: "15:30" },
    ],
    source: "https://www.kunaicho.go.jp/en/visit/event/higashigyoen/index.html",
  },
  {
    // Open on Mondays too in the cherry-blossom weeks and the chrysanthemum show.
    names: /\bshinjuku gyoen\b|新宿御苑/i,
    city: TOKYO,
    rules: [{ weekly: ["Monday"], holidayShift: "jp" }, yearly("12-29", "01-03")],
    openEveryYear: [{ from: "03-25", to: "04-24" }, { from: "11-01", to: "11-15" }],
    hours: [
      { from: "06-11", to: "07-31", open: "09:00", close: "19:00", lastEntry: "18:30" },
      { from: "03-15", to: "09-30", open: "09:00", close: "18:00", lastEntry: "17:30" },
      { from: "10-01", to: "03-14", open: "09:00", close: "16:30", lastEntry: "16:00" },
    ],
    source: "https://policies.env.go.jp/national-garden/shinjukugyoen/guide/information/",
  },
  {
    names: /\bghibli museum\b|\bmuseo ghibli\b|\bmus[eé]e ghibli\b|\bmuseu ghibli\b|ジブリ美術館/i,
    city: TOKYO,
    rules: [{ weekly: ["Tuesday"] }, { from: "2026-11-04", to: "2026-11-18" }, { from: "2026-12-27", to: "2027-01-02" }],
    openOn: ["2027-01-05", "2027-02-23"],
    hours: [
      { from: "01-01", to: "12-31", open: "10:00", close: "18:00" },
    ],
    hoursSource: "https://www.ghibli-museum.jp/en/hours-and-directions/",
    source: "https://www.ghibli-museum.jp/en/tickets/",
  },
  // Tokyo's metropolitan gardens: open every day but over the New Year.
  {
    names: /\bhama[- ]?rikyu\b|浜離宮/i,
    city: TOKYO,
    rules: [yearly("12-29", "01-01")],
    hours: [
      { from: "01-01", to: "12-31", open: "09:00", close: "17:00", lastEntry: "16:30" },
    ],
    source: "https://www.tokyo-park.or.jp/teien/en/hama-rikyu/outline.html",
  },
  { names: /\brikugi-?en\b|六義園/i, city: TOKYO, rules: [yearly("12-29", "01-01")], hours: [{ from: "01-01", to: "12-31", open: "09:00", close: "17:00", lastEntry: "16:30" }], source: "https://www.tokyo-park.or.jp/teien/en/rikugien/outline.html" },
  {
    // Not the University of Tokyo's Koishikawa Botanical Garden, a different place.
    names: /\bkoishikawa[- ]?k[oō]rakuen\b|小石川後楽園/i,
    city: TOKYO,
    rules: [yearly("12-29", "01-01")],
    hours: [
      { from: "01-01", to: "12-31", open: "09:00", close: "17:00", lastEntry: "16:30" },
    ],
    source: "https://www.tokyo-park.or.jp/teien/en/koishikawa/outline.html",
  },
  {
    // The garden only, not the Kiyosumi-Shirakawa neighbourhood and its cafés.
    names: /\bkiyosumi (?:gardens?|teien)\b|清澄庭園/i,
    city: TOKYO,
    rules: [yearly("12-29", "01-01")],
    hours: [
      { from: "01-01", to: "12-31", open: "09:00", close: "17:00", lastEntry: "16:30" },
    ],
    source: "https://www.tokyo-park.or.jp/teien/en/kiyosumi/outline.html",
  },
  {
    names: /\bkyu[- ]?shiba[- ]?rikyu\b|\bformer shiba detached palace\b|旧芝離宮/i,
    city: TOKYO,
    rules: [yearly("12-29", "01-01")],
    hours: [
      { from: "01-01", to: "12-31", open: "09:00", close: "17:00", lastEntry: "16:30" },
    ],
    source: "https://www.tokyo-park.or.jp/teien/en/kyu-shiba/outline.html",
  },
  {
    names: /\bkyu[- ]?furukawa\b|\bformer furukawa\b|旧古河庭園/i,
    city: TOKYO,
    rules: [yearly("12-29", "01-01")],
    hours: [
      { from: "01-01", to: "12-31", open: "09:00", close: "17:00", lastEntry: "16:30" },
    ],
    source: "https://www.tokyo-park.or.jp/teien/en/kyu-furukawa/outline.html",
  },
  {
    names: /\bkyu[- ]?iwasaki[- ]?tei\b|\bformer iwasaki (?:residence|house)\b|旧岩崎邸/i,
    city: TOKYO,
    rules: [yearly("12-29", "01-01")],
    hours: [
      { from: "01-01", to: "12-31", open: "09:00", close: "17:00", lastEntry: "16:30" },
    ],
    source: "https://www.tokyo-park.or.jp/teien/en/kyu-iwasaki/outline.html",
  },
  { names: /\btonogayato\b|殿ヶ谷戸/i, city: TOKYO, rules: [yearly("12-29", "01-01")], hours: [{ from: "01-01", to: "12-31", open: "09:00", close: "17:00", lastEntry: "16:30" }], source: "https://www.tokyo-park.or.jp/teien/en/tonogayato/outline.html" },
  {
    // Its New Year closure runs two days longer than the other gardens'.
    names: /\bmukojima[- ]?hyakkaen\b|向島百花園/i,
    city: TOKYO,
    rules: [yearly("12-29", "01-03")],
    hours: [
      { from: "01-01", to: "12-31", open: "09:00", close: "17:00", lastEntry: "16:30" },
    ],
    source: "https://www.tokyo-park.or.jp/teien/en/mukojima/outline.html",
  },
  {
    names: /\bginza (?:six|6)\b|ギンザシックス/i,
    city: TOKYO,
    rules: [{ from: "2027-01-01", to: "2027-01-02" }],
    hours: [
      { from: "01-01", to: "12-31", open: "10:30", close: "20:30" },
    ],
    hoursSource: "https://ginza6.tokyo/hours/",
    source: "https://ginza6.tokyo/news/detail/info/224389",
  },
  {
    names: /\bnational museum of nature and science\b|国立科学博物館/i,
    city: TOKYO,
    rules: [{ weekly: ["Monday"], holidayShift: "jp" }, { from: "2026-12-28", to: "2027-01-01" }],
    hours: [
      { from: "01-01", to: "12-31", open: "09:00", close: "17:00", lastEntry: "16:30" },
    ],
    source: "https://www.kahaku.go.jp/english/riyou/nyukan-annai/",
  },
  // Kyoto
  {
    names: /\bkyoto imperial palace\b|\bkyoto gosho\b|京都御所|\bpalacio imperial de kioto\b|\bpalazzo imperiale di kyoto\b|\bpal[aá]cio imperial de quioto\b/i,
    notNames: /\bsento\b/i,
    city: KYOTO,
    rules: [{ weekly: ["Monday"], holidayShift: "jp" }, yearly("12-28", "01-04")],
    source: "https://kyoto-gosho.kunaicho.go.jp/en",
  },
  {
    names: /\bkyoto national museum\b|京都国立博物館/i,
    city: KYOTO,
    rules: [{ weekly: ["Monday"], holidayShift: "jp" }],
    hours: [
      { from: "01-01", to: "12-31", days: ["Friday"], open: "09:30", close: "20:00", lastEntry: "19:30" },
      { from: "01-01", to: "12-31", open: "09:30", close: "17:00", lastEntry: "16:30" },
    ],
    hoursSource: "https://www.kyohaku.go.jp/eng/visit/info/",
    source: "https://www.kyohaku.go.jp/eng/visit/faq/",
  },
  { names: /\bfushimi inari\b|伏見稲荷/i, city: KYOTO, rules: OPEN_EVERY_DAY, source: "https://kyoto.travel/en/travel-inspiration/11-secret-tips-for-enjoying-kyoto-from-a-local-taxi-driver/" },
  { names: /\barashiyama bamboo\b|\bsagano bamboo\b|嵐山.*竹/i, city: KYOTO, rules: OPEN_EVERY_DAY, source: "https://kyoto.travel/en/see-and-do/Taste_of_Kyoto_Sightseeing.html" },
  // Bangkok
  {
    // The general market keeps Friday to Sunday; on other days only the plant section opens.
    names: /\bchatuchak\b|\bjatujak\b|\bjj market\b/i,
    notNames: /\bpark\b|\bparque\b|\bparco\b/i,
    city: BANGKOK,
    rules: [{ weekly: ["Monday", "Tuesday", "Wednesday", "Thursday"] }],
    hours: [
      { from: "01-01", to: "12-31", open: "05:00", close: "18:00" },
    ],
    source: "https://publicspace.bangkok.go.th/Spaces/Info/2FBD1377-1BC8-4565-86CA-2C647E59F18A",
  },
  { names: /\bjim thompson house\b/i, city: BANGKOK, rules: OPEN_EVERY_DAY, hours: [{ from: "01-01", to: "12-31", open: "10:00", close: "17:00" }], source: "https://jimthompsonhouse.org/visitor-information/" },
  { names: /\bor tor kor\b/i, city: BANGKOK, rules: OPEN_EVERY_DAY, source: "https://www.mof.or.th/posts?m_id=19&ac_id=461" },
  { names: /\bwat pho\b|\breclining buddha\b|\bwat phra chetuphon\b/i, city: BANGKOK, rules: OPEN_EVERY_DAY, hours: [{ from: "01-01", to: "12-31", open: "08:00", close: "19:30" }], source: "https://www.watpho.com/th/contact/plan" },
  { names: /\blum(?:ph|p)ini park\b/i, city: BANGKOK, rules: OPEN_EVERY_DAY, hours: [{ from: "01-01", to: "12-31", open: "04:30", close: "22:00" }], source: "https://publicspace.bangkok.go.th/Spaces/Info/B38EC1D0-49FE-4544-A709-AF9ED243ECCD" },
  { names: /\basiatique\b/i, city: BANGKOK, rules: OPEN_EVERY_DAY, source: "https://www.asiatiquethailand.com/" },
  { names: /\bgrand palace\b|\bwat phra kaew\b|\bemerald buddha\b|\bgran palacio\b|\bgrande? palazzo reale\b|\bgrande pal[aá]cio\b/i, city: BANGKOK, rules: OPEN_EVERY_DAY, hours: [{ from: "01-01", to: "12-31", open: "08:30", close: "16:30", lastEntry: "15:30" }], source: "https://www.royalgrandpalace.th/en/visit/practical-information" },
  // Paris
  {
    names: /\bmus[eé]e d.orsay\b|\borsay museum\b|\bmuseo d.orsay\b|\bmuseu d.orsay\b/i,
    city: PARIS,
    rules: [{ weekly: ["Monday"] }, yearly("05-01"), yearly("12-25")],
    hours: [
      { from: "01-01", to: "12-31", days: ["Thursday"], open: "09:30", close: "21:45" },
      { from: "01-01", to: "12-31", open: "09:30", close: "18:00", lastEntry: "17:00" },
    ],
    source: "https://www.visitparisregion.com/en/musee-d-orsay",
  },
  {
    names: /\bsainte[- ]chapelle\b/i,
    city: PARIS,
    rules: [yearly("01-01"), yearly("05-01"), yearly("12-25")],
    hours: [
      { from: "04-01", to: "09-30", open: "09:00", close: "19:00", lastEntry: "18:30" },
      { from: "10-01", to: "03-31", open: "09:00", close: "17:00", lastEntry: "16:30" },
    ],
    source: "https://www.sainte-chapelle.fr/en/visit/practical-information",
  },
  {
    names: /\blouvre\b/i,
    notNames: /\babu dhabi\b|\blens\b|\bdes antiquaires\b/i,
    city: PARIS,
    rules: [{ weekly: ["Tuesday"] }, yearly("01-01"), yearly("05-01"), yearly("12-25")],
    hours: [
      { from: "01-01", to: "12-31", days: ["Wednesday", "Friday"], open: "09:00", close: "21:00", lastEntry: "20:00" },
      { from: "01-01", to: "12-31", open: "09:00", close: "18:00", lastEntry: "17:00" },
    ],
    source: "https://www.louvre.fr/en/visit/hours-admission",
  },
  {
    // The covered market is shut after a fire, with no reopening date; a few stalls trade on the street outside.
    names: /\benfants[- ]rouges\b/i,
    city: PARIS,
    rules: [{ from: CHECKED_FROM, to: CHECKED_UNTIL }],
    hours: [
      { from: "01-01", to: "12-31", days: ["Sunday"], open: "08:30", close: "17:00" },
      { from: "01-01", to: "12-31", open: "08:30", close: "20:30" },
    ],
    source: "https://www.paris.fr/lieux/marche-couvert-des-enfants-rouges-5461",
  },
  { names: /\bsacr[eé][- ]c(?:œ|oe|o)ur\b/i, city: PARIS, rules: OPEN_EVERY_DAY, hours: [{ from: "01-01", to: "12-31", open: "06:30", close: "22:30" }], source: "https://www.sacre-coeur-montmartre.com/en/info-and-visits/practical-information/hours-and-directions/" },
  { names: /\bmus[eé]e de montmartre\b|\bjardins? renoir\b/i, city: PARIS, rules: OPEN_EVERY_DAY, hours: [{ from: "03-01", to: "09-30", open: "10:00", close: "19:00", lastEntry: "18:15" }, { from: "10-01", to: "02-29", open: "10:00", close: "18:00", lastEntry: "17:15" }], source: "https://www.museedemontmartre.fr/en/practical-informations" },
  // Rome
  {
    names: /\bcastel sant.?angelo\b|\bcastillo de sant.?angelo\b|\bcastelo de sant.?angelo\b|\bmausoleum of hadrian\b/i,
    city: ROME,
    rules: [{ weekly: ["Monday"] }, yearly("12-25"), yearly("01-01")],
    hours: [
      { from: "01-01", to: "12-31", open: "09:00", close: "19:30", lastEntry: "18:30" },
    ],
    source: "https://www.turismoroma.it/en/places/santangelo-castle",
  },
  {
    names: /\bpantheon\b|\bpante[oó]n\b|\bpante[aã]o\b/i,
    city: ROME,
    rules: [yearly("12-25"), yearly("01-01")],
    hours: [
      { from: "01-01", to: "12-31", open: "09:00", close: "19:00", lastEntry: "18:30" },
    ],
    source: "https://www.pantheonroma.com/en/openings-info/",
  },
  {
    // Open the last Sunday of the month, except on Easter (28 March 2027).
    names: /\bvatican museums?\b|\bmusei vaticani\b|\bmuseos vaticanos\b|\bmuseus do vaticano\b|\bsistine chapel\b|\bcappella sistina\b|\bcapilla sixtina\b|\bcapela sistina\b/i,
    city: ROME,
    rules: [
      { sundaysButLast: true },
      day("2026-12-08"),
      { from: "2026-12-25", to: "2026-12-26" },
      day("2027-01-01"),
      day("2027-01-06"),
      day("2027-02-11"),
      day("2027-03-19"),
      { from: "2027-03-28", to: "2027-03-29" },
    ],
    hours: [
      { from: "01-01", to: "12-31", days: ["Sunday"], open: "09:00", close: "14:00", lastEntry: "12:30" },
      { from: "01-01", to: "12-31", open: "08:00", close: "20:00", lastEntry: "18:00" },
    ],
    hoursSource: "https://www.museivaticani.va/content/museivaticani/en/info/orari-musei-vaticani.html",
    source: "https://www.museivaticani.va/content/dam/museivaticani/pdf/utilities/calendario_musei.pdf",
  },
  {
    names: /\bcolosse(?:um|o)\b|\bcoliseo\b|\bcoliseu\b|\broman forum\b|\bforo romano\b|\bf[oó]rum romano\b|\bpalatin(?:e|o) hill\b|\bmonte palatino\b/i,
    // The Square Colosseum (Palazzo della Civiltà Italiana) in EUR is another building.
    notNames: /\bquadrato\b|\bsquare colosseum\b/i,
    city: ROME,
    rules: [day("2026-12-25"), day("2027-01-01")],
    hours: [
      { from: "03-01", to: "03-28", open: "08:30", close: "17:30", lastEntry: "16:30" },
      { from: "03-29", to: "09-30", open: "08:30", close: "19:15", lastEntry: "18:15" },
      { from: "10-01", to: "10-24", open: "08:30", close: "18:30", lastEntry: "17:30" },
      { from: "10-25", to: "02-29", open: "08:30", close: "16:30", lastEntry: "15:30" },
    ],
    source: "https://www.turismoroma.it/en/node/1155",
  },
  {
    names: /\bgaller(?:ia|y|ie)\s+borghese\b|\bborghese gallery\b/i,
    city: ROME,
    rules: [{ weekly: ["Monday"] }, yearly("12-25"), yearly("01-01")],
    hours: [
      { from: "01-01", to: "12-31", open: "09:00", close: "19:00", lastEntry: "17:45" },
    ],
    hoursSource: "https://www.turismoroma.it/en/places/borghese-gallery",
    source: "https://galleriaborghese.cultura.gov.it/visita/",
  },
  {
    names: /\bcapitoline museums?\b|\bmusei capitolini\b|\bmuseos capitolinos\b|\bmuseus capitolinos\b/i,
    city: ROME,
    rules: [yearly("05-01"), yearly("12-25")],
    hours: [
      { from: "12-24", to: "12-24", open: "09:30", close: "14:00", lastEntry: "13:00" },
      { from: "12-31", to: "12-31", open: "09:30", close: "14:00", lastEntry: "13:00" },
      { from: "01-01", to: "12-31", open: "09:30", close: "19:30", lastEntry: "18:30" },
    ],
    source: "https://www.museicapitolini.org/en/informazioni_pratiche/orari_e_indirizzi",
  },
  // Barcelona
  // The market's Christmas notices, the same each year: shut on Christmas Day, St Stephen's Day, New Year's Day and Epiphany.
  { names: /\bboqueria\b|\bmercat de sant josep\b/i, city: BARCELONA, rules: [{ weekly: ["Sunday"] }, yearly("12-25", "12-26"), yearly("01-01"), yearly("01-06")], hours: [{ from: "01-01", to: "12-31", open: "08:00", close: "20:30" }], hoursSource: "https://ajuntament.barcelona.cat/memoriademocratica/en/detail/mercat-boqueria-sant-josep_92086009447", source: "https://www.boqueria.barcelona/boqueria-opening-hours-during-christmas-n-352-en" },
  { names: /\bpar(?:k|c|que) g[uü]ell\b/i, city: BARCELONA, rules: OPEN_EVERY_DAY, source: "https://parkguell.barcelona/en/planning-your-visit/prices-and-times" },
  { names: /\bsagrada fam[ií]lia\b/i, city: BARCELONA, rules: OPEN_EVERY_DAY, hours: [{ from: "12-25", to: "12-26", open: "09:00", close: "14:00" }, { from: "01-01", to: "01-01", open: "09:00", close: "14:00" }, { from: "01-06", to: "01-06", open: "09:00", close: "14:00" }, { from: "11-01", to: "02-29", days: ["Sunday"], open: "10:30", close: "18:00" }, { from: "11-01", to: "02-29", open: "09:00", close: "18:00" }, { from: "03-01", to: "03-31", days: ["Saturday"], open: "09:00", close: "18:00" }, { from: "03-01", to: "03-31", days: ["Sunday"], open: "10:30", close: "19:00" }, { from: "03-01", to: "03-31", open: "09:00", close: "19:00" }, { from: "10-01", to: "10-31", days: ["Saturday"], open: "09:00", close: "18:00" }, { from: "10-01", to: "10-31", days: ["Sunday"], open: "10:30", close: "19:00" }, { from: "10-01", to: "10-31", open: "09:00", close: "19:00" }, { from: "04-01", to: "09-30", days: ["Saturday"], open: "09:00", close: "18:00" }, { from: "04-01", to: "09-30", days: ["Sunday"], open: "10:30", close: "20:00" }, { from: "04-01", to: "09-30", open: "09:00", close: "20:00" }], source: "https://sagradafamilia.org/en/schedules-how-to-get" },
  // London
  {
    // Shut on Mondays, but open every day from 30 November through December.
    names: /\bborough market\b/i,
    city: LONDON,
    rules: [{ weekly: ["Monday"] }, { from: "2026-12-25", to: "2026-12-27" }, day("2027-01-01")],
    openOn: ["2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28"],
    hours: [
      { from: "01-01", to: "12-31", days: ["Saturday"], open: "09:00", close: "17:00" },
      { from: "01-01", to: "12-31", days: ["Sunday"], open: "10:00", close: "16:00" },
      { from: "01-01", to: "12-31", open: "10:00", close: "17:00" },
    ],
    hoursSource: "https://boroughmarket.org.uk/visit-us/",
    source: "https://boroughmarket.org.uk/events/bank-holiday-opening-times/",
  },
  {
    names: /\bnatural history museum\b|\bmuseo de historia natural\b|\bmuseo di storia naturale\b|\bmuseu de hist[oó]ria natural\b/i,
    city: LONDON,
    rules: [yearly("12-24", "12-26")],
    hours: [
      { from: "01-01", to: "12-31", open: "10:00", close: "17:50", lastEntry: "17:30" },
    ],
    source: "https://www.nhm.ac.uk/visit.html",
  },
  // New York
  {
    names: /\bmetropolitan museum of art\b|\bthe met\b|\bmet (?:fifth avenue|museum)\b/i,
    notNames: /\bcloisters\b|\bbreuer\b|\bopera\b/i,
    city: NEW_YORK,
    rules: [{ weekly: ["Wednesday"] }, { thanksgiving: true }, day("2026-12-25"), day("2027-01-01")],
    source: "https://www.metmuseum.org/plan-your-visit",
  },
  {
    names: /\bstatue of liberty\b|\bellis island\b|\bliberty island\b/i,
    city: NEW_YORK,
    rules: [{ thanksgiving: true }, yearly("12-25")],
    hours: [
      { from: "11-21", to: "11-29", open: "08:30", close: "17:00", lastEntry: "15:30" },
      { from: "11-30", to: "12-18", open: "09:00", close: "17:00", lastEntry: "15:30" },
      { from: "12-19", to: "01-04", open: "08:30", close: "17:00", lastEntry: "15:30" },
    ],
    source: "https://statuecitycruises.com/plan-your-visit/schedule",
  },
  {
    names: /\bamerican museum of natural history\b|\bamnh\b/i,
    city: NEW_YORK,
    rules: [{ thanksgiving: true }, day("2026-12-25")],
    source: "https://www.amnh.org/plan-your-visit",
  },
  // Mexico City
  {
    names: /\bmuseo nacional de antropolog[ií]a\b|\bnational museum of anthropology\b|\bmuseo (?:nazionale )?di antropologia\b|\bmuseu nacional de antropologia\b/i,
    city: MEXICO_CITY,
    rules: [{ weekly: ["Monday"] }],
    hours: [
      { from: "01-01", to: "12-31", open: "09:00", close: "18:00" },
    ],
    hoursSource: "https://www.inah.gob.mx/images/boletines/2026/187/Boletin_187.pdf",
    source: "https://www.mna.inah.gob.mx/",
  },
  // Kanazawa
  {
    names: /\bkenroku-?en\b|兼六園/i,
    city: KANAZAWA,
    rules: OPEN_EVERY_DAY,
    hours: [
      { from: "03-01", to: "10-15", open: "07:00", close: "18:00" },
      { from: "10-16", to: "02-29", open: "08:00", close: "17:00" },
    ],
    source: "https://shiro-niwa.pref.ishikawa.lg.jp/kenrokuen-garden/e/info.html",
  },
  // Kyoto
  {
    names: /\bkinkaku-?ji\b|\bgolden pavilion\b|\bpabell[oó]n dorado\b|\bpadiglione d.oro\b|\bpavilh[aã]o dourado\b|金閣寺/i,
    city: KYOTO,
    rules: OPEN_EVERY_DAY,
    hours: [{ from: "01-01", to: "12-31", open: "09:00", close: "17:00" }],
    source: "https://www.shokoku-ji.jp/en/kinkakuji/faq/",
  },
  {
    names: /\bginkaku-?ji\b|\bsilver pavilion\b|\bpabell[oó]n de plata\b|\bpadiglione d.argento\b|\bpavilh[aã]o de prata\b|銀閣寺/i,
    city: KYOTO,
    rules: OPEN_EVERY_DAY,
    hours: [
      { from: "03-01", to: "11-30", open: "08:30", close: "17:20", lastEntry: "17:00" },
      { from: "12-01", to: "02-29", open: "09:00", close: "16:50", lastEntry: "16:30" },
    ],
    source: "https://www.shokoku-ji.jp/en/ginkakuji/faq/",
  },
  {
    // Its spring and autumn night openings keep their hours: a stop named for the night isn't checked (visit-hours.ts).
    names: /\bkiyomizu-?dera\b|清水寺/i,
    city: KYOTO,
    rules: OPEN_EVERY_DAY,
    hours: [
      { from: "07-01", to: "08-31", open: "06:00", close: "18:30" },
      { from: "01-01", to: "12-31", open: "06:00", close: "18:00" },
    ],
    source: "https://www.kiyomizudera.or.jp/access.php",
  },
  {
    // The castle; its Ninomaru Palace also shuts some Tuesdays, which the list doesn't hold.
    names: /\bnij[oō]-?j[oō]\b|\bnij[oō] castle\b|\bcastillo (?:de )?nij[oō]\b|\bcastello (?:di )?nij[oō]\b|\bcastelo (?:de )?nij[oō]\b|二条城/i,
    city: KYOTO,
    rules: [yearly("12-29", "12-31")],
    hours: [{ from: "01-01", to: "12-31", open: "08:45", close: "17:00", lastEntry: "16:00" }],
    source: "https://nijo-jocastle.city.kyoto.lg.jp/guide/annai/",
  },
  {
    names: /\btenry[uū]-?ji\b|天龍寺/i,
    city: KYOTO,
    rules: OPEN_EVERY_DAY,
    hours: [{ from: "01-01", to: "12-31", open: "08:30", close: "17:00", lastEntry: "16:50" }],
    source: "https://www.tenryuji.com/en/visit/index.html",
  },
  // Nara
  {
    names: /\bt[oō]dai-?ji\b|東大寺/i,
    city: NARA_KYOTO_OSAKA,
    rules: OPEN_EVERY_DAY,
    hours: [
      { from: "04-01", to: "10-31", open: "07:30", close: "17:30" },
      { from: "11-01", to: "03-31", open: "08:00", close: "17:00" },
    ],
    source: "https://www.todaiji.or.jp/en/information/haikan/",
  },
  // Athens
  {
    // The site itself: the Acropolis Museum below it keeps other hours.
    names: /\bacropol(?:is|i|e)\b|\bacr[oó]pol(?:e|is)\b|\bparthenon\b|\bpartenone\b|\bparten[oó]n\b|ακρόπολη/i,
    notNames: /\bmuse(?:um|o|u)\b|μουσείο/i,
    city: ATHENS,
    rules: [yearly("01-01"), yearly("03-25"), yearly("05-01"), { easter: "orthodox" }, yearly("12-25", "12-26")],
    hours: [
      { from: "04-01", to: "08-31", open: "08:00", close: "20:00", lastEntry: "19:40" },
      { from: "09-01", to: "09-15", open: "08:00", close: "19:30", lastEntry: "19:10" },
      { from: "09-16", to: "09-30", open: "08:00", close: "19:00", lastEntry: "18:40" },
      { from: "10-01", to: "10-15", open: "08:00", close: "18:30", lastEntry: "18:10" },
      { from: "10-16", to: "10-31", open: "08:00", close: "18:00", lastEntry: "17:40" },
      { from: "11-01", to: "03-31", open: "08:00", close: "17:00", lastEntry: "16:40" },
    ],
    source: "https://www.hh.gr/en/?p=1582",
  },
  {
    names: /\bancient agora\b|\bagora of athens\b|\bathenian agora\b|\b[aá]gora (?:antigua|antica|antiga)\b|αρχαία αγορά/i,
    notNames: /\broman agora\b|\b[aá]gora romana\b/i,
    city: ATHENS,
    rules: [yearly("01-01"), yearly("03-25"), yearly("05-01"), { easter: "orthodox" }, yearly("12-25", "12-26")],
    source: "https://www.hh.gr/en/destinations/ancient-agora-athens/",
  },
  // Granada
  {
    // A viewpoint across the valley isn't a visit.
    names: /\balhambra\b|\bgeneralife\b/i,
    notNames: /\bmirador\b|\bviews?\b|\bvista\b|\bviewpoint\b/i,
    city: GRANADA,
    rules: [yearly("12-25"), yearly("01-01")],
    hours: [
      { from: "04-01", to: "10-14", open: "08:30", close: "20:00" },
      { from: "10-15", to: "03-31", open: "08:30", close: "18:00" },
    ],
    source: "https://www.alhambra-patronato.es/en/visit/opening-hours-and-prices",
  },
  // London
  {
    // Sundays are for worship only. Its page doesn't say whether 15:30 is the last entry or the closing: no hours.
    names: /\bwestminster abbey\b|\babad[ií]a de westminster\b|\babbazia di westminster\b/i,
    city: LONDON,
    rules: [{ weekly: ["Sunday"] }, yearly("12-25")],
    source: "https://www.westminster-abbey.org/faq",
  },
  // Edinburgh
  {
    names: /\bedinburgh castle\b|\bcastillo de edimburgo\b|\bcastello di edimburgo\b|\bcastelo de edimburgo\b/i,
    city: EDINBURGH,
    rules: [yearly("12-25", "12-26")],
    hours: [
      { from: "12-24", to: "12-24", open: "09:30", close: "16:00", lastEntry: "15:00" },
      { from: "01-01", to: "01-01", open: "11:00", close: "17:00", lastEntry: "16:00" },
      { from: "04-01", to: "09-30", open: "09:30", close: "18:00", lastEntry: "17:00" },
      { from: "10-01", to: "03-31", open: "09:30", close: "17:00", lastEntry: "16:00" },
    ],
    source: "https://www.edinburghcastle.scot/plan-your-visit/opening-times/",
  },
  // Bavaria
  {
    names: /\bneuschwanstein\b/i,
    city: BAVARIA,
    rules: [yearly("12-24", "12-25"), yearly("12-31", "01-01")],
    hours: [
      { from: "03-28", to: "10-15", open: "09:00", close: "18:00" },
      { from: "10-16", to: "03-27", open: "10:00", close: "16:00" },
    ],
    source: "https://www.neuschwanstein.de/englisch/tourist/opening.htm",
  },
  // London
  {
    names: /\btate modern\b/i,
    city: LONDON,
    rules: [yearly("12-24", "12-26")],
    hours: [
      { from: "01-01", to: "12-31", days: ["Friday", "Saturday"], open: "10:00", close: "21:00", lastEntry: "20:30" },
      { from: "01-01", to: "12-31", open: "10:00", close: "18:00", lastEntry: "17:30" },
    ],
    source: "https://www.tate.org.uk/visit/tate-modern",
  },
  // Paris
  {
    names: /\bmus[eé]e rodin\b|\brodin museum\b|\bmuseo rodin\b|\bmuseu rodin\b/i,
    city: PARIS,
    rules: [{ weekly: ["Monday"] }, yearly("01-01"), yearly("05-01"), yearly("12-25")],
    hours: [
      { from: "12-24", to: "12-24", open: "10:00", close: "17:30", lastEntry: "16:45" },
      { from: "12-31", to: "12-31", open: "10:00", close: "17:30", lastEntry: "16:45" },
      { from: "01-01", to: "12-31", open: "10:00", close: "18:30", lastEntry: "17:45" },
    ],
    source: "https://www.musee-rodin.fr/en/plan-your-visit/plan-your-visit-musee-rodin",
  },
  // Vienna
  {
    // The Upper Belvedere; the Lower Belvedere keeps other hours.
    names: /\bupper belvedere\b|\bbelvedere (?:palace|museum)\b|\bschloss belvedere\b|\boberes belvedere\b|\bpalacio (?:del )?belvedere\b|\bpalazzo belvedere\b|\bpal[aá]cio belvedere\b/i,
    notNames: /\blower belvedere\b|\bunteres belvedere\b/i,
    city: VIENNA,
    rules: OPEN_EVERY_DAY,
    hours: [{ from: "01-01", to: "12-31", open: "09:00", close: "18:00" }],
    source: "https://www.belvedere.at/en/visit/upper-belvedere",
  },
  // New York
  {
    names: /\bwhitney museum\b|\bthe whitney\b/i,
    city: NEW_YORK,
    rules: [{ weekly: ["Tuesday"] }, { thanksgiving: true }, yearly("12-25")],
    // Open on the two Tuesdays before New Year.
    openOn: ["2026-12-22", "2026-12-29"],
    hours: [
      { from: "12-24", to: "12-24", open: "10:30", close: "17:00" },
      { from: "12-31", to: "12-31", open: "10:30", close: "17:00" },
      { from: "01-01", to: "12-31", days: ["Friday"], open: "10:30", close: "22:00" },
      { from: "01-01", to: "12-31", open: "10:30", close: "18:00" },
    ],
    source: "https://whitney.org/visit",
  },
  // Hanoi
  {
    names: /\btemple of literature\b|\bv[aă]n mi[eế]u\b|\bquoc tu giam\b|\btempio della letteratura\b|\btemplo de la literatura\b|\btemplo da literatura\b/i,
    city: HANOI,
    rules: OPEN_EVERY_DAY,
    hours: [{ from: "01-01", to: "12-31", open: "08:00", close: "17:00" }],
    source: "https://vanmieu.gov.vn/en/introduction/visitor-information",
  },
  {
    names: /\bmuseum of ethnology\b|\bmuseo (?:vietnamita )?de etnolog[ií]a\b|\bmuseo (?:vietnamita )?di etnologia\b|\bmuseu (?:vietnamita )?de etnologia\b/i,
    city: HANOI,
    rules: [{ weekly: ["Monday"] }],
    hours: [{ from: "01-01", to: "12-31", open: "08:30", close: "17:30" }],
    source: "https://vme-en.vass.gov.vn/",
  },
  // Bali
  {
    names: /\btirta empul\b/i,
    city: BALI,
    rules: OPEN_EVERY_DAY,
    hours: [{ from: "01-01", to: "12-31", open: "08:00", close: "18:00" }],
    source: "https://www.indonesia.travel/id-id/travel-ideas/pilgrimage/pura-tirta-empul/",
  },
  {
    names: /\bmonkey forest\b|\bmandala suci wenara wana\b|\bforesta (?:sacra )?delle scimmie\b|\bbosque (?:sagrado )?de (?:los )?monos\b|\bfloresta (?:sagrada )?dos macacos\b/i,
    city: BALI,
    rules: OPEN_EVERY_DAY,
    hours: [{ from: "01-01", to: "12-31", open: "09:00", close: "18:00", lastEntry: "17:00" }],
    source: "https://monkeyforestubud.com/visit/",
  },
  // Goa
  {
    names: /\bbom jesus\b/i,
    city: GOA,
    rules: OPEN_EVERY_DAY,
    hours: [
      { from: "01-01", to: "12-31", days: ["Sunday"], open: "10:30", close: "18:30" },
      { from: "01-01", to: "12-31", open: "09:00", close: "18:30" },
    ],
    source: "https://www.goa.gov.in/places/basilica-church-for-churches/",
  },
  // Munnar
  {
    // Shut while the Nilgiri tahr calve. Its page gives the entry window (8:00 to 14:00) but no closing time: no hours.
    names: /\beravikulam\b|\brajamala\b/i,
    city: MUNNAR,
    rules: [yearly("02-01", "03-31")],
    source: "https://eravikulamnationalpark.in/",
  },
  // Osaka
  {
    // The main tower; the park around it stays open. The castle's own pages state no hours: the city's tourism bureau.
    names: /\bosaka castle\b|\bosaka-?jo\b|\bcastillo de osaka\b|\bcastello di osaka\b|\bcastelo de osaka\b|大阪城/i,
    notNames: /\bpark\b|\bparque\b|\bparco\b|公園/i,
    city: OSAKA,
    rules: [yearly("12-28", "01-01")],
    hours: [{ from: "01-01", to: "12-31", open: "09:00", close: "18:00", lastEntry: "17:30" }],
    source: "https://osaka-info.jp/en/spot/osaka-castle-main-keep/",
  },
  // Tokyo
  {
    names: /\btokyo skytree\b|\bskytree\b|東京スカイツリー/i,
    notNames: /\bskytree town\b|\bsolamachi\b/i,
    city: TOKYO,
    rules: OPEN_EVERY_DAY,
    hours: [
      { from: "01-01", to: "12-31", days: ["Saturday", "Sunday"], open: "09:00", close: "22:00", lastEntry: "21:00" },
      { from: "01-01", to: "12-31", open: "10:00", close: "22:00", lastEntry: "21:00" },
    ],
    source: "https://en.tokyo-skytree.jp/open-hours/day_hours/",
  },
  // Agra
  {
    // Open from half an hour before sunrise to half an hour before sunset: no clock hours to hold a visit to.
    names: /\btaj mahal\b|ताज महल/i,
    notNames: /\bhotel\b|\bpalace\b|\bmehtab\b|\bview(?:point)?\b/i,
    city: AGRA,
    rules: [{ weekly: ["Friday"] }],
    source: "https://tajmahal.gov.in/visiting-hours.aspx",
  },
  // Delhi
  {
    // Open on Mondays since February 2026; shut for the Independence Day preparations, about 15 July to 15 August.
    names: /\bred fort\b|\blal qil[ae]\b|\bfuerte rojo\b|\bforte rosso\b|\bforte vermelho\b|लाल किला/i,
    notNames: /\bagra\b/i,
    city: DELHI,
    rules: [yearly("07-15", "08-15")],
    source: "https://asi.paygov.org.in/asi-webapp/#/ticketbooking",
  },
  {
    names: /\bnational museum\b|\bmuseo nacional\b|\bmuseo nazionale\b|\bmuseu nacional\b/i,
    city: DELHI,
    rules: [{ weekly: ["Monday"] }, ...INDIA_NATIONAL_HOLIDAYS],
    hours: [
      { from: "01-01", to: "12-31", days: ["Saturday", "Sunday"], open: "10:00", close: "20:00" },
      { from: "01-01", to: "12-31", open: "10:00", close: "18:00" },
    ],
    source: "https://nationalmuseumindia.gov.in/en/visiting",
  },
  {
    names: /\bakshardham\b|अक्षरधाम/i,
    city: DELHI,
    rules: [{ weekly: ["Monday"] }],
    hours: [{ from: "01-01", to: "12-31", open: "10:00", close: "20:00", lastEntry: "18:30" }],
    source: "https://akshardham.com/visitor-info/",
  },
  {
    names: /\blotus temple\b|\bbah[aá]'?[ií] house of worship\b|\btempio del loto\b|\btemplo (?:del|do) l[oó]to\b|\btemplo (?:del|do) l[oó]tus\b/i,
    city: DELHI,
    rules: [{ weekly: ["Monday"] }],
    hours: [{ from: "01-01", to: "12-31", open: "08:30", close: "18:00" }],
    source: "https://bahaihouseofworship.in/plan-a-visit/",
  },
  // Jodhpur
  {
    names: /\bmehrangarh\b/i,
    city: JODHPUR,
    rules: OPEN_EVERY_DAY,
    hours: [{ from: "01-01", to: "12-31", open: "09:00", close: "17:00" }],
    source: "https://www.mehrangarh.org/visit/mehrangarh-museum/",
  },
  // Hyderabad
  {
    names: /\bsalar ?jung\b/i,
    city: HYDERABAD,
    rules: [{ weekly: ["Friday"] }],
    hours: [{ from: "01-01", to: "12-31", open: "10:00", close: "18:00", lastEntry: "17:15" }],
    source: "https://salarjungmuseum.in/plan-your-visit/",
  },
  {
    names: /\bchow ?mahall?a\b/i,
    city: HYDERABAD,
    rules: [{ weekly: ["Friday"] }],
    hours: [{ from: "01-01", to: "12-31", open: "10:00", close: "17:00" }],
    source: "https://www.chowmahalla.in/visit/",
  },
  // Ajanta and Ellora
  {
    // The two official pages give different hours (sunrise to sunset, or 9:00 to 17:00): the closing day only.
    names: /\bajanta\b/i,
    city: AJANTA_ELLORA,
    rules: [{ weekly: ["Monday"] }],
    source: "https://asi.paygov.org.in/asi-webapp/#/ticketbooking",
  },
  {
    names: /\bellora\b|\bkailasa temple\b/i,
    city: AJANTA_ELLORA,
    rules: [{ weekly: ["Tuesday"] }],
    source: "https://asi.paygov.org.in/asi-webapp/#/ticketbooking",
  },
  // Mumbai
  {
    names: /\belephanta\b/i,
    city: MUMBAI,
    rules: [{ weekly: ["Monday"] }],
    hours: [{ from: "01-01", to: "12-31", open: "09:00", close: "17:30" }],
    source: "https://asi.nic.in/pages/m_category/isTicketed/monument/HQ",
  },
  {
    names: /\bchhatrapati shivaji maharaj vastu sangrahalaya\b|\bcsmvs\b|\bprince of wales museum\b/i,
    city: MUMBAI,
    rules: [yearly("05-01"), ...INDIA_NATIONAL_HOLIDAYS],
    hours: [{ from: "01-01", to: "12-31", open: "10:15", close: "18:00", lastEntry: "17:45" }],
    source: "https://www.csmvs.in/visit-us.html",
  },
  // Mysuru
  {
    // The palace's evening illumination is named as such and isn't held to these hours (lib/ai/visit-hours.ts).
    names: /\bmys(?:ore|uru) palace\b|\bamba vilas\b|\bpalazzo di mysore\b|\bpalacio de mysore\b|\bpal[aá]cio de mysore\b/i,
    city: MYSURU,
    rules: OPEN_EVERY_DAY,
    hours: [{ from: "01-01", to: "12-31", open: "10:00", close: "17:30", lastEntry: "17:00" }],
    source: "https://karnatakatourism.org/en/attractions/mysuru-palace/",
  },
  // Kochi
  {
    names: /\bmattancherry palace\b|\bdutch palace\b|\bpalazzo olandese\b|\bpalacio holand[eé]s\b|\bpal[aá]cio holand[eê]s\b/i,
    city: KOCHI,
    rules: [{ weekly: ["Friday"] }],
    hours: [{ from: "01-01", to: "12-31", open: "10:00", close: "17:00" }],
    source: "https://www.keralatourism.org/destination/mattancherry-palace-kochi/178/",
  },
  // Chennai
  {
    // Also shut for Deepavali and Pongal, whose dates move: not held here.
    names: /\bgovernment museum\b|\begmore museum\b|\bmadras museum\b/i,
    city: CHENNAI,
    rules: [{ weekly: ["Friday"] }, ...INDIA_NATIONAL_HOLIDAYS],
    hours: [{ from: "01-01", to: "12-31", open: "10:30", close: "18:30" }],
    source: "https://govtmuseumchennai.org/",
  },
];

const isDate = (s: string | undefined): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const at = (date: string) => new Date(`${date}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const weekdayOf = (date: string): Weekday => WEEKDAYS[at(date).getUTCDay()];
const plusDays = (date: string, n: number) => iso(new Date(at(date).getTime() + n * 86400e3));

/** Whether a weekly rule shuts the place on a date, with Japan's holiday shift. */
function weeklyShut(rule: { weekly: Weekday[]; holidayShift?: "jp" }, date: string): boolean {
  const shutDay = (d: string) => rule.weekly.includes(weekdayOf(d));
  if (!rule.holidayShift) return shutDay(date);
  if (JAPAN_HOLIDAYS.has(date)) return false;
  if (shutDay(date)) return true;
  // The day after a run of holidays that fell on shut days: the closure moves to the first ordinary day.
  let back = plusDays(date, -1);
  let moved = false;
  while (JAPAN_HOLIDAYS.has(back)) {
    if (shutDay(back)) moved = true;
    back = plusDays(back, -1);
  }
  return moved;
}

/** Whether a date falls in a span of every year; a span whose end comes before its start runs into the new year. */
function inYearly(date: string, { from, to }: YearlySpan): boolean {
  const monthDay = date.slice(5);
  return from <= to ? monthDay >= from && monthDay <= to : monthDay >= from || monthDay <= to;
}

/** Whether a place's rules shut it on a date (YYYY-MM-DD). */
export function shutBy(entry: KnownClosing, date: string): boolean {
  if (!isDate(date) || entry.openOn?.includes(date)) return false;
  if (entry.openEveryYear?.some((season) => inYearly(date, season))) return false;
  const d = at(date);
  return entry.rules.some((rule) => {
    if ("weekly" in rule) return weeklyShut(rule, date);
    if ("nth" in rule) return weekdayOf(date) === rule.nth && rule.of.includes(Math.ceil(d.getUTCDate() / 7));
    if ("yearly" in rule) return inYearly(date, rule.yearly);
    if ("from" in rule) return date >= rule.from && date <= rule.to;
    if ("thanksgiving" in rule) return d.getUTCMonth() === 10 && weekdayOf(date) === "Thursday" && Math.ceil(d.getUTCDate() / 7) === 4;
    if ("easter" in rule) return date === easterSunday(d.getUTCFullYear(), rule.easter);
    if ("sundaysButLast" in rule) return weekdayOf(date) === "Sunday" && d.getUTCMonth() === at(plusDays(date, 7)).getUTCMonth();
    return false;
  });
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** The hours a listed place keeps on a date (YYYY-MM-DD). None when its hours aren't listed or it is shut that day. */
export function hoursOn(entry: KnownClosing, date: string): OpenHours | null {
  if (!isDate(date) || !entry.hours || shutBy(entry, date)) return null;
  const weekday = weekdayOf(date);
  const row = entry.hours.find((r) => inYearly(date, r) && (!r.days || r.days.includes(weekday)));
  if (!row) return null;
  return {
    open: minutesOf(row.open),
    close: minutesOf(row.close),
    ...(row.lastEntry ? { lastEntry: minutesOf(row.lastEntry) } : {}),
  };
}

/** The listed place a stop is, for a trip to this destination. */
export function knownClosingFor(name: string | undefined, destination: string): KnownClosing | undefined {
  if (!name) return undefined;
  return KNOWN_CLOSINGS.find((c) => c.city.test(destination) && c.names.test(name) && !c.notNames?.test(name));
}

type Stop = { name?: string; type?: string };
type Day = { date?: string; activities?: Stop[] };

/**
 * The model's answer with the listed places decided by the list. Keys are the stops' names as the question keys
 * them (trimmed, lower-cased). On a trip whose dates all fall in the checked window, a listed stop's weekly days are
 * dropped and its shut dates become the trip's dates the list shuts it on. On a trip reaching past the window, the
 * list's shut dates are added to the model's answer, which is kept for the dates the list hasn't checked. `known`
 * counts the stops the list covered. A meal is never a listed place, whatever it is called: "Armando al Pantheon"
 * is a restaurant, not the Pantheon.
 */
export function withKnownClosings(
  answer: { closings: Map<string, Weekday[]>; shutDates: Map<string, string[]> },
  days: Day[],
  destination: string
): { closings: Map<string, Weekday[]>; shutDates: Map<string, string[]>; known: number } {
  const closings = new Map(answer.closings);
  const shutDates = new Map(answer.shutDates);
  const dates = days.map((d) => d.date).filter(isDate);
  const checked = dates.length > 0 && dates.every((date) => date >= CHECKED_FROM && date <= CHECKED_UNTIL);
  const covered = new Set<string>();
  for (const stop of days.flatMap((d) => d.activities ?? [])) {
    if (isMealStop(stop)) continue;
    const entry = knownClosingFor(stop.name, destination);
    if (!entry || !stop.name) continue;
    const key = stop.name.trim().toLowerCase();
    if (covered.has(key)) continue;
    covered.add(key);
    const listed = dates.filter((date) => shutBy(entry, date));
    const shut = checked ? listed : [...new Set([...(answer.shutDates.get(key) ?? []), ...listed])].sort();
    if (checked) closings.delete(key);
    if (shut.length > 0) shutDates.set(key, shut);
    else shutDates.delete(key);
  }
  return { closings, shutDates, known: covered.size };
}
