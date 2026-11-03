// The report's charts, in the shape the community's own exported report uses:
// hand-built SVG with a readout that follows the pointer.
//
// The export ships a runtime that decodes a payload on the chart and writes a
// small table under it while you move across the races. This is that
// behaviour, built for a page that has the data in memory: every chart is
// described once, drawn once, and answers "what happened in race 7?" from the
// same description.

/**
 * How a readout lays its rows out. The source's own runtime switches on this:
 * a place chart prints the place and the track it was driven on, the benchmark
 * prints who is being compared, and the distribution prints a share and the
 * tracks behind the bar.
 */
export type ChartReadoutMode = "place-track" | "benchmark" | "delta" | "compact";

export type ChartBenchmarkPack = Readonly<{
  /** Who held the place this row compares against. */
  displayName: string;
  benchmarkTotal: number;
  playerTotal: number;
  delta: number;
  /** "punten" / "points". */
  unit: string;
}>;

export type ChartPointValue = Readonly<{
  /** The series this value belongs to: "Positie", "#1", the opponent's name. */
  label: string;
  color: string;
  value: number;
  /** What the readout prints: "3e plek", "+12", "146 punten". */
  display: string;
  /** Extra lines under the value: the track, a tie, the tracks behind a bar. */
  lines?: readonly string[];
  /** Pictures printed before the first line: the cup and the track. */
  icons?: readonly Readonly<{ src: string; alt: string }>[];
  /** Pictures per line, index-aligned with `lines`: the cup and the track behind a bar. */
  pictures?: readonly (readonly Readonly<{ src: string; alt: string }>[])[];
  /** The benchmark row's own parts, printed as one pack. */
  pack?: ChartBenchmarkPack;
}>;

export type ChartPoint = Readonly<{
  /** The race number as the night counted it. */
  raceNumber: number;
  /** The x label under the chart, usually the race number. */
  label: string;
  /**
   * The readout's head, in two parts as the source prints it: a bold "Race 7"
   * and, beside it, where that race belongs - "Kampioen · race 7".
   */
  head: Readonly<{ race: string; label: string }>;
  mode: ChartReadoutMode;
  values: readonly ChartPointValue[];
}>;

export type ChartSeries = Readonly<{
  label: string;
  color: string;
  values: readonly number[];
  /** Fill the area between the line and the baseline. */
  area?: boolean;
}>;

export type LineChartInput = Readonly<{
  series: readonly ChartSeries[];
  points: readonly ChartPoint[];
  yMin: number;
  yMax: number;
  yStep: number;
  /** 1 at the top: a position axis. */
  invert?: boolean;
  /** A rule at this value, and the baseline an area fills to. */
  baseline?: number;
  /**
   * A place chart: where the line reaches first, second or third, the source
   * draws the medal itself in place of the dot.
   */
  podium?: boolean;
  /**
   * A duel: one line and the space between it and the zero rule filled by
   * side. The names sit at the top and the bottom left, so it is plain who
   * leads where - above the rule the first, below it the second.
   */
  duel?: Readonly<{ ahead: string; behind: string }>;
  xLabel: string;
  ariaLabel: string;
}>;

export type BarChartInput = Readonly<{
  counts: readonly number[];
  color: string;
  average?: number;
  points: readonly ChartPoint[];
  xLabel: string;
  ariaLabel: string;
}>;

const escape = (value: string): string => value
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const round = (value: number): string => `${Math.round(value * 10) / 10}`;

/**
 * The series colour beside its name. An SVG shape, not an inline style: the
 * page's own security policy refuses a style attribute.
 */
const keySwatch = (color: string): string =>
  `<svg class="tournament-report__readout-key" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill="${escape(color)}"/></svg>`;

/** The marks the source draws on a place chart's first three positions. */
/**
 * The podium on a place chart: the place as a numeral in its own rank colour (DESIGN_SYSTEM
 * sections 15 and 17), where the export drew a medal glyph. The same decision the ranking tables
 * took in Phase 6 and the Android twin took in Phase 11 - the numeral says which place it is
 * without a legend, and the colour is never the only cue.
 *
 * The rank travels as a modifier class, never as an inline style: the hosted pages are served
 * under `style-src 'self'`, which drops a `style` attribute and reports it - 554 times on one
 * published night (measured by the range gate, Phase 11).
 */
