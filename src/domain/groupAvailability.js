export const SLOT_MINUTES = 30;
export const SLOT_MS = SLOT_MINUTES * 60 * 1000;
export const GRID_START_HOUR = 8;
export const GRID_END_HOUR = 23;
export const WINDOW_DURATIONS = Object.freeze([30, 60, 90, 120]);
export const DEFAULT_GROUP_TIMEZONE = 'America/Sao_Paulo';
export const AVAILABILITY_HORIZON_DAYS = 90;
export const AVAILABILITY_UI_DAYS = 14;
export const COMMON_GROUP_TIMEZONES = Object.freeze([
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Fortaleza',
  'America/Belem',
  'America/Recife',
  'America/Cuiaba',
  'America/Rio_Branco',
  'America/Noronha',
  'Asia/Kathmandu',
  'UTC',
]);

function asDate(value) {
  if (value instanceof Date) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function isAlignedSlotStart(value, timeZone = DEFAULT_GROUP_TIMEZONE) {
  const date = asDate(value);
  if (!date) return false;
  if (date.getUTCMilliseconds() !== 0 || date.getUTCSeconds() !== 0) return false;
  const parts = zonedParts(date, timeZone);
  if (!parts) return false;
  return parts.minute === 0 || parts.minute === 30;
}

export function normalizeAvailabilitySlots(values, timeZone = DEFAULT_GROUP_TIMEZONE) {
  const unique = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const date = asDate(value);
    if (!date || !isAlignedSlotStart(date, timeZone)) continue;
    unique.add(date.toISOString());
  }
  return [...unique].sort();
}

export function zonedParts(value, timeZone) {
  const date = asDate(value);
  if (!date) return null;
  const tz = timeZone || DEFAULT_GROUP_TIMEZONE;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday,
  };
}

function timeZoneOffsetMs(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  if (!parts) return 0;
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return asUtc - date.getTime();
}

export function zonedLocalToUtc(timeZone, year, month, day, hour = 0, minute = 0) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return new Date(guess.getTime() - timeZoneOffsetMs(guess, timeZone));
}

