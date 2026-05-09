export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-48 bg-muted rounded" />
      <div className="flex gap-2">
        <div className="h-8 w-16 bg-muted rounded-full" />
        <div className="h-8 w-16 bg-muted rounded-full" />
        <div className="h-8 w-16 bg-muted rounded-full" />
      </div>
      <div className="card h-72 bg-muted/50" />
      <div className="card h-72 bg-muted/50" />
    </div>
  );
}