const PODIUM: Readonly<Record<number, string>> = { 1: "gold", 2: "silver", 3: "bronze" };

const LINE = { width: 860, height: 308, left: 56, right: 20, top: 20, bottom: 42 } as const;
const BAR = { width: 720, height: 280, left: 44, right: 16, top: 20, bottom: 40 } as const;

/** The x of every point, so the pointer can find the nearest one. */
function xPositions(count: number, left: number, innerWidth: number): readonly number[] {
  if (count <= 1) { return [left + innerWidth / 2]; }
  return Array.from({ length: count }, (_, index) => left + (index / (count - 1)) * innerWidth);
}

/** The source's 860x308 line chart: races along the bottom, one line per series. */
export function reportLineChart(input: LineChartInput): string {
  const innerWidth = LINE.width - LINE.left - LINE.right;
  const innerHeight = LINE.height - LINE.top - LINE.bottom;
  const count = Math.max(1, ...input.series.map((series) => series.values.length));
  const xs = xPositions(count, LINE.left, innerWidth);
  const span = Math.max(1, input.yMax - input.yMin);
  const y = (value: number): number => {
    const ratio = (value - input.yMin) / span;
    return input.invert === true ? LINE.top + ratio * innerHeight : LINE.top + (1 - ratio) * innerHeight;
  };
  const parts: string[] = [
    `<svg class="tournament-report__chart" viewBox="0 0 ${LINE.width} ${LINE.height}" role="img" aria-label="${escape(input.ariaLabel)}" preserveAspectRatio="xMidYMid meet">`,
  ];
  for (let tick = input.yMin; tick <= input.yMax + 1e-9; tick += input.yStep) {
    const line = y(tick);
    parts.push(`<line x1="${LINE.left}" x2="${LINE.width - LINE.right}" y1="${round(line)}" y2="${round(line)}" class="tournament-report__grid"/>`);
    parts.push(`<text x="${LINE.left - 10}" y="${round(line + 4)}" text-anchor="end" class="tournament-report__tick">${round(tick)}</text>`);
  }
  if (input.baseline !== undefined) {
    parts.push(`<line x1="${LINE.left}" x2="${LINE.width - LINE.right}" y1="${round(y(input.baseline))}" y2="${round(y(input.baseline))}" class="tournament-report__baseline"/>`);
  }
  const everyOther = count > 24 ? 4 : count > 12 ? 2 : 1;
  xs.forEach((x, index) => {
    if (index % everyOther !== 0 && index !== count - 1) { return; }
    parts.push(`<text x="${round(x)}" y="${LINE.height - 16}" text-anchor="middle" class="tournament-report__tick">${escape(input.points[index]?.label ?? `${index + 1}`)}</text>`);
  });
  parts.push(`<text x="${round(LINE.left + innerWidth / 2)}" y="${LINE.height - 2}" text-anchor="middle" class="tournament-report__axis">${escape(input.xLabel)}</text>`);
  // The guide the pointer moves, drawn under the lines so it never hides one.
  parts.push(`<line class="tournament-report__guide" x1="0" x2="0" y1="${LINE.top}" y2="${LINE.top + innerHeight}" hidden/>`);
  if (input.duel !== undefined) {
    parts.push(...duelBody(input, xs, y));
  } else {
    for (const series of input.series) {
      if (series.values.length === 0) { continue; }
      const coordinates = series.values.map((value, index) => `${round(xs[index] ?? 0)},${round(y(value))}`);
      if (series.area === true) {
        const base = round(y(input.baseline ?? input.yMin));
        parts.push(`<path d="M${round(xs[0] ?? 0)},${base} L${coordinates.join(" L")} L${round(xs[series.values.length - 1] ?? 0)},${base} Z" fill="${series.color}" fill-opacity="0.12" stroke="none"/>`);
      }
      parts.push(`<polyline points="${coordinates.join(" ")}" fill="none" stroke="${series.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`);
      series.values.forEach((value, index) => {
        const rank = input.podium === true ? PODIUM[value] : undefined;
        if (rank !== undefined) {
          // The place stands where the dot would: the numeral reads at a glance without a legend,
          // and its rank colour is a second cue rather than the only one.
          parts.push(`<g class="tournament-report__podium tournament-report__podium--${rank}" data-index="${index}"><text x="${round(xs[index] ?? 0)}" y="${round(y(value))}" text-anchor="middle">${value}</text></g>`);
          return;
        }
        parts.push(`<circle class="tournament-report__dot" data-index="${index}" cx="${round(xs[index] ?? 0)}" cy="${round(y(value))}" r="4.5" fill="${series.color}"/>`);
      });
    }
  }
  parts.push("</svg>");
  return parts.join("");
}

