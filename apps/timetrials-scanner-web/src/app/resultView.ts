// Resultaatscherm: port van MainActivity.buildDesignResultPanel + specs-
// overlay + verificatieweergave (frame + cut-outs) + geschiedenis.
import { t, vocabTag, currentCode } from '../engine/i18n';
import type { IdentitySnapshot, IdentitySnapshotEntry, ScanResult } from '../engine/types';
import type { History } from './history';

const KINDS: ['character' | 'kart' | 'wheel' | 'glider', string, string][] = [['character', 'Character', 'var(--tile-char)'], ['kart', 'Body', 'var(--tile-body)'], ['wheel', 'Tire', 'var(--tile-tire)'], ['glider', 'Glider', 'var(--tile-glider)']];
const STATS_ALL_LABELS = ['Spd Ground', 'Spd Water', 'Spd Air', 'Spd A-grav', 'Hdl Ground', 'Hdl Water', 'Hdl Air', 'Hdl A-grav', 'Accel', 'Mini-Turbo', 'Weight', 'Traction'];
const STATS_ALL_IDX = [0, 1, 3, 2, 6, 7, 9, 8, 4, 11, 5, 10];
const PART_COLORS = ['var(--tile-char)', 'var(--tile-body)', 'var(--tile-tire)', 'var(--tile-glider)'];

interface Callbacks {
  rescan: () => void;
  assetUrl: (ref: string) => string;
  /** Aanwezig wanneer de scanner vanuit de MK8DX-webapplicatie geopend is. */
  saveToEcosystem?: (result: ScanResult) => void;
  ecosystemLabel?: () => string;
}

let packCache: any = null;
let namesCache: any = null;

async function loadPack(): Promise<void> {
  if (!packCache) packCache = await fetch(`${import.meta.env.BASE_URL}assets/clean_assets/pack.json`).then((r) => r.json());
  if (!namesCache) namesCache = await fetch(`${import.meta.env.BASE_URL}assets/kart_config/names.json`).then((r) => r.json());
}

function timeToMs(value: string | undefined): number | null {
  if (!value || !/^\d:\d\d\.\d\d\d$/.test(value)) return null;
  return parseInt(value[0], 10) * 60000 + parseInt(value.substring(2, 4), 10) * 1000 + parseInt(value.substring(5, 8), 10);
}

function fmtDelta(ms: number): string {
  const a = Math.abs(ms);
  return `${ms < 0 ? '-' : '+'}${Math.floor(a / 60000)}:${String(Math.floor((a % 60000) / 1000)).padStart(2, '0')}.${String(a % 1000).padStart(3, '0')}`;
}

export class ResultView {
  private readonly root: HTMLDivElement;
  private last: ScanResult | null = null;
  private statsMine: number[] | null = null;
  private statsTheirs: number[] | null = null;
  private partsMine: number[][] | null = null;
  private partsTheirs: number[][] | null = null;

  constructor(private readonly stage: HTMLElement, private readonly history: History, private readonly cb: Callbacks) {
    this.root = document.createElement('div');
    this.root.className = 'result';
    stage.append(this.root);
  }

  hide(): void {
    this.root.classList.remove('visible');
    this.root.innerHTML = '';
  }

