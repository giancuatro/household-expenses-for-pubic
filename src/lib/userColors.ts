export type UserColor = {
  bg: string;
  text: string;
  border: string;
  dot: string;
};

const PALETTE: UserColor[] = [
  {
    bg: "bg-primary/15",
    text: "text-primary",
    border: "border-primary/30",
    dot: "bg-primary",
  },
  {
    bg: "bg-success/15",
    text: "text-success",
    border: "border-success/30",
    dot: "bg-success",
  },
  {
    bg: "bg-warning/20",
    text: "text-warning",
    border: "border-warning/40",
    dot: "bg-warning",
  },
  {
    bg: "bg-accent",
    text: "text-accent-foreground",
    border: "border-border",
    dot: "bg-muted-foreground",
  },
];

const FALLBACK: UserColor = {
  bg: "bg-muted",
  text: "text-muted-foreground",
  border: "border-border",
  dot: "bg-muted-foreground",
};

export function buildUserColorMap(userIds: string[]): Map<string, UserColor> {
  const map = new Map<string, UserColor>();
  userIds.forEach((id, i) => {
    map.set(id, PALETTE[i % PALETTE.length] ?? FALLBACK);
  });
  return map;
}

export function userColor(map: Map<string, UserColor>, id: string | null | undefined): UserColor {
  if (!id) return FALLBACK;
  return map.get(id) ?? FALLBACK;
}
