export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="card h-40 bg-muted/50" />
      <div className="grid grid-cols-3 gap-3">
        <div className="card h-20 bg-muted/50" />
        <div className="card h-20 bg-muted/50" />
        <div className="card h-20 bg-muted/50" />
      </div>
      <div className="card h-32 bg-muted/50" />
    </div>
  );
}
