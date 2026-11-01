import type { Locator } from "@playwright/test";

/**
 * Whether the element shows up within `timeout` ms. Locator.isVisible() takes
 * a timeout but ignores it and answers at once, so an element still on its way
 * (a consent banner, a panel that opens after load) reads as absent.
 */
export async function visibleWithin(locator: Locator, timeout: number): Promise<boolean> {
  return locator
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
}
