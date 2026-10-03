import dataset from "./dataset.json";

/**
 * Date of the visa data in matrix.json: when the snapshot we hold was
 * published upstream. scripts/refresh-visa-data.mjs rewrites dataset.json
 * whenever the snapshot changes. Pages show this date, never the render
 * date: a nightly check that finds nothing new does not make the data newer.
 */
export const VISA_DATA_AS_OF: string = dataset.asOf;

/** VISA_DATA_AS_OF as a long date in the reader's locale, e.g. "18 February 2026". */
export function visaDataAsOfLabel(locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${VISA_DATA_AS_OF}T00:00:00Z`));
}
