import { describe, expect, it } from 'vitest';
import {
  buildAvailabilityGrid,
  getAvailableUsersForWindow,
  isAlignedSlotStart,
  normalizeAvailabilitySlots,
  rankAvailabilityWindows,
  windowSlotStarts,
  zonedLocalToUtc,
} from './groupAvailability.js';

const tz = 'America/Sao_Paulo';
const saturday = zonedLocalToUtc(tz, 2026, 9, 26, 18, 0);

function iso(hours, minutes = 0) {
  return zonedLocalToUtc(tz, 2026, 9, 26, hours, minutes).toISOString();
}

const members = [
  { userId: 'andre' },
  { userId: 'paulo' },
  { userId: 'davi' },
  { userId: 'maria' },
];

function slotsFor(userId, starts) {
  return starts.map((slotStart) => ({ userId, slotStart }));
}

const twoHours = [iso(18), iso(18, 30), iso(19), iso(19, 30)];

describe('group availability domain', () => {
  it('aceita slots alinhados de 30 min no fuso do grupo e rejeita 18:17', () => {
    expect(isAlignedSlotStart(iso(18), tz)).toBe(true);
    expect(isAlignedSlotStart(iso(18, 30), tz)).toBe(true);
    expect(isAlignedSlotStart(zonedLocalToUtc(tz, 2026, 9, 26, 18, 17), tz)).toBe(false);
    expect(normalizeAvailabilitySlots([iso(19), iso(18), iso(18), 'nope'], tz)).toEqual([iso(18), iso(19)]);
  });

  it('Asia/Kathmandu: 18:00 e 18:30 locais aceitos; 18:15 local rejeitado', () => {
    const ktm = 'Asia/Kathmandu';
    const eighteen = zonedLocalToUtc(ktm, 2026, 10, 3, 18, 0);
    const eighteenThirty = zonedLocalToUtc(ktm, 2026, 10, 3, 18, 30);
    const eighteenFifteen = zonedLocalToUtc(ktm, 2026, 10, 3, 18, 15);
    expect(eighteen.getUTCMinutes()).toBe(15);
    expect(isAlignedSlotStart(eighteen, ktm)).toBe(true);
    expect(isAlignedSlotStart(eighteenThirty, ktm)).toBe(true);
    expect(isAlignedSlotStart(eighteenFifteen, ktm)).toBe(false);
    expect(isAlignedSlotStart(eighteen)).toBe(false);
  });

  it('janela 60/90/120 usa slots consecutivos', () => {
    expect(windowSlotStarts(saturday, 60)).toEqual([iso(18), iso(18, 30)]);
    expect(windowSlotStarts(saturday, 90)).toHaveLength(3);
    expect(windowSlotStarts(saturday, 120)).toEqual(twoHours);
    expect(windowSlotStarts(saturday, 45)).toEqual([]);
  });

  it('usuário parcialmente disponível não conta na janela de 2h', () => {
    const slots = [
      ...slotsFor('andre', twoHours),
      ...slotsFor('paulo', [iso(18), iso(18, 30), iso(19)]),
    ];
    const available = getAvailableUsersForWindow({
      members,
      slots,
      start: saturday,
      durationMinutes: 120,
    });
    expect(available.map((row) => row.userId)).toEqual(['andre']);
  });

  it('1 slot e 30 min: só quem marcou aquele horário', () => {
    const slots = [...slotsFor('andre', [iso(18)]), ...slotsFor('paulo', [iso(18, 30)])];
    expect(
      getAvailableUsersForWindow({ members, slots, start: saturday, durationMinutes: 30 }).map((row) => row.userId)
    ).toEqual(['andre']);
  });

  it('ordena por pessoas, percentual e horário mais próximo', () => {
    const later = zonedLocalToUtc(tz, 2026, 9, 27, 18, 0);
    const laterHours = [
      later.toISOString(),
      new Date(later.getTime() + 30 * 60 * 1000).toISOString(),
      new Date(later.getTime() + 60 * 60 * 1000).toISOString(),
      new Date(later.getTime() + 90 * 60 * 1000).toISOString(),
    ];
    const slots = [
      ...slotsFor('andre', twoHours),
      ...slotsFor('paulo', twoHours),
      ...slotsFor('davi', twoHours),
      ...slotsFor('maria', laterHours),
      ...slotsFor('andre', laterHours),
    ];
    const ranked = rankAvailabilityWindows({
      members,
      slots,
      durationMinutes: 120,
      from: iso(17),
      to: new Date(later.getTime() + 3 * 60 * 60 * 1000).toISOString(),
    });
    expect(ranked[0].count).toBe(3);
    expect(ranked[0].start).toBe(iso(18));
    expect(ranked[0].percent).toBe(0.75);
    expect(ranked.some((row) => row.count === 2 && row.start === later.toISOString())).toBe(true);
  });

  it('empate de pessoas prefere o horário mais cedo', () => {
    const otherStart = iso(20);
    const other = [iso(20), iso(20, 30), iso(21), iso(21, 30)];
    const slots = [...slotsFor('andre', twoHours), ...slotsFor('paulo', twoHours), ...slotsFor('andre', other), ...slotsFor('paulo', other)];
    const ranked = rankAvailabilityWindows({
      members: members.slice(0, 2),
      slots,
      durationMinutes: 120,
    });
    expect(ranked[0].start).toBe(iso(18));
    expect(ranked.some((row) => row.start === otherStart && row.count === 2)).toBe(true);
    expect(ranked[0].count).toBe(2);
  });

  it('dia sem ninguém e todos disponíveis', () => {
    expect(rankAvailabilityWindows({ members, slots: [], durationMinutes: 60 })).toEqual([]);
    const slots = members.flatMap((member) => slotsFor(member.userId, twoHours));
    const ranked = rankAvailabilityWindows({ members, slots, durationMinutes: 120 });
    expect(ranked[0].count).toBe(4);
    expect(ranked[0].percent).toBe(1);
  });

  it('entrada UTC independente do fuso na comparação de janela', () => {
    const start = '2026-09-26T21:00:00.000Z';
    const slots = [
      { userId: 'andre', slotStart: '2026-09-26T21:00:00.000Z' },
      { userId: 'andre', slotStart: '2026-09-26T21:30:00.000Z' },
    ];
    expect(
      getAvailableUsersForWindow({
        members: [{ userId: 'andre' }],
        slots,
        start,
        durationMinutes: 60,
      })
    ).toHaveLength(1);
  });

  it('monta grade 08:00–23:00 no timezone do grupo', () => {
    const grid = buildAvailabilityGrid({
      timeZone: tz,
      start: saturday,
      dayCount: 7,
      members,
      slots: slotsFor('andre', [iso(18)]),
    });
    expect(grid.hours[0].label).toBe('08:00');
    expect(grid.hours.at(-1).label).toBe('23:00');
    const saturdayColumn = grid.days.find((day) => day.dateKey === '2026-09-26');
    const cell = saturdayColumn.slots.find((slot) => slot.iso === iso(18));
    expect(cell.count).toBe(1);
    expect(cell.userIds).toEqual(['andre']);
  });
});
