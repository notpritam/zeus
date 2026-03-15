interface StatusRowProps {
  label: string;
  status: string;
  active?: boolean;
}

function StatusRow({ label, status, active = false }: StatusRowProps) {
  return (
    <div className="status-row">
      <span className="label">{label}</span>
      <span className={`badge ${active ? 'active' : 'inactive'}`}>{status}</span>
    </div>
  );
}

export default StatusRow;
