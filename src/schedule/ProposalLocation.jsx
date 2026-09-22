export default function ProposalLocation({ locationName, locationDetails }) {
  if (!locationName && !locationDetails) {
    return (
      <p className="text-small" style={{ color: 'var(--text-muted)' }} data-location-mode="text">
        Local ainda não informado.
      </p>
    );
  }

  return (
    <div className="space-y-1" data-location-mode="text">
      {locationName ? <p className="text-small font-semibold">{locationName}</p> : null}
      {locationDetails ? (
        <p className="text-small" style={{ color: 'var(--text-muted)' }}>
          {locationDetails}
        </p>
      ) : null}
    </div>
  );
}
