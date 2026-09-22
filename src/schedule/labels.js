import { DEFAULT_GROUP_TIMEZONE } from '../domain/groupAvailability.js';

export const WEEKDAY_SHORT_PT = Object.freeze({
  Sun: 'Dom',
  Mon: 'Seg',
  Tue: 'Ter',
  Wed: 'Qua',
  Thu: 'Qui',
  Fri: 'Sex',
  Sat: 'Sáb',
});

export function timezoneHint(timeZone) {
  return `Horários em ${timeZone || DEFAULT_GROUP_TIMEZONE}`;
}

export function memberDisplayName(member) {
  return member?.displayName || member?.username || 'Membro';
}

export function durationLabel(minutes) {
  const value = Number(minutes);
  if (value === 30) return '30 min';
  if (value === 60) return '1h';
  if (value === 90) return '1h30';
  if (value === 120) return '2h';
  return `${value} min`;
}

export function proposalShareText(proposal, timeZone, hash) {
  const when = proposal?.startsAt
    ? new Intl.DateTimeFormat('pt-BR', {
        timeZone: timeZone || DEFAULT_GROUP_TIMEZONE,
        weekday: 'long',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(proposal.startsAt))
    : '';
  const end = proposal?.endsAt
    ? new Intl.DateTimeFormat('pt-BR', {
        timeZone: timeZone || DEFAULT_GROUP_TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(proposal.endsAt))
    : '';
  const place = proposal?.locationName ? ` — ${proposal.locationName}` : '';
  const link = hash ? ` ${hash}` : '';
  return `Proposta: ${when}–${end}${place}${link}`.replace(/\s+/g, ' ').trim();
}
