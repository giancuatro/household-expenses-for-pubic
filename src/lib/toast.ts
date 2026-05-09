export type ToastVariant = "default" | "success" | "error";
export type ToastItem = {
  id: string;
  message: string;
  variant: ToastVariant;
  durationMs: number;
};

type Listener = (items: ToastItem[]) => void;

let _items: ToastItem[] = [];
let _listeners: Listener[] = [];

function emit() {
  const snapshot = [..._items];
  for (const fn of _listeners) fn(snapshot);
}

export function subscribeToasts(fn: Listener): () => void {
  _listeners = [..._listeners, fn];
  fn([..._items]);
  return () => {
    _listeners = _listeners.filter((l) => l !== fn);
  };
}

export function dismissToast(id: string) {
  _items = _items.filter((t) => t.id !== id);
  emit();
}

function show(message: string, variant: ToastVariant, durationMs: number) {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  _items = [..._items, { id, message, variant, durationMs }];
  emit();
  if (durationMs > 0 && typeof window !== "undefined") {
    window.setTimeout(() => dismissToast(id), durationMs);
  }
  return id;
}

export const toast = {
  success: (message: string, durationMs = 2500) => show(message, "success", durationMs),
  error: (message: string, durationMs = 4000) => show(message, "error", durationMs),
  info: (message: string, durationMs = 2500) => show(message, "default", durationMs),
};