/** Each duel needs its own clip ids; two charts on a page must not share them. */
let duelSerial = 0;

/**
 * The duel, drawn the way the source draws it: one line, the space between it
 * and the zero rule filled on the side that owns it, and a name at the top left
 * and the bottom left so nobody has to work out which half is theirs. The two
 * halves are the same area path seen through two clips, so a race that crosses
 * the rule needs no arithmetic to split it.
 */
function duelBody(
  input: LineChartInput,
  xs: readonly number[],
  y: (value: number) => number,
): string[] {
  const duel = input.duel;
  const series = input.series[0];
  if (duel === undefined || series === undefined || series.values.length === 0) { return []; }
  const innerWidth = LINE.width - LINE.left - LINE.right;
  const innerHeight = LINE.height - LINE.top - LINE.bottom;
  const zero = y(input.baseline ?? 0);
  const coordinates = series.values.map((value, index) => `${round(xs[index] ?? 0)},${round(y(value))}`);
  const area = `M${round(xs[0] ?? 0)},${round(zero)} L${coordinates.join(" L")} L${round(xs[series.values.length - 1] ?? 0)},${round(zero)} Z`;
  duelSerial += 1;
  const above = `duel-above-${duelSerial}`;
  const below = `duel-below-${duelSerial}`;
  return [
    `<defs>`,
    `<clipPath id="${above}"><rect x="${LINE.left}" y="${LINE.top}" width="${innerWidth}" height="${round(Math.max(0, zero - LINE.top))}"/></clipPath>`,
    `<clipPath id="${below}"><rect x="${LINE.left}" y="${round(zero)}" width="${innerWidth}" height="${round(Math.max(0, LINE.top + innerHeight - zero))}"/></clipPath>`,
    `</defs>`,
    `<path class="tournament-report__duel-area tournament-report__duel-area--ahead" clip-path="url(#${above})" d="${area}"/>`,
    `<path class="tournament-report__duel-area tournament-report__duel-area--behind" clip-path="url(#${below})" d="${area}"/>`,
    `<text class="tournament-report__duel-name" x="${LINE.left + 6}" y="${LINE.top + 14}" text-anchor="start">${escape(duel.ahead)}</text>`,
    `<text class="tournament-report__duel-name" x="${LINE.left + 6}" y="${LINE.top + innerHeight - 6}" text-anchor="start">${escape(duel.behind)}</text>`,
    `<polyline class="tournament-report__duel-line" points="${coordinates.join(" ")}"/>`,
    ...series.values.map((value, index) =>
      `<circle class="tournament-report__dot tournament-report__dot--${value < 0 ? "behind" : "ahead"}" data-index="${index}" cx="${round(xs[index] ?? 0)}" cy="${round(y(value))}" r="4.5"/>`),
  ];
}

