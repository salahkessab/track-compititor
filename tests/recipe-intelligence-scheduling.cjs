const test = require('node:test');
const assert = require('node:assert/strict');
const { scheduleFromLocal, validateSchedule } = require('../.intelligence-build/lib/recipe-intelligence/scheduling.js');

test('publication time uses the selected timezone, including Morocco seasonal offsets', () => {
  assert.equal(scheduleFromLocal('2024-11-20T09:30', 'Africa/Casablanca'), '2024-11-20T08:30:00.000Z');
  assert.equal(scheduleFromLocal('2026-03-01T09:30', 'Africa/Casablanca'), '2026-03-01T09:30:00.000Z');
  assert.equal(scheduleFromLocal('2026-11-20T09:30', 'Asia/Kolkata'), '2026-11-20T04:00:00.000Z');
});

test('invalid, skipped and repeated wall times cannot silently choose the wrong publication instant', () => {
  for (const value of ['', '2026-02-30T09:30', '2026-11-20T25:00']) assert.throws(() => scheduleFromLocal(value, 'Africa/Casablanca'));
  assert.throws(() => scheduleFromLocal('2026-03-08T02:30', 'America/New_York'), /skipped or occurs twice/);
  assert.throws(() => scheduleFromLocal('2026-11-01T01:30', 'America/New_York'), /skipped or occurs twice/);
});

test('the server rejects non-UTC, invalid and expired schedules before publication', () => {
  const now = Date.parse('2026-11-20T08:00:00Z');
  assert.equal(validateSchedule('2026-11-20T08:01:00Z', now), '2026-11-20T08:01:00.000Z');
  for (const value of ['2026-11-20T08:00:59Z', '2026-11-19T08:00:00Z', '2026-11-20T10:00:00+01:00', '2026-02-30T10:00:00Z', 'tomorrow']) assert.throws(() => validateSchedule(value, now));
});
