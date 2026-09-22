export default function LocationField({
  locationName = '',
  locationDetails = '',
  onChange,
  disabled = false,
}) {
  return (
    <div className="space-y-2" data-location-mode="text">
      <label className="block text-small font-semibold">
        Local
        <input
          value={locationName}
          disabled={disabled}
          maxLength={120}
          placeholder="Quadra do São Mateus"
          onChange={(event) => onChange?.({ locationName: event.target.value, locationDetails })}
          className="mt-1 w-full border p-2 rounded-lg text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-main)',
            borderColor: 'var(--border-color)',
          }}
        />
      </label>
      <label className="block text-small font-semibold">
        Detalhes
        <textarea
          value={locationDetails}
          disabled={disabled}
          maxLength={500}
          rows={2}
          placeholder="Rua X, próximo ao..."
          onChange={(event) => onChange?.({ locationName, locationDetails: event.target.value })}
          className="mt-1 w-full border p-2 rounded-lg text-sm outline-none"
          style={{
            backgroundColor: 'var(--bg-app)',
            color: 'var(--text-main)',
            borderColor: 'var(--border-color)',
          }}
        />
      </label>
    </div>
  );
}