/** The source's 720x280 histogram: how often each finishing place came up. */
export function reportBarChart(input: BarChartInput): string {
  const innerWidth = BAR.width - BAR.left - BAR.right;
  const innerHeight = BAR.height - BAR.top - BAR.bottom;
  const slot = innerWidth / Math.max(1, input.counts.length);
  const top = Math.max(1, ...input.counts);
  const parts: string[] = [
    `<svg class="tournament-report__chart" viewBox="0 0 ${BAR.width} ${BAR.height}" role="img" aria-label="${escape(input.ariaLabel)}" preserveAspectRatio="xMidYMid meet">`,
  ];
  const step = Math.max(1, Math.ceil(top / 4));
  for (let tick = 0; tick <= top; tick += step) {
    const line = BAR.top + (1 - tick / top) * innerHeight;
    parts.push(`<line x1="${BAR.left}" x2="${BAR.width - BAR.right}" y1="${round(line)}" y2="${round(line)}" class="tournament-report__grid"/>`);
    parts.push(`<text x="${BAR.left - 8}" y="${round(line + 4)}" text-anchor="end" class="tournament-report__tick">${tick}</text>`);
  }
  input.counts.forEach((count, index) => {
    const barHeight = (count / top) * innerHeight;
    const x = BAR.left + index * slot + slot * 0.15;
    parts.push(`<rect class="tournament-report__bar" data-index="${index}" x="${round(x)}" y="${round(BAR.top + innerHeight - barHeight)}" width="${round(slot * 0.7)}" height="${round(barHeight)}" rx="3" fill="${input.color}" fill-opacity="${count === 0 ? 0.18 : 0.85}"/>`);
    parts.push(`<text x="${round(BAR.left + index * slot + slot / 2)}" y="${BAR.height - 16}" text-anchor="middle" class="tournament-report__tick">${index + 1}</text>`);
  });
  if (input.average !== undefined && input.counts.length > 0) {
    const x = BAR.left + (input.average - 0.5) * slot;
    parts.push(`<line x1="${round(x)}" x2="${round(x)}" y1="${BAR.top}" y2="${BAR.top + innerHeight}" class="tournament-report__average"/>`);
  }
  parts.push(`<text x="${round(BAR.left + innerWidth / 2)}" y="${BAR.height - 2}" text-anchor="middle" class="tournament-report__axis">${escape(input.xLabel)}</text>`);
  parts.push("</svg>");
  return parts.join("");
}

/**
 * What every bound chart was drawn from: its points and where each sits along the drawing. The
 * WordPress export (tournament-report-wordpress.ts) reads it to give the pasted page the same
 * readouts without the application behind it.
 */
export type ReportChartBinding = Readonly<{
  points: readonly ChartPoint[];
  layout: "line" | "bar";
  emptyLabel: string;
  positions: readonly number[];
  width: number;
}>;

export const REPORT_CHART_BINDINGS = new WeakMap<HTMLElement, ReportChartBinding>();

/**
 * Binds a drawn chart to its points: moving across it writes the readout, the
 * slider under it steps through the races, and a tap holds one still. This is
 * the source export's own runtime, for a page that has the races in memory.
 */
