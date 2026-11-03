export type PodiumKind = "gold" | "silver" | "bronze";

export function podiumKindForPosition(position: number): PodiumKind | undefined {
  if (position === 1) { return "gold"; }
  if (position === 2) { return "silver"; }
  if (position === 3) { return "bronze"; }
  return undefined;
}

const podiumCodePoints: Readonly<Record<PodiumKind, number>> = {
  gold: 0x1f3c6,
  silver: 0x1f948,
  bronze: 0x1f949,
};

export function podiumMark(
  document: Document,
  kind: PodiumKind,
  label: string,
): HTMLSpanElement {
  const mark = document.createElement("span");
  mark.className = `podium-mark podium-mark--${kind}`;
  mark.setAttribute("role", "img");
  mark.setAttribute("aria-label", label);
  mark.title = label;
  mark.textContent = String.fromCodePoint(podiumCodePoints[kind]);
  return mark;
}
