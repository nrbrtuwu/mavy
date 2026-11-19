// Where a train is now, from the live source's passed stops (train screen).

import type { Stop } from "./types"

/**
 * Index of the last passed stop when the train is between two stops (it has passed one and
 * not yet the last), else null: no live data, not started yet, or already at the end.
 */
export function currentLeg(stops: Pick<Stop, "passed">[]): number | null {
  let last = -1
  stops.forEach((s, i) => {
    if (s.passed === true) last = i
  })
  return last >= 0 && last < stops.length - 1 ? last : null
}
