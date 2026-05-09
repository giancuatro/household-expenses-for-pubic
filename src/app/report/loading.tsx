export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-48 bg-muted rounded" />
      <div className="card h-64 bg-muted/50" />
      <div className="card h-32 bg-muted/50" />
      <div className="card h-32 bg-muted/50" />
    </div>
  );
}
