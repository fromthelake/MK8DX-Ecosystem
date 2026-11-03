export type ProductPlatform = "android" | "windows" | "web" | "ios" | "linux" | "macos";

export const PRODUCT_PLATFORM_LABELS: Readonly<Record<ProductPlatform, string>> = {
  android: "Android",
  windows: "Windows",
  web: "Web",
  ios: "iOS",
  linux: "Linux",
  macos: "macOS",
};

export function sourcePlatform(sourceKind: string): ProductPlatform | null {
  if (sourceKind.startsWith("android_")) { return "android"; }
  if (sourceKind.startsWith("livetrial_")) { return "windows"; }
  // Both web kinds are the same platform: ADR-0204 records how the fields were filled, and the
  // label stays the neutral platform mark it has always been.
  if (sourceKind === "web_manual" || sourceKind === "web_scan") { return "web"; }
  return null;
}

function shape(document: Document, tag: string, attributes: Record<string, string>): SVGElement {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) { node.setAttribute(name, value); }
  return node;
}

export function platformMark(document: Document, platform: ProductPlatform): HTMLElement {
  const mark = document.createElement("span");
  mark.className = `platform-mark platform-mark--${platform}`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  if (platform === "android") {
    svg.append(
      shape(document, "path", { d: "M5 10h14v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z", fill: "currentColor" }),
      shape(document, "path", { d: "M7 10a5 5 0 0 1 10 0M8 5 6.8 3M16 5l1.2-2", stroke: "currentColor", "stroke-width": "1.7", "stroke-linecap": "round" }),
      shape(document, "circle", { cx: "9", cy: "8", r: "1", fill: "#07150d" }),
      shape(document, "circle", { cx: "15", cy: "8", r: "1", fill: "#07150d" }),
    );
  } else if (platform === "windows") {
    svg.append(
      shape(document, "rect", { x: "2", y: "3", width: "20", height: "14", rx: "2", stroke: "currentColor", "stroke-width": "1.7" }),
      shape(document, "path", { d: "M8 20h8M12 17v3M7 7l4-.6v4.1H7zm5-.8 5-.7v5h-5zM7 11.5h4v4.1l-4-.6zm5 0h5v5l-5-.7z", fill: "currentColor" }),
    );
  } else if (platform === "web") {
    svg.append(
      shape(document, "circle", { cx: "12", cy: "12", r: "9", stroke: "currentColor", "stroke-width": "1.7" }),
      shape(document, "path", { d: "M3.5 12h17M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18", stroke: "currentColor", "stroke-width": "1.4" }),
    );
  } else if (platform === "linux") {
    svg.append(
      shape(document, "ellipse", { cx: "12", cy: "13", rx: "6", ry: "8", fill: "currentColor" }),
      shape(document, "ellipse", { cx: "12", cy: "15", rx: "4", ry: "5", fill: "#fff" }),
      shape(document, "circle", { cx: "10", cy: "9", r: "1", fill: "#fff" }),
      shape(document, "circle", { cx: "14", cy: "9", r: "1", fill: "#fff" }),
      shape(document, "path", { d: "m9.5 11 2.5 2 2.5-2-2.5-1z", fill: "#f6c343" }),
    );
  } else {
    svg.append(shape(document, "path", {
      d: "M16.8 12.7c0-3 2.5-4.4 2.6-4.5a5.5 5.5 0 0 0-4.3-2.3c-1.8-.2-3.6 1.1-4.3 1.1-.8 0-2.2-1.1-3.5-1-1.8 0-3.5 1.1-4.5 2.7-2 3.4-.5 8.5 1.4 11.3 1 1.3 2.1 2.9 3.5 2.8 1.4 0 2-1 3.8-1s2.3 1 3.8 1c1.5 0 2.5-1.4 3.4-2.8a12 12 0 0 0 1.6-3.3 4.8 4.8 0 0 1-3.5-4zm-2.9-8.6c.8-1 1.3-2.5 1.2-4.1-1.3.1-2.8.9-3.7 2-.8.9-1.4 2.4-1.2 3.8 1.4.1 2.8-.7 3.7-1.7z",
      fill: "currentColor",
    }));
  }
  mark.append(svg);
  return mark;
}
