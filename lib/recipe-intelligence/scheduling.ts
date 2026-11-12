// Shared by the editor and API; never interpret a wall-clock time in the browser's implicit timezone.
function wallTime(date: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (name: string) => parts.find(p => p.type === name)!.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}
export function scheduleFromLocal(value: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Choose a publication date and time.');
  const wall = `${value}:00`, naive = Date.parse(wall + 'Z');
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 19) !== wall) throw new Error('Choose a valid publication date and time.');
  const offsets = new Set<number>();
  for (const hours of [-48, -24, 0, 24, 48]) {
    const sample = naive + hours * 3600000;
    offsets.add(Date.parse(wallTime(sample, timeZone) + 'Z') - sample);
  }
  const matches = [...offsets].map(offset => naive - offset).filter(date => wallTime(date, timeZone) === wall);
  if (matches.length !== 1) throw new Error('This time is skipped or occurs twice during a timezone change. Choose another time.');
  return new Date(matches[0]).toISOString();
}
export function validateSchedule(value: unknown, now = Date.now()): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw new Error('Provide the scheduled publication time in UTC.');
  const date = Date.parse(value);
  if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 19) !== value.slice(0, 19)) throw new Error('Invalid scheduled publication time.');
  if (date < now + 60000) throw new Error('Choose a publication time at least one minute in the future.');
  return new Date(date).toISOString();
}
