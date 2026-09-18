// Use the browser's clock and timezone, never the model's training date.
export function currentTimeContext(now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'long',
  }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return { utc: now.toISOString(), timeZone, localDate: `${value('year')}-${value('month')}-${value('day')}`,
    localTime: `${value('hour')}:${value('minute')}:${value('second')}`, weekday: value('weekday') };
}

export const TIME_RULES = 'Use supplied host time for today, tomorrow, and relative dates, not dates inferred from page content. Respect an explicitly requested timezone or date. Resolve relative dates into explicit dates in subgoals; preserve those dates during recovery. Ask when the intended date or range is ambiguous.';
