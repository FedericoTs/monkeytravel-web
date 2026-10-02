/**
 * Keeps a Today panel from showing older data than it already has. A read
 * that overlapped one of this screen's own changes may have read the database
 * before that change committed, so it is dropped: the change's own answer is
 * newer, and the change's announcement brings a fresh read. Of two reads, the
 * one started last wins.
 */
export function freshness() {
  let writesInFlight = 0;
  let writeEpoch = 0;
  let readsStarted = 0;
  let lastApplied = 0;

  return {
    /** Call when a read starts; call what it returns when the read answers: true if the answer may be shown. */
    startRead(): () => boolean {
      const read = ++readsStarted;
      const epoch = writeEpoch;
      const busy = writesInFlight > 0;
      return () => {
        if (busy || epoch !== writeEpoch || read < lastApplied) return false;
        lastApplied = read;
        return true;
      };
    },
    /** Runs one of this screen's own changes. */
    async write<T>(run: () => Promise<T>): Promise<T> {
      writesInFlight++;
      writeEpoch++;
      try {
        return await run();
      } finally {
        writesInFlight--;
      }
    },
  };
}

const READ_TIMEOUT_MS = 8_000;

/** Gives up on a read that hangs, so one stuck request can't hold back the next refresh. */
export function readSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(READ_TIMEOUT_MS) : undefined;
}
