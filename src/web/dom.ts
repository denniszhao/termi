export function mustGetElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing required element: ${id}`);
  }
  return el as T;
}

export function getClosestKey(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }
  return target.closest("[data-char],[data-id]") as HTMLElement | null;
}

