import { readFileSync } from "fs";
import { join } from "path";

/** The notification cron's code, for the checks that read it: the route and the sends it hands rows to. */
export function cronSource(): string {
  return [
    "app/api/cron/scheduled-notifications/route.ts",
    "lib/notifications/slot-row.ts",
    "lib/notifications/slot-email.ts",
    "lib/notifications/day-digest-email.ts",
  ]
    .map((file) => readFileSync(join(process.cwd(), file), "utf8"))
    .join("\n");
}