  async render(result: ScanResult, animate: boolean): Promise<void> {
    this.last = result;
    await loadPack();
    const identity = structuredClone(result.identity);
    this.localizeNames(identity);
    const fields = result.fields;
    const playerTotal = timeToMs(fields.player_total);
    const ghostTotal = timeToMs(fields.ghost_total);
    const delta = playerTotal !== null && ghostTotal !== null && playerTotal !== ghostTotal ? playerTotal - ghostTotal : null;
    const win = delta !== null && delta < 0;
    const you = identity.player ?? null;
    const ghost = identity.ghost ?? null;
    const ghostCardName = ghost?.card_name ?? '';

    const inner = document.createElement('div');
    inner.className = `inner${animate ? ' enter' : ''}`;
    const header = document.createElement('div');
    header.className = 'header';
    header.innerHTML = `<span class="caps">Time Trial · MK8DX</span><span class="sp"></span>${win ? `<span class="pill">● ${t('new_best').toUpperCase()}</span>` : ''}`;
    inner.append(header);
    const columns = document.createElement('div');
    columns.className = 'columns';
    // ---- links
    const left = document.createElement('div');
    left.className = 'left';
    const hero = document.createElement('div');
    hero.className = 'panel hero';
    hero.innerHTML = `<div class="caps ${delta === null ? '' : win ? 'win' : 'loss'}">${delta === null ? 'Result' : win ? t('won_by') : t('lost_by')}</div><div class="delta ${delta === null ? '' : win ? 'win' : 'loss'}">${delta === null ? '—' : fmtDelta(delta)}</div>`;
    left.append(hero);
    const tiles = document.createElement('div');
    tiles.className = 'tiles';
    tiles.append(this.ownerTile('YOU', fields.player_total, you, win), this.ownerTile(ghostCardName || 'GHOST', fields.ghost_total, ghost, delta !== null && delta > 0));
    left.append(tiles);
    left.append(this.lapTable(fields));
    columns.append(left);
    // ---- rechts: YOU | ghostnaam | build stats
    const right = document.createElement('div');
    right.className = 'panel';
    const setup = document.createElement('div');
    setup.className = 'setup';
    const colYou = document.createElement('div');
    colYou.className = 'col';
    const colGhost = document.createElement('div');
    colGhost.className = 'col';
    KINDS.forEach(([kind, label, accent], i) => {
      colYou.append(this.setupTile(i === 0 ? 'YOU' : label, i === 0 ? 'you' : '', you?.[kind] ?? null, accent, 'var(--yellow)'));
      colGhost.append(this.setupTile(i === 0 ? (ghostCardName || 'GHOST') : label, i === 0 ? 'ghost' : '', ghost?.[kind] ?? null, accent, 'var(--text)'));
    });
    const colStats = document.createElement('div');
    colStats.className = 'col';
    this.partsMine = this.partStatsFor(you);
    this.partsTheirs = this.partStatsFor(ghost);
    this.statsMine = sumStats(this.partsMine);
    this.statsTheirs = sumStats(this.partsTheirs);
    const statsBlock = this.buildStatsCompare(this.statsMine, this.statsTheirs);
    if (statsBlock) colStats.append(statsBlock);
    if (this.statsMine && this.statsTheirs && this.statsMine.length >= 12 && this.statsTheirs.length >= 12) {
      const entry = document.createElement('div');
      entry.className = 'specs-entry';
      // Styles through CSSOM, never a style attribute: the scanner CSP has no 'unsafe-inline' (#34).
      entry.innerHTML = `<span>📊</span><div class="t"><b>${t('detail_specs')}</b><span>${t('detail_sub')}</span></div><span>›</span>`;
      const [icon, chevron] = [entry.firstElementChild as HTMLElement, entry.lastElementChild as HTMLElement];
      icon.style.color = 'var(--green)';
      chevron.style.color = 'var(--text-dim)';
      chevron.style.fontWeight = '700';
      entry.addEventListener('click', () => this.showSpecs());
      colStats.append(entry);
    }
    setup.append(colYou, colGhost, colStats);
    right.append(setup);
    columns.append(right);
    inner.append(columns);
    // ---- footer: geschiedenis + Frame + controle-status
    const footer = document.createElement('div');
    footer.className = 'footer-row';
    const hist = document.createElement('span');
    hist.className = 'btn';
    hist.textContent = '🕘';
    hist.addEventListener('click', () => void this.showHistory());
    const verify = document.createElement('span');
    verify.className = 'btn';
    verify.textContent = '🖼 Frame';
    verify.addEventListener('click', () => this.showVerify());
    const note = document.createElement('span');
    note.className = 'note';
    const accept = result.acceptPath ?? '';
    note.textContent = accept.startsWith('direct_lap_som') || accept.startsWith('bevestigd') ? t('checked_sum') : t('captured');
    footer.append(hist, verify, note);
    // Terug naar het circuit waar de scan begon. De knop staat er alleen als de
    // webapplicatie de scanner geopend heeft; hij slaat niets op, hij geeft het
    // gelezen resultaat door aan het invoerformulier dat er wel over gaat.
    if (this.cb.saveToEcosystem) {
      const save = document.createElement('span');
      save.className = 'btn save-mk8dx';
      save.textContent = this.cb.ecosystemLabel ? this.cb.ecosystemLabel() : '✔ MK8DX';
      save.addEventListener('click', () => this.cb.saveToEcosystem!(result));
      footer.append(save);
    }
    inner.append(footer);
    this.root.innerHTML = '';
    this.root.append(inner);
    this.root.classList.add('visible');
  }