export function bindReportChart(
  shell: HTMLElement,
  readout: HTMLElement,
  points: readonly ChartPoint[],
  layout: "line" | "bar",
  emptyLabel: string,
): void {
  // A document without a query interface (the unit tests' own) still gets the
  // drawing; only the pointer behaviour needs one.
  if (typeof shell.querySelector !== "function" || points.length === 0) { return; }
  const svg = shell.querySelector("svg");
  if (svg === null) { return; }
  const box = layout === "line" ? LINE : BAR;
  const innerWidth = box.width - box.left - box.right;
  const positions = layout === "line"
    ? xPositions(points.length, box.left, innerWidth)
    : points.map((_, index) => box.left + (index + 0.5) * (innerWidth / Math.max(1, points.length)));
  REPORT_CHART_BINDINGS.set(shell, { points, layout, emptyLabel, positions, width: box.width });
  const guide = svg.querySelector<SVGLineElement>(".tournament-report__guide");
  const dots = [...svg.querySelectorAll<SVGElement>(".tournament-report__dot, .tournament-report__bar, .tournament-report__podium")];
  let active = -1;
  // A tap holds a race still so a phone reader can read it; tapping the same
  // point again lets go. This is the source runtime's own hover lock.
  let locked = -1;

  // The slider under the chart, spanning exactly the races the chart draws:
  // the first and last point sit at fixed fractions of the viewBox, so the
  // track needs no measuring and no resize handler.
  const scrubber = buildScrubber(shell, readout, points.length, positions, box.width);

  const paint = (index: number, resting = false): void => {
    const point = points[index];
    if (point === undefined) { return; }
    active = resting ? -1 : index;
    if (guide !== null) {
      if (resting) { guide.setAttribute("hidden", ""); } else {
        guide.setAttribute("x1", `${positions[index] ?? 0}`);
        guide.setAttribute("x2", `${positions[index] ?? 0}`);
        guide.removeAttribute("hidden");
      }
    }
    for (const dot of dots) {
      const own = Number(dot.getAttribute("data-index"));
      dot.classList.toggle("is-active", !resting && own === index);
    }
    readout.innerHTML = readoutHtml(point, emptyLabel, resting);
    if (scrubber !== null) { scrubber.value = `${index}`; }
  };

  // What the chart shows when nothing is hovered: the last race of a line, and
  // the tallest bar of a distribution, because that is its own headline.
  const restingIndex = (): number => layout === "bar"
    ? points.reduce((best, point, current) =>
      (point.values[0]?.value ?? 0) > (points[best]?.values[0]?.value ?? 0) ? current : best, 0)
    : points.length - 1;
  const rest = (): void => { paint(restingIndex(), true); };

  const nearest = (clientX: number): number => {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) { return 0; }
    const x = ((clientX - rect.left) / rect.width) * box.width;
    let best = 0;
    let distance = Number.POSITIVE_INFINITY;
    positions.forEach((position, index) => {
      const own = Math.abs(position - x);
      if (own < distance) { distance = own; best = index; }
    });
    return best;
  };

  if (scrubber !== null) {
    const step = (event: Event): void => {
      locked = -1;
      paint(Math.max(0, Math.min(points.length - 1, Number((event.target as HTMLInputElement).value))));
    };
    scrubber.addEventListener("input", step);
    scrubber.addEventListener("change", step);
  }

  shell.addEventListener("pointermove", (event: PointerEvent) => {
    if (locked >= 0) { return; }
    paint(nearest(event.clientX));
  });
  shell.addEventListener("pointerdown", (event: PointerEvent) => {
    const index = nearest(event.clientX);
    if (event.pointerType !== "touch" && event.pointerType !== "pen") { paint(index); return; }
    if (locked === index) { locked = -1; rest(); return; }
    locked = index;
    paint(index);
  });
  shell.addEventListener("pointerleave", () => { if (locked < 0) { rest(); } });
  shell.setAttribute("tabindex", "0");
  shell.addEventListener("keydown", (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) { return; }
    event.preventDefault();
    locked = -1;
    paint(Math.min(points.length - 1, Math.max(0, (active < 0 ? restingIndex() : active) + step)));
  });
  rest();
}

/** The range slider the source puts under every interactive chart. */
function buildScrubber(
  shell: HTMLElement,
  readout: HTMLElement,
  count: number,
  positions: readonly number[],
  width: number,
): HTMLInputElement | null {
  const owner = shell.ownerDocument;
  const parent = readout.parentElement;
  if (parent === null || count < 2 || typeof owner.createElement !== "function") { return null; }
  const wrap = owner.createElement("div");
  wrap.className = "tournament-report__scrubber-wrap";
  const input = owner.createElement("input");
  input.type = "range";
  input.className = "tournament-report__scrubber";
  input.min = "0";
  input.max = `${count - 1}`;
  input.step = "1";
  input.value = `${count - 1}`;
  input.setAttribute("aria-label", readout.getAttribute("data-scrubber-label") ?? "");
  // Properties, never a style attribute: production refuses inline style.
  const left = (positions[0] ?? 0) / width;
  const right = (positions[count - 1] ?? width) / width;
  input.style.marginInlineStart = `${Math.max(0, left * 100)}%`;
  input.style.width = `${Math.max(1, (right - left) * 100)}%`;
  wrap.append(input);
  parent.insertBefore(wrap, readout);
  return input;
}

/**
 * The cup and the track behind a readout line. The picture sits beside the name it is a picture of,
 * so it is decorative and carries no alt of its own (§16): repeating the track's name there made a
 * screen reader read it twice, and axe reported 70 redundant alts on one published night.
 */
