/** Saturating log curve: 0 at x = 0, 1 at x = ref, flat beyond. Rewards the first units most, so volume can't be farmed. */
export function logRef(x: number, ref: number): number {
  if (!(x > 0)) return 0;
  return Math.min(1, Math.log1p(x) / Math.log1p(ref));
}

/** Linear ramp clamped to 0..1. */
export function ramp(x: number, full: number): number {
  if (!(x > 0)) return 0;
  return Math.min(1, x / full);
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const round1 = (x: number) => Math.round(x * 10) / 10;

export const DAY = 86_400_000;
export const daysSince = (iso: string | null | undefined, now: number) =>
  iso ? Math.max(0, (now - Date.parse(iso)) / DAY) : Number.POSITIVE_INFINITY;

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