  private localizeNames(identity: IdentitySnapshot): void {
    if (currentCode() === 'nl') return;
    const tag = vocabTag();
    const vocab = packCache?.vocab;
    for (const ow of Object.values(identity)) {
      if (!ow) continue;
      for (const [kind, group] of [['character', 'characters'], ['kart', 'bodies'], ['glider', 'gliders']] as const) {
        const e = (ow as any)[kind] as IdentitySnapshotEntry | undefined;
        const table = vocab?.[group];
        if (!e || !table) continue;
        const name = table[`${e.id}#${tag}`];
        if (name) e.name = name;
      }
      for (const [kind, tab] of [['wheel', 'tire'], ['flag', 'mk8_flags']] as const) {
        const e = (ow as any)[kind] as IdentitySnapshotEntry | undefined;
        if (!e) continue;
        const row = namesCache?.[tab]?.[String(e.index)];
        if (row?.uk) e.name = row.uk;
      }
    }
  }

  private ownerTile(label: string, total: string | undefined, owner: IdentitySnapshot[string] | null, winner: boolean): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'panel owner-tile';
    const flag = owner?.flag;
    tile.innerHTML = `<div class="head">${flag?.asset_ref ? `<img src="${this.cb.assetUrl(flag.asset_ref)}" alt="">` : ''}<span>${escapeHtml(label)}</span></div><div class="total ${winner ? 'win' : label === 'YOU' ? '' : 'dim'}">${total ?? '—'}</div>`;
    return tile;
  }

  private lapTable(fields: Record<string, string>): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'panel';
    const table = document.createElement('table');
    table.className = 'laps';
    table.innerHTML = `<tr><th>${t('lap').toUpperCase()}</th><th class="you">YOU</th><th class="ghost">GHOST</th><th class="delta">Δ</th></tr>`;
    const marks = ['①', '②', '③', '④', '⑤', '⑥', '⑦'];
    for (let lap = 1; lap <= 7; lap++) {
      const mine = fields[`player_lap_${lap}`];
      const theirs = fields[`ghost_lap_${lap}`];
      if (mine === undefined && theirs === undefined) continue;
      const pm = timeToMs(mine);
      const gm = timeToMs(theirs);
      const mineFaster = pm !== null && gm !== null && pm < gm;
      const ghostFaster = pm !== null && gm !== null && gm < pm;
      let deltaHtml = '<td class="delta none">·</td>';
      if (pm !== null && gm !== null && pm !== gm) deltaHtml = `<td class="delta ${pm - gm < 0 ? 'neg' : 'pos'}">${fmtDelta(pm - gm)}</td>`;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="mark">${marks[lap - 1]}</td><td class="you ${mineFaster ? 'b' : ''}">${mine ?? '—'}</td><td class="ghost ${ghostFaster ? 'b' : ''}">${theirs ?? '—'}</td>${deltaHtml}`;
      table.append(tr);
    }
    panel.append(table);
    return panel;
  }

  private setupTile(kindLabel: string, kindClass: string, entry: IdentitySnapshotEntry | null, accent: string, nameColor: string): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'setup-tile';
    const ok = !!entry?.ok;
    const name = entry ? `${entry.name || '?'}${ok ? '' : ' ?'}` : '—';
    tile.innerHTML = `<div class="kind ${kindClass}">${escapeHtml(kindLabel)}</div><div class="box">${entry?.asset_ref ? `<img src="${this.cb.assetUrl(entry.asset_ref)}" alt="">` : ''}</div><div class="name ${entry && !ok ? 'unsure' : ''}">${escapeHtml(name)}</div>`;
    (tile.querySelector('.box') as HTMLElement).style.borderColor = accent;
    if (!(entry && !ok)) (tile.querySelector('.name') as HTMLElement).style.color = nameColor;
    // An uncertain shared choice names its next candidates, so the reviewer
    // sees what else the icon could be before correcting it on the entry form.
    if (entry && !ok && entry.alternatives?.length) {
      const alternatives = document.createElement('div');
      alternatives.className = 'alternatives';
      alternatives.textContent = entry.alternatives.map((item) => item.name).join(' · ');
      tile.append(alternatives);
    }
    return tile;
  }

  private partStatsFor(owner: IdentitySnapshot[string] | null): number[][] | null {
    if (!owner) return null;
    const stats = packCache?.stats;
    if (!stats) return null;
    const parts: (number[] | null)[] = [null, null, null, null];
    const map: [('character' | 'kart' | 'glider'), string, number][] = [['character', 'characters', 0], ['kart', 'bodies', 1], ['glider', 'gliders', 3]];
    for (const [kind, group, slot] of map) {
      const e = (owner as any)[kind] as IdentitySnapshotEntry | undefined;
      if (!e) return null;
      let id = e.id;
      if (!id) {
        const names = packCache.groups[group].names;
        id = Object.keys(names).find((k) => names[k] === (e.name || '').replace(' ?', '')) ?? '';
      }
      const row = stats[group]?.[id];
      if (!row) return null;
      parts[slot] = row;
    }
    const wheel = owner.wheel;
    const tire = wheel && wheel.index >= 0 ? stats.tires_by_index?.[String(wheel.index)] : null;
    if (!tire) return null;
    parts[2] = tire;
    return parts as number[][];
  }

  private buildStatsCompare(mine: number[] | null, theirs: number[] | null): HTMLElement | null {
    if (!mine && !theirs) return null;
    const block = document.createElement('div');
    block.className = 'stats';
    block.innerHTML = `<div class="caps">${t('build_stats')}</div>`;
    (block.firstElementChild as HTMLElement).style.fontSize = '8px';
    STATS_ALL_LABELS.forEach((label, s) => {
      const idx = STATS_ALL_IDX[s];
      const haveBoth = !!(mine && theirs && mine.length > idx && theirs.length > idx);
      const mineHigher = haveBoth && mine![idx] > theirs![idx] + 1e-9;
      const theirsHigher = haveBoth && theirs![idx] > mine![idx] + 1e-9;
      let deltaText = '—';
      let deltaClass = '';
      if (haveBoth) {
        const diff = mine![idx] - theirs![idx];
        if (Math.abs(diff) < 1e-6) deltaText = '=0.00';
        else {
          deltaText = (diff > 0 ? '+' : '') + diff.toFixed(2);
          deltaClass = diff > 0 ? 'pos' : 'neg';
        }
      }
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span class="n">${label}</span><span class="v mine">${mine && mine.length > idx ? mine[idx].toFixed(2) : '—'}</span><span class="v theirs">${theirs && theirs.length > idx ? theirs[idx].toFixed(2) : '—'}</span><span class="d ${deltaClass}">${deltaText}</span>`;
      (row.querySelector('.v.mine') as HTMLElement).style.fontWeight = !theirsHigher ? '700' : '400';
      (row.querySelector('.v.theirs') as HTMLElement).style.fontWeight = theirsHigher || (!mineHigher && haveBoth) ? '700' : '400';
      block.append(row);
    });
    return block;
  }

  private showSpecs(): void {
    if (!this.statsMine || !this.statsTheirs) return;
    const inner = document.createElement('div');
    inner.className = 'inner specs';
    const header = document.createElement('div');
    header.className = 'header';
    const back = document.createElement('span');
    back.className = 'back';
    back.textContent = `‹  ${t('back')}`;
    back.addEventListener('click', () => this.last && void this.render(this.last, false));
    header.append(back, Object.assign(document.createElement('b'), { textContent: t('detail_specs') }));
    inner.append(header);
    const groups = document.createElement('div');
    groups.className = 'groups';
    const defs: [string, [string, number][]][] = [
      [t('speed'), [['Ground', 0], ['Water', 1], ['Air', 3], ['Anti-grav', 2]]],
      [t('handling'), [['Ground', 6], ['Water', 7], ['Air', 9], ['Anti-grav', 8]]],
      [t('other'), [['Acceleration', 4], ['Mini-Turbo', 11], ['Weight', 5], ['Traction', 10]]],
    ];
    for (const [name, rows] of defs) {
      const panel = document.createElement('div');
      panel.className = 'panel';
      panel.innerHTML = `<div class="caps g">${name}</div>`;
      for (const [label, idx] of rows) {
        const stat = document.createElement('div');
        stat.className = 'stat';
        const mineTotal = this.statsMine.length > idx ? this.statsMine[idx] : -1;
        const ghostTotal = this.statsTheirs.length > idx ? this.statsTheirs[idx] : -1;
        stat.innerHTML = `<div class="n">${label}</div>`;
        stat.append(this.specsBarRow(this.partsMine, idx, mineTotal, false), this.specsBarRow(this.partsTheirs, idx, ghostTotal, true));
        if (mineTotal >= 0 && ghostTotal >= 0) {
          const diff = mineTotal - ghostTotal;
          const chip = document.createElement('div');
          chip.className = 'dchip';
          chip.style.color = Math.abs(diff) < 1e-6 ? 'var(--text-dim)' : diff > 0 ? 'var(--green)' : 'var(--red)';
          chip.textContent = Math.abs(diff) < 1e-6 ? '=0.00' : (diff > 0 ? '+' : '') + diff.toFixed(2);
          stat.append(chip);
        }
        panel.append(stat);
      }
      groups.append(panel);
    }
    inner.append(groups);
    const legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML = ['Character', 'Body', 'Tire', 'Glider'].map((n) => `<i></i>${n}`).join('') + `<span class="note">${t('legend_note')}</span>`;
    legend.querySelectorAll<HTMLElement>('i').forEach((swatch, i) => { swatch.style.background = PART_COLORS[i]; });
    inner.append(legend);
    this.root.innerHTML = '';
    this.root.append(inner);
  }

  private specsBarRow(parts: number[][] | null, idx: number, total: number, dim: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = `brow ${dim ? 'dim' : ''}`;
    row.innerHTML = `<div class="bar"></div><span class="v">${total < 0 ? '—' : total.toFixed(2)}</span>`;
    const bar = row.firstElementChild as HTMLElement;
    if (parts) {
      const sum = 6;
      parts.forEach((p, i) => {
        const v = p && p.length > idx ? Math.max(0, p[idx]) : 0;
        if (v <= 0) return;
        const seg = document.createElement('i');
        seg.style.width = `${(v / sum) * 100}%`;
        seg.style.background = PART_COLORS[i];
        bar.append(seg);
      });
    }
    return row;
  }

  private showVerify(): void {
    const result = this.last;
    if (!result) return;
    const inner = document.createElement('div');
    inner.className = 'inner verify';
    const header = document.createElement('div');
    header.className = 'header';
    const back = document.createElement('span');
    back.className = 'back';
    back.textContent = '‹  Result';
    back.addEventListener('click', () => void this.render(result, false));
    header.append(back, Object.assign(document.createElement('b'), { textContent: 'Frame + cut-outs' }));
    inner.append(header);
    const body = document.createElement('div');
    body.className = 'body';
    const frame = document.createElement('img');
    frame.className = 'frame';
    if (result.lockFrameJpeg) frame.src = result.lockFrameJpeg;
    body.append(frame);
    const right = document.createElement('div');
    for (const [owner, ow] of Object.entries(result.identity)) {
      if (!ow) continue;
      const caps = document.createElement('div');
      caps.className = 'caps';
      caps.style.fontSize = '9px';
      caps.textContent = owner === 'player' ? t('you') : (ow.card_name || t('ghost'));
      right.append(caps);
      const row = document.createElement('div');
      for (const kind of ['character', 'kart', 'wheel', 'glider', 'flag'] as const) {
        const e = ow[kind];
        if (!e) continue;
        const pair = document.createElement('div');
        pair.className = 'pair';
        if (e.crop_png) pair.append(Object.assign(document.createElement('img'), { src: e.crop_png }));
        if (e.asset_ref) pair.append(Object.assign(document.createElement('img'), { src: this.cb.assetUrl(e.asset_ref) }));
        row.append(pair);
      }
      right.append(row);
    }
    // tijd-veld-crops uit het lock-frame
    const lockFrame = result.frames[result.lockedFrameIndex] ?? null;
    if (lockFrame) {
      for (const owner of ['player', 'ghost']) {
        let headerDone = false;
        for (const key of [`${owner}_total`, ...[1, 2, 3, 4, 5, 6, 7].map((i) => `${owner}_lap_${i}`)]) {
          const value = result.fields[key];
          const detail = lockFrame.fieldDetails.find((f) => f.field_name === key);
          if (!value || !detail?.crop_png) continue;
          if (!headerDone) {
            const caps = document.createElement('div');
            caps.className = 'caps';
            caps.style.fontSize = '9px';
            caps.style.padding = '6px 0 2px';
            caps.textContent = `${owner === 'player' ? t('you') : t('ghost')} · ${t('lap').toLowerCase()}s`;
            right.append(caps);
            headerDone = true;
          }
          const row = document.createElement('div');
          row.className = 'frow';
          row.innerHTML = `<img src="${detail.crop_png}" alt=""><span class="v ${key.endsWith('_total') ? 'total' : ''}">${value}</span>`;
          right.append(row);
        }
      }
    }
    body.append(right);
    inner.append(body);
    this.root.innerHTML = '';
    this.root.append(inner);
  }

  private async showHistory(): Promise<void> {
    const entries = await this.history.list();
    const inner = document.createElement('div');
    inner.className = 'inner history';
    const header = document.createElement('div');
    header.className = 'header';
    const back = document.createElement('span');
    back.className = 'back';
    back.textContent = '‹  Result';
    back.addEventListener('click', () => this.last && void this.render(this.last, false));
    header.append(back, Object.assign(document.createElement('b'), { textContent: '🕘 Scans' }));
    inner.append(header);
    for (const e of entries.slice(0, 20)) {
      const item = document.createElement('div');
      item.className = 'item';
      const when = new Date(e.timestamp).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      item.innerHTML = `<img src="${e.frameJpeg}" alt=""><span class="line">${e.result.fields.player_total ?? e.result.fields.ghost_total ?? '—'}   ·   ${when}</span>`;
      item.addEventListener('click', () => void this.render({ ...e.result, lockFrameJpeg: e.frameJpeg }, false));
      inner.append(item);
    }
    this.root.innerHTML = '';
    this.root.append(inner);
  }
}

function sumStats(parts: number[][] | null): number[] | null {
  if (!parts) return null;
  let len = parts[0].length;
  for (const p of parts) len = Math.min(len, p.length);
  const sum = new Array(len).fill(0);
  for (const p of parts) for (let i = 0; i < len; i++) sum[i] += p[i];
  return sum;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
