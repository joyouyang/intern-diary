import { addDays, isWeekend, todayStr } from './util.js';

export const MILESTONES = [3, 7, 14, 21, 30, 60, 100];

// written: Set of dates that have diary text.
// A day that has not ended yet (asOf, when not written) never breaks the streak.
// With skipWeekends, an empty Saturday or Sunday is skipped instead of breaking it,
// while a weekend entry still counts.
export function computeStreak(written, { skipWeekends }, asOf = todayStr()) {
  const today = todayStr();
  if (!written.size) return { current: 0, longest: 0, total: 0, writtenToday: false };
  const earliest = [...written].sort()[0];
  const required = d => !(skipWeekends && isWeekend(d));

  let current = 0;
  let d = written.has(asOf) ? asOf : addDays(asOf, -1);
  while (d >= earliest) {
    if (written.has(d)) current++;
    else if (required(d)) break;
    d = addDays(d, -1);
  }

  let longest = 0;
  let run = 0;
  for (let day = earliest; day <= today; day = addDays(day, 1)) {
    if (written.has(day)) longest = Math.max(longest, ++run);
    else if (required(day) && day !== today) run = 0;
  }

  return { current, longest, total: written.size, writtenToday: written.has(today) };
}
