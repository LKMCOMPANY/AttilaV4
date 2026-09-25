/**
 * One way to show a wire value this build does not know: `some_new_reason` →
 * "Some new reason". The server may add values before a client ships; every
 * presentation vocabulary degrades through this (attention reasons, slot
 * refusals, host-health verdicts), and the Swift side mirrors it
 * (`String.humanisedWireValue(fallback:)`).
 */
export function humaniseWireValue(value: string, fallback: string): string {
  const words = value.replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : fallback;
}