const pictureHtml = (icons: readonly Readonly<{ src: string; alt: string }>[] | undefined): string =>
  (icons ?? []).map((icon) =>
    `<img class="tournament-report__readout-icon" src="${escape(icon.src)}" alt="" title="${escape(icon.alt)}" aria-hidden="true" loading="lazy" decoding="async">`).join("");

const readoutRow = (value: ChartPointValue): string => {
  const lines = (value.lines ?? []).map((line, index) => ({ line, pictures: value.pictures?.[index] })).filter((entry) => entry.line.trim().length > 0);
  return `<tr><th scope="row">${keySwatch(value.color)}${escape(value.label)}</th>` +
    `<td>${escape(value.display)}${lines.length === 0 ? "" : `<span class="tournament-report__readout-lines">${lines.map((entry) => `<span class="tournament-report__readout-line">${pictureHtml(entry.pictures)}${escape(entry.line)}</span>`).join("")}</span>`}</td></tr>`;
};

/**
 * One readout, in the shape its chart asks for. The source runtime switches on
 * the same four modes, and each says something the others cannot: a place chart
 * names the track it was driven on, the benchmark names the Player being
 * chased, and the distribution names the tracks behind the bar.
 */
export function readoutHtml(point: ChartPoint, emptyLabel: string, resting = false): string {
  const head = `<p class="tournament-report__readout-head${resting ? " tournament-report__readout-head--resting" : ""}">` +
    `<strong>${escape(point.head.race)}</strong>` +
    (point.head.label.length === 0 ? "" : `<span>${escape(point.head.label)}</span>`) + "</p>";
  if (point.values.length === 0) {
    return `${head}<table class="tournament-report__readout-table"><tbody>` +
      `<tr><td class="tournament-report__readout-empty" colspan="2">${escape(emptyLabel)}</td></tr></tbody></table>`;
  }
  const rows = point.mode === "place-track"
    ? point.values.map((value) => {
      const lines = (value.lines ?? []).filter((line) => line.trim().length > 0);
      const [track, ...extra] = lines;
      const icons = pictureHtml(value.icons);
      // One line: the place, then the cup and track pictures beside the track's name, then what
      // the race scored; it wraps only where the width runs out (owner, 2026-09-28).
      return `<tr><td class="tournament-report__readout-place">${escape(value.display)}</td>` +
        `<td class="tournament-report__readout-track"><span class="tournament-report__readout-line">${icons}${escape(track ?? "-")}</span>` +
        extra.map((line) => `<span class="tournament-report__readout-extra">${escape(line)}</span>`).join("") + "</td></tr>";
    }).join("")
    : point.mode === "benchmark"
      ? point.values.map((value) => {
        const pack = value.pack;
        if (pack === undefined) { return readoutRow(value); }
        const sign = pack.delta > 0 ? "+" : "";
        return `<tr><th scope="row">${keySwatch(value.color)}${escape(value.label)}</th>` +
          `<td><span class="tournament-report__benchmark">` +
          `<span class="tournament-report__benchmark-delta">${escape(`${sign}${pack.delta}`)}</span>` +
          `<span class="tournament-report__benchmark-unit">${escape(pack.unit)}</span>` +
          `<span class="tournament-report__benchmark-name">${escape(pack.displayName.length === 0 ? "-" : pack.displayName)}</span>` +
          `<span class="tournament-report__benchmark-score">${pack.playerTotal}</span>` +
          `<span class="tournament-report__benchmark-vs">vs</span>` +
          `<span class="tournament-report__benchmark-score">${pack.benchmarkTotal}</span>` +
          `</span></td></tr>`;
      }).join("")
      : point.values.map(readoutRow).join("");
  const variant = point.mode === "place-track" ? " tournament-report__readout-table--place"
    : point.mode === "benchmark" ? " tournament-report__readout-table--benchmark"
      : point.mode === "delta" ? " tournament-report__readout-table--delta"
        : " tournament-report__readout-table--compact";
  return `${head}<table class="tournament-report__readout-table${variant}"><tbody>${rows}</tbody></table>`;
}