export function addZonedDays(timeZone, year, month, day, delta) {
  const utc = zonedLocalToUtc(timeZone, year, month, day, 12, 0);
  utc.setUTCDate(utc.getUTCDate() + delta);
  const parts = zonedParts(utc, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function weekdayIndex(weekday) {
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekday] ?? 0;
}

export function startOfZonedWeek(value, timeZone) {
  const parts = zonedParts(value, timeZone);
  if (!parts) return null;
  const delta = (weekdayIndex(parts.weekday) + 6) % 7;
  return addZonedDays(timeZone, parts.year, parts.month, parts.day, -delta);
}

export function listZonedDays(timeZone, startParts, count) {
  const days = [];
  let cursor = startParts;
  for (let index = 0; index < count; index += 1) {
    const noon = zonedLocalToUtc(timeZone, cursor.year, cursor.month, cursor.day, 12, 0);
    days.push({
      ...cursor,
      weekday: zonedParts(noon, timeZone).weekday,
      dateKey: `${cursor.year}-${String(cursor.month).padStart(2, '0')}-${String(cursor.day).padStart(2, '0')}`,
    });
    cursor = addZonedDays(timeZone, cursor.year, cursor.month, cursor.day, 1);
  }
  return days;
}

export function gridSlotStartsForDay(timeZone, year, month, day) {
  const starts = [];
  for (let hour = GRID_START_HOUR; hour <= GRID_END_HOUR; hour += 1) {
    for (const minute of [0, 30]) {
      if (hour === GRID_END_HOUR && minute > 0) continue;
      starts.push(zonedLocalToUtc(timeZone, year, month, day, hour, minute).toISOString());
    }
  }
  return starts;
}

export function buildAvailabilityGrid({
  timeZone = DEFAULT_GROUP_TIMEZONE,
  start,
  dayCount = AVAILABILITY_UI_DAYS,
  slots = [],
  members = [],
} = {}) {
  const weekStart = startOfZonedWeek(start ?? new Date(), timeZone);
  const days = listZonedDays(timeZone, weekStart, dayCount);
  const memberIds = (Array.isArray(members) ? members : []).map((member) => member.userId ?? member.user_id);
  const bySlot = new Map();
  for (const slot of Array.isArray(slots) ? slots : []) {
    const iso = asDate(slot.slotStart ?? slot.slot_start)?.toISOString();
    const userId = slot.userId ?? slot.user_id;
    if (!iso || !userId) continue;
    const list = bySlot.get(iso) ?? [];
    list.push(userId);
    bySlot.set(iso, list);
  }

  const hours = [];
  for (let hour = GRID_START_HOUR; hour <= GRID_END_HOUR; hour += 1) {
    for (const minute of [0, 30]) {
      if (hour === GRID_END_HOUR && minute > 0) continue;
      hours.push({ hour, minute, label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` });
    }
  }

  const cells = days.map((day) => {
    const starts = gridSlotStartsForDay(timeZone, day.year, day.month, day.day);
    return {
      ...day,
      slots: starts.map((iso, index) => {
        const userIds = [...new Set(bySlot.get(iso) ?? [])];
        return {
          iso,
          hour: hours[index].hour,
          minute: hours[index].minute,
          label: hours[index].label,
          userIds,
          count: userIds.length,
          memberCount: memberIds.length,
        };
      }),
    };
  });

  return { timeZone, days: cells, hours, memberIds };
}

export function slotSetByUser(slots) {
  const map = new Map();
  for (const slot of Array.isArray(slots) ? slots : []) {
    const userId = slot.userId ?? slot.user_id;
    const iso = asDate(slot.slotStart ?? slot.slot_start)?.toISOString();
    if (!userId || !iso) continue;
    const set = map.get(userId) ?? new Set();
    set.add(iso);
    map.set(userId, set);
  }
  return map;
}

export function windowSlotStarts(start, durationMinutes) {
  const date = asDate(start);
  const duration = Number(durationMinutes);
  if (!date || !WINDOW_DURATIONS.includes(duration)) return [];
  const count = duration / SLOT_MINUTES;
  return Array.from({ length: count }, (_, index) => new Date(date.getTime() + index * SLOT_MS).toISOString());
}

export function getAvailableUsersForWindow({ members = [], slots = [], start, durationMinutes }) {
  const needed = windowSlotStarts(start, durationMinutes);
  if (needed.length === 0) return [];
  const byUser = slotSetByUser(slots);
  return (Array.isArray(members) ? members : []).filter((member) => {
    const userId = member.userId ?? member.user_id;
    const owned = byUser.get(userId);
    return Boolean(owned && needed.every((iso) => owned.has(iso)));
  });
}

function compareWindows(left, right) {
  if (right.count !== left.count) return right.count - left.count;
  if (right.percent !== left.percent) return right.percent - left.percent;
  return String(left.start).localeCompare(String(right.start));
}

export function rankAvailabilityWindows({
  members = [],
  slots = [],
  durationMinutes = 120,
  from,
  to,
  limit = 8,
  timeZone = DEFAULT_GROUP_TIMEZONE,
} = {}) {
  const list = Array.isArray(members) ? members : [];
  const duration = Number(durationMinutes);
  if (!WINDOW_DURATIONS.includes(duration) || list.length === 0) return [];
  const neededCount = duration / SLOT_MINUTES;
  const aligned = normalizeAvailabilitySlots(
    (Array.isArray(slots) ? slots : []).map((slot) => slot.slotStart ?? slot.slot_start ?? slot),
    timeZone
  );
  const min = asDate(from)?.getTime() ?? 0;
  const max = asDate(to)?.getTime() ?? Number.POSITIVE_INFINITY;
  const candidates = aligned.filter((iso) => {
    const time = new Date(iso).getTime();
    return time >= min && time + neededCount * SLOT_MS <= max + SLOT_MS;
  });
  const uniqueStarts = [...new Set(candidates)];
  const ranked = uniqueStarts
    .map((start) => {
      const available = getAvailableUsersForWindow({ members: list, slots, start, durationMinutes: duration });
      const end = new Date(new Date(start).getTime() + duration * 60 * 1000).toISOString();
      return {
        start,
        end,
        durationMinutes: duration,
        count: available.length,
        percent: list.length === 0 ? 0 : available.length / list.length,
        userIds: available.map((member) => member.userId ?? member.user_id),
      };
    })
    .filter((row) => row.count > 0)
    .sort(compareWindows);
  return ranked.slice(0, limit);
}

export function formatZonedRange(start, end, timeZone, { weekday = 'short' } = {}) {
  const tz = timeZone || DEFAULT_GROUP_TIMEZONE;
  const from = asDate(start);
  const to = asDate(end);
  if (!from || !to) return '';
  const day = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    weekday,
    day: '2-digit',
    month: 'short',
  }).format(from);
  const startTime = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(from);
  const endTime = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(to);
  return `${day}, ${startTime}–${endTime}`;
}

export function userHasFullWindow(slots, userId, start, durationMinutes) {
  return getAvailableUsersForWindow({
    members: [{ userId }],
    slots,
    start,
    durationMinutes,
  }).length === 1;
}
