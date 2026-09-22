import { useMemo, useState } from 'react';
import Button from '../ui/Button.jsx';
import { memberDisplayName } from './labels.js';

export default function ConvertProposalForm({
  proposal,
  members = [],
  busy = false,
  onSubmit,
  onCancel,
}) {
  const yesPeople = useMemo(() => {
    const yesIds = new Set(
      (proposal?.responses ?? []).filter((item) => item.response === 'yes').map((item) => item.userId)
    );
    return members
      .map((member) => {
        const response = (proposal?.responses ?? []).find((item) => item.userId === member.userId);
        return {
          ...member,
          playerId: response?.playerId ?? member.playerId ?? null,
          playerName: response?.playerName ?? member.displayName ?? member.playerName ?? null,
        };
      })
      .filter((member) => yesIds.has(member.userId));
  }, [members, proposal]);

  const [selectedPlayers, setSelectedPlayers] = useState(() =>
    new Set(yesPeople.filter((member) => member.playerId).map((member) => member.userId))
  );
  const [teamSize, setTeamSize] = useState(2);
  const [teamCount, setTeamCount] = useState(2);

  function toggle(userId) {
    setSelectedPlayers((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.({
          teamSize: Number(teamSize),
          teamCount: Number(teamCount),
          playerUserIds: [...selectedPlayers],
        });
      }}
    >
      <p className="text-small">
        Isso cria um encontro do PaDre a partir desta proposta. Quem respondeu Vou não entra sozinho no
        acesso nem no elenco.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-small font-semibold">
          Jogadores por time
          <select
            value={teamSize}
            onChange={(event) => setTeamSize(Number(event.target.value))}
            className="mt-1 w-full border p-2 rounded-lg"
            style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', borderColor: 'var(--border-color)' }}
          >
            {[2, 3, 4, 5, 6].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="text-small font-semibold">
          Times
          <select
            value={teamCount}
            onChange={(event) => setTeamCount(Number(event.target.value))}
            className="mt-1 w-full border p-2 rounded-lg"
            style={{ backgroundColor: 'var(--bg-app)', color: 'var(--text-main)', borderColor: 'var(--border-color)' }}
          >
            {[2, 3, 4].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <h4 className="text-small font-bold">Jogadores com Vou</h4>
      {yesPeople.length === 0 ? (
        <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
          Ninguém confirmou presença ainda. O encontro ainda pode ser criado.
        </p>
      ) : null}
      {yesPeople.map((member) => (
        <label key={member.userId} className="flex items-start gap-2 text-small">
          {member.playerId ? (
            <input
              type="checkbox"
              checked={selectedPlayers.has(member.userId)}
              onChange={() => toggle(member.userId)}
            />
          ) : (
            <input type="checkbox" disabled checked={false} />
          )}
          <span>
            {memberDisplayName(member)}
            {member.playerId ? (
              <span className="block text-caption" style={{ color: 'var(--text-muted)' }}>
                Adicionar jogador ao encontro
              </span>
            ) : (
              <span className="block text-caption" style={{ color: 'var(--text-muted)' }}>
                Sem jogador vinculado. Não entra no elenco automaticamente.
              </span>
            )}
          </span>
        </label>
      ))}
      <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
        Acesso ao encontro continua separado. Quem precisa colaborar entra pelo convite do encontro.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          Criar encontro
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Voltar
        </Button>
      </div>
    </form>
  );
}
