// Product-UI van de browser-scanner: port van de MainActivity-scanflow
// (richtgids -> SCAN -> burst -> freeze -> analyse met Rainbow Road-paneel ->
// Finish -> resultaatscherm) op camera + galerij; STOP annuleert echt.
import { EngineClient, defaultEngineConfig } from './engineClient';
import type { EngineConfig, EngineStatus } from '../engine/engine';
import { LANG_CODES, LANG_NAMES, currentCode, defaultCode, setLanguage, t, vocabTag } from '../engine/i18n';
import { SCAN_BURST_FRAMES, SCAN_BURST_GAP_MS } from '../engine/scanner';
import { canonicalLandscape } from '../engine/imageio';
import type { Frame, FrameResult, IdentitySnapshot, LayoutProfile, ProgressEvent, ScanResult } from '../engine/types';
import { drawGuide } from './guide';
import { ResultView } from './resultView';
import { History } from './history';
import {
  buildEcosystemHandoff,
  idTableFromFieldIndex,
  readEcosystemHandoffRequest,
  returnToEcosystem,
  type EcosystemHandoffRequest,
  type EcosystemIdTable,
} from './ecosystem';

type ScanState = 'idle' | 'bursting' | 'analyzing' | 'locked' | 'reposition';

const prefs = {
  get(key: string, def: string): string {
    try {
      return localStorage.getItem(`mk8_prefs.${key}`) ?? def;
    } catch {
      return def;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(`mk8_prefs.${key}`, value);
    } catch {
      /* private mode */
    }
  },
};

class App {
  private readonly root = document.getElementById('app')!;
  private stage!: HTMLDivElement;
  private video!: HTMLVideoElement;
  private frozen!: HTMLImageElement;
  private overlay!: HTMLCanvasElement;
  private status!: HTMLDivElement;
  private hint!: HTMLDivElement;
  private progressPanel!: HTMLDivElement;
  private progressPhase!: HTMLSpanElement;
  private progressPct!: HTMLSpanElement;
  private progressAttempt!: HTMLDivElement;
  private progressFill!: HTMLDivElement;
  private progressHead!: HTMLDivElement;
  private cycleTiles: HTMLDivElement[] = [];
  private cycleTime!: HTMLDivElement;
  private scanButton!: HTMLButtonElement;
  private lapsButton!: HTMLButtonElement;
  private layoutButton!: HTMLButtonElement;
  private zoomButton!: HTMLButtonElement;
  private demoButton!: HTMLButtonElement;
  private fileInput!: HTMLInputElement;
  private setup!: HTMLDivElement;
  private stallFallbackDone = false;
  private engineRecovered = false;
  /** debug-log (tijdstip + melding) voor 'kopieer debug' na een hang of fout */
  private debugLog: string[] = [];
  private debugT0 = performance.now();
  private modal!: HTMLDivElement;
  private resultView!: ResultView;
  private readonly history = new History();

  private client = new EngineClient();
  private engineStatus: EngineStatus | null = null;
  private engineReady = false;
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private cameraReady = false;
  private layout: LayoutProfile = 'endscreen';
  private guideLapMode: 3 | 7 = 3;
  /** A controlling SW means its versioned precache completed on an earlier visit. */
  private readonly usingOfflineCache = 'serviceWorker' in navigator &&
    navigator.serviceWorker.controller !== null;
  private zoomIndex = 0;
  private readonly zoomSteps = [1.0, 1.5, 2.0, 2.5, 3.0];
  private zoomApplying = false;
  /** Extra centre crop when the camera has no (or insufficient) optical/hardware zoom. */
  private digitalZoom = 1.0;
  private state: ScanState = 'idle';
  private scanSeq = 0;
  private progressValue = 0; // 0..1000
  private progressAnim: number | null = null;
  private cyclePools: string[][] = [];
  private headPool: string[] = [];
  private cycleTimer: number | null = null;
  private demoIndex = 0;
  private devVisible = false;
  private lastResult: ScanResult | null = null;
  private lastFrozenUrl = '';

  async start(): Promise<void> {
    setLanguage(prefs.get('app_lang', defaultCode()));
    this.layout = prefs.get('scan_layout', 'endscreen') === 'ghost_detail' ? 'ghost_detail' : 'endscreen';
    this.buildUi();
    this.setStatus(`MK8 | ${t('loading_engine')}`);
    this.client.onStatus = (m) => {
      this.dbg(`init: ${m}`);
      this.setStatus(`MK8 | ${t('loading_engine')} ${m}`);
      const st = this.setup.querySelector('.step') as HTMLElement | null;
      if (st) st.textContent = m;
    };
    this.client.onProgress = (p) => this.setupProgress(p);
    this.client.onError = (m) => this.dbg(`worker: ${m}`);
    this.client.onLog = (m) => this.dbg(`worker: ${m}`);
    // iOS: pagina naar de achtergrond (fotokiezer, app-wissel) kan workers raken — vastleggen in de debug-log
    document.addEventListener('visibilitychange', () => this.dbg(`pagina: ${document.visibilityState}`));
    window.addEventListener('pagehide', () => this.dbg('pagina: pagehide'));
    document.addEventListener('freeze', () => this.dbg('pagina: freeze'));
    document.addEventListener('resume', () => this.dbg('pagina: resume'));
    this.setControlsEnabled(false);
    void this.openCamera();
    try {
      const provider = new URLSearchParams(location.search).get('provider') === 'webgpu' ? 'webgpu' : 'wasm';
      this.engineStatus = await this.client.init(this.engineConfig(provider));
      this.engineReady = true;
      this.setupProgress({ stage: 'ready', fraction: 1, loaded: 0, total: 0 });
      this.setup.classList.add('done');
      this.setControlsEnabled(true);
      this.updateStatusIdle();
    } catch (exc) {
      const msg = (exc instanceof Error ? exc.message : String(exc)) + (/out of memory/i.test(String(exc instanceof Error ? exc.message : exc)) ? ' — sluit dit tabblad en open de scanner opnieuw (iOS geeft wasm-geheugen bij herladen niet vrij)' : '');
      this.setStatus(`MK8 | engine error: ${msg}`);
      this.dbg(`init FOUT: ${msg}`);
      const st = this.setup.querySelector('.step') as HTMLElement | null;
      if (st) st.textContent = `!! ${msg}`;
      this.setup.classList.add('error');
    }
    void this.loadCyclePools();
    this.registerServiceWorker();
    window.addEventListener('resize', () => this.updateStatusIdle());
  }

  // ------------------------------------------------------------------ UI-opbouw
  private buildUi(): void {
    this.root.innerHTML = '';
    this.stage = el('div', 'stage');
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.frozen = document.createElement('img');
    this.frozen.className = 'frozen';
    this.overlay = document.createElement('canvas');
    this.overlay.className = 'overlay';
    this.status = el('div', 'status');
    this.hint = el('div', 'hint');
    this.progressPanel = this.buildProgressPanel();
    this.stage.append(this.video, this.frozen, this.overlay, this.status, this.hint, this.progressPanel);
    // Vanuit de MK8DX-webapplicatie geopend: dan hoort er een terugweg te zijn.
    this.ecosystem = readEcosystemHandoffRequest(window.location.search);
    // Catalog IDs for tyre and flag positions (ADR-0215), from the staged pack's field index.
    if (this.ecosystem) {
      const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
      void fetch(`${base}shared-icon/field-index.json`).then((response) => (response.ok ? response.json() : null))
        .then((index) => { this.ecosystemIds = idTableFromFieldIndex(index); })
        .catch(() => { this.ecosystemIds = null; });
    }
    // De bron koos de speler al in de taak (ScanSourcePicker, ADR-0206); hier niet nog eens vragen.
    if (this.ecosystem?.layout) this.layout = this.ecosystem.layout;
    if (this.ecosystem) this.guideLapMode = this.ecosystem.lapCount;
    this.resultView = new ResultView(this.stage, this.history, {
      ...(this.ecosystem
        ? {
            saveToEcosystem: (result: ScanResult) => this.handOverToEcosystem(result),
            ecosystemLabel: () => `\u2714 ${t('save_mk8dx')}`,
          }
        : {}),
      rescan: () => this.onScanButton(),
      assetUrl: (ref) => assetUrl(ref),
    });
    this.modal = el('div', 'modal');
    this.stage.append(this.modal);
    // eerste-keer-setup: laadbalk met % en MB zolang de engine nog niet klaar is
    this.setup = el('div', 'firstrun');
    this.setup.innerHTML = '<div class="box"><h3></h3><div class="note"></div><div class="bar"><div class="fill"></div></div><div class="line"><span class="pct">0%</span><span class="mb"></span></div><div class="step"></div></div>';
    this.setupText();
    this.stage.append(this.setup);
    let pressTimer: number | null = null;
    this.status.addEventListener('pointerdown', () => {
      pressTimer = window.setTimeout(() => this.toggleDev(), 700);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) this.status.addEventListener(ev, () => {
      if (pressTimer) window.clearTimeout(pressTimer);
      pressTimer = null;
    });

    const controls = el('div', 'controls');
    this.scanButton = button('📷\nSCAN', 'scan', () => this.onScanButton());
    const gallery = button('🖼\nGALLERY', '', () => void this.showGalleryChooser());
    this.zoomButton = button('🔍 1.0x', '', () => this.cycleZoom());
    this.lapsButton = button(
      this.guideLapMode === 7 ? '🏁 7 LAPS' : '🏁 3 LAPS',
      '',
      () => this.toggleLaps(),
    );
    // In de Post-a-Time-flow bepaalt de gekozen baan het aantal ronden. Houd de
    // losse scanner instelbaar, maar bied hier geen tweede, tegenstrijdige keuze.
    this.lapsButton.hidden = this.ecosystem !== null;
    this.layoutButton = button(this.layoutLabel(), '', () => this.setLayout(this.layout === 'ghost_detail' ? 'endscreen' : 'ghost_detail', true));
    const settings = button('⚙️', 'settings', () => this.showLanguageDialog());
    this.demoButton = button('🎬\nDEMO', 'hidden', () => void this.startDemoScan());
    controls.append(this.scanButton, gallery, this.zoomButton, this.lapsButton, this.layoutButton, settings, this.demoButton);
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'image/*';
    this.fileInput.style.display = 'none';
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (file) void this.startInjectedScan(file, 'GALLERY-scan');
    });
    controls.append(this.fileInput);
    this.root.append(this.stage, controls);
    this.updateScanButton();
    const redraw = () => this.drawOverlay();
    window.addEventListener('resize', redraw);
    new ResizeObserver(redraw).observe(this.stage);
    this.drawOverlay();
  }

  private buildProgressPanel(): HTMLDivElement {
    const panel = el('div', 'progress');
    const cycle = el('div', 'cycle');
    const classes = ['c', 'b', 't', 'g', ''];
    for (const cls of classes) {
      const tile = el('div', `tile ${cls}`);
      tile.append(document.createElement('img'));
      cycle.append(tile);
      this.cycleTiles.push(tile);
    }
    this.cycleTime = el('div', 'time');
    this.cycleTime.textContent = '0:00.000';
    cycle.append(this.cycleTime);
    const head = el('div', 'head');
    this.progressPhase = document.createElement('span');
    this.progressPhase.className = 'phase';
    this.progressPct = document.createElement('span');
    this.progressPct.className = 'pct';
    this.progressPct.textContent = '0%';
    const flag = document.createElement('span');
    flag.textContent = ' 🏁';
    head.append(this.progressPhase, this.progressPct, flag);
    this.progressAttempt = el('div', 'attempt');
    const bar = el('div', 'bar');
    const track = el('div', 'track');
    this.progressFill = el('div', 'fill');
    track.append(this.progressFill);
    this.progressHead = el('div', 'headicon');
    this.progressHead.innerHTML = '<span class="emoji">🏎️</span>';
    bar.append(track, this.progressHead);
    panel.append(cycle, head, this.progressAttempt, bar);
    return panel;
  }

  private setStatus(text: string): void {
    this.status.textContent = text;
  }

  /**
   * Geeft het gelezen resultaat door aan de MK8DX-webapplicatie en gaat terug
   * naar het circuit waar de scan begon. Er wordt niets opgeslagen en niets
   * verstuurd: de speler controleert en bevestigt het daar in het gewone
   * invoerformulier.
   */
  private handOverToEcosystem(result: ScanResult): void {
    const request = this.ecosystem;
    if (!request) return;
    const payload = buildEcosystemHandoff(request, result, this.ecosystemIds);
    if (!payload) {
      this.setStatus(`MK8 | ${t('save_mk8dx_none')}`);
      return;
    }
    const handed = returnToEcosystem(
      request,
      payload,
      window.sessionStorage,
      (href) => window.location.assign(href),
    );
    if (!handed) this.setStatus(`MK8 | ${t('save_mk8dx_none')}`);
  }


  private dbg(line: string): void {
    const t = ((performance.now() - this.debugT0) / 1000).toFixed(1).padStart(6);
    this.debugLog.push(`${t}s ${line}`);
    if (this.debugLog.length > 400) this.debugLog.splice(0, this.debugLog.length - 400);
    // lokaal bewaren (hooguit 1x per seconde): /audit/ neemt de laatste app-log op in het rapport
    if (this.debugSaveTimer === null) {
      this.debugSaveTimer = window.setTimeout(() => {
        this.debugSaveTimer = null;
        try { localStorage.setItem('mk8_debug_last', this.debugText()); } catch { /* opslag geblokkeerd */ }
      }, 1000);
    }
  }
  private debugSaveTimer: number | null = null;
  private ecosystem: EcosystemHandoffRequest | null = null;
  private ecosystemIds: EcosystemIdTable | null = null;

  private debugText(): string {
    const d = this.engineStatus?.detector;
    const head = [
      `MK8DX TT Scanner debug — versie ${__MK8_WEB_VERSION__} — ${new Date().toISOString()} — ${location.href}`,
      `UA ${navigator.userAgent}`,
      `isolated ${typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : '?'} cores ${navigator.hardwareConcurrency} viewport ${innerWidth}x${innerHeight}`,
      `engine ${this.engineReady ? 'klaar' : 'niet klaar'}: threads ${d?.numThreads ?? '?'} provider ${d?.actualProvider ?? '?'} model ${d?.loadMs ?? '?'} ms init ${this.engineStatus?.totalInitMs ?? '?'} ms fallback1thread=${this.stallFallbackDone} pref=${prefs.get('engine_threads', '-')}`,
      `camera ${this.cameraResolution()} zoom ${this.zoomSteps[this.zoomIndex].toFixed(1)}x (digital ${this.digitalZoom.toFixed(2)}x)`,
      `layout ${this.layout} laps ${this.guideLapMode} state ${this.state}`,
    ];
    return [...head, ...this.debugLog].join('\n');
  }

  /** na een hang/fout: knop om de debug-tekst te kopiëren (clipboard, anders selecteerbare tekst) */
  private showDebugCopy(): void {
    let btn = document.querySelector('.debug-copy') as HTMLButtonElement | null;
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'debug-copy';
      btn.textContent = '📋 kopieer debug-tekst';
      btn.addEventListener('click', async () => {
        const text = this.debugText();
        try {
          await navigator.clipboard.writeText(text);
          btn!.textContent = '✔ gekopieerd — plak in een bericht';
        } catch {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.className = 'debug-text';
          this.stage.append(ta);
          ta.focus();
          ta.select();
          btn!.textContent = 'selecteer de tekst en kopieer';
        }
      });
      this.stage.append(btn);
    }
    btn.hidden = false;
  }

  private setupText(): void {
    (this.setup.querySelector('h3') as HTMLElement).textContent =
      t(this.usingOfflineCache ? 'setup_cached_title' : 'setup_title');
    (this.setup.querySelector('.note') as HTMLElement).textContent =
      t(this.usingOfflineCache ? 'setup_cached_note' : 'setup_note');
  }

  private setupProgress(p: { stage: string; fraction: number; loaded: number; total: number }): void {
    const pct = Math.round(p.fraction * 100);
    (this.setup.querySelector('.fill') as HTMLElement).style.width = `${pct}%`;
    (this.setup.querySelector('.pct') as HTMLElement).textContent = p.stage === 'ready' ? `100% - ${t('setup_ready')}` : `${pct}%`;
    (this.setup.querySelector('.mb') as HTMLElement).textContent =
      p.total > 0 && !this.usingOfflineCache
        ? `${(p.loaded / 1048576).toFixed(0)} / ${(p.total / 1048576).toFixed(0)} MB`
        : '';
  }

  /** zolang de engine laadt zijn SCAN/GALLERY/zoom/laps/layout uit; instellingen blijven bereikbaar */
  private setControlsEnabled(on: boolean): void {
    for (const b of Array.from(document.querySelectorAll('.controls button'))) {
      const btn = b as HTMLButtonElement;
      if (btn.classList.contains('settings')) continue;
      btn.disabled = !on;
    }
  }

  private updateStatusIdle(): void {
    if (this.state !== 'idle') return;
    // Geopend vanuit de webapplicatie: zeg dat, zodat duidelijk is waar het
    // resultaat straks heen gaat.
    const forEcosystem = this.ecosystem ? ` · ${t('for_mk8dx')}` : '';
    if (this.cameraReady && this.engineReady) this.setStatus(`MK8 | ${t('aim')}${forEcosystem}${window.innerHeight > window.innerWidth ? ` · ${t('rotate_hint')}` : ''}`);
    else if (this.engineReady) this.setStatus(`MK8 | ${t('aim')} · ${this.cameraError ? t('camera_denied') : t('camera_starting')}`);
    else this.setStatus(`MK8 | ${t('loading_engine')}`);
  }

  private layoutLabel(): string {
    return this.layout === 'ghost_detail' ? '👻 GHOST' : '🎴 RESULT';
  }

  private setLayout(layout: LayoutProfile, announce: boolean): void {
    this.layout = layout;
    prefs.set('scan_layout', layout);
    this.layoutButton.textContent = this.layoutLabel();
    this.drawOverlay();
    if (announce) this.setStatus(`MK8 | ${t(layout === 'ghost_detail' ? 'layout_ghost' : 'layout_endscreen')}`);
  }

  private toggleLaps(): void {
    if (this.ecosystem) return;
    this.guideLapMode = this.guideLapMode === 3 ? 7 : 3;
    this.lapsButton.textContent = this.guideLapMode === 7 ? '🏁 7 LAPS' : '🏁 3 LAPS';
    this.drawOverlay();
    this.setStatus(`MK8 | ${t(this.guideLapMode === 7 ? 'guide7' : 'guide3')}`);
  }

  private toggleDev(): void {
    this.devVisible = !this.devVisible;
    this.demoButton.classList.toggle('hidden', !this.devVisible);
    this.setStatus(this.devVisible ? 'MK8 | diagnostics aan | long-press = verbergen' : `MK8 | ${t('aim')}`);
  }

  private showLanguageDialog(): void {
    this.modal.innerHTML = '';
    const box = el('div', 'box');
    const h = document.createElement('h3');
    h.textContent = t('language');
    box.append(h);
    LANG_CODES.forEach((code, i) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'lang';
      input.checked = code === currentCode();
      input.addEventListener('change', () => {
        prefs.set('app_lang', code);
        setLanguage(code);
        this.modal.classList.remove('visible');
        this.rebuildForLanguage();
      });
      label.append(input, ` ${LANG_NAMES[i]}`);
      box.append(label);
    });
    // diagnose (voor een screenshot bij problemen)
    const d = this.engineStatus?.detector;
    const dbgBtn = document.createElement('button');
    dbgBtn.className = 'gallery-own';
    dbgBtn.style.marginTop = '10px';
    dbgBtn.textContent = '📋 debug-tekst kopiëren';
    dbgBtn.addEventListener('click', async () => { try { await navigator.clipboard.writeText(this.debugText()); dbgBtn.textContent = '✔ gekopieerd'; } catch { this.modal.classList.remove('visible'); this.showDebugCopy(); } });
    box.append(dbgBtn);
    const auditLink = document.createElement('a');
    auditLink.href = `${import.meta.env.BASE_URL}audit/`;
    auditLink.textContent = '🔎 audit-checklist openen';
    Object.assign(auditLink.style, { display: 'block', marginTop: '8px', color: '#8ec5ff', fontSize: '13px' });
    box.append(auditLink);
    const diag = document.createElement('div');
    diag.className = 'diag';
    diag.textContent = `versie ${__MK8_WEB_VERSION__} · diagnose: threads ${d?.numThreads ?? '?'} · ${d?.actualProvider ?? '?'} · isolated ${d?.crossOriginIsolated ?? '?'} · model ${d?.loadMs ?? '?'} ms · init ${this.engineStatus?.totalInitMs ?? '?'} ms · ${navigator.userAgent.slice(0, 70)}`;
    box.append(diag);
    // De browser onderhandelt altijd de hoogste coherente resolutie van de actieve camera.
    const camH = document.createElement('h3');
    camH.textContent = 'Camera';
    camH.style.marginTop = '12px';
    box.append(camH);
    const cameraDetail = document.createElement('div');
    cameraDetail.className = 'diag';
    cameraDetail.textContent = `Automatisch maximum / Automatic maximum · ${this.cameraResolution()}`;
    box.append(cameraDetail);
    this.modal.append(box);
    this.modal.classList.add('visible');
    this.modal.onclick = (e) => {
      if (e.target === this.modal) this.modal.classList.remove('visible');
    };
  }

  private rebuildForLanguage(): void {
    // Android: recreate(); hier: labels en het resultaat (indien zichtbaar) opnieuw renderen
    this.updateStatusIdle();
    this.updateScanButton();
    if (this.state === 'locked' && this.lastResult) this.resultView.render(this.lastResult, false);
  }

  // ------------------------------------------------------------------ camera
  private cameraError = false;

  /** Camera opnieuw openen en opnieuw op zijn hoogste ondersteunde resolutie zetten. */
  private async restartCamera(): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'locked') return;
    for (const tr of this.stream?.getTracks() ?? []) tr.stop();
    this.stream = null;
    this.track = null;
    this.cameraReady = false;
    await this.openCamera();
  }

  private async openCamera(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.cameraError = true;
      this.updateStatusIdle();
      return;
    }
    try {
      // Ask high first, then use the selected track's reported maxima. `ideal` keeps unusual
      // aspect-ratio cameras usable while still choosing their largest coherent capture mode.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 7680 },
          height: { ideal: 4320 },
          frameRate: { ideal: 30 },
        },
      });
      this.track = this.stream.getVideoTracks()[0] ?? null;
      const caps: any = this.track?.getCapabilities?.() ?? {};
      const width = Number(caps.width?.max);
      const height = Number(caps.height?.max);
      if (this.track && Number.isFinite(width) && Number.isFinite(height)) {
        try {
          // Pin the largest supported width. Height stays ideal so a sensor whose independent
          // maxima are not one valid aspect-ratio mode can still choose its tallest matching mode.
          await this.track.applyConstraints({
            width: { exact: width }, height: { ideal: height }, frameRate: { ideal: 30 },
          });
        } catch (exc) {
          console.warn('camera exact maximum', exc);
          await this.track.applyConstraints({
            width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30 },
          }).catch((fallback) => console.warn('camera maximum', fallback));
        }
      }
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => undefined);
      await this.applyZoom(this.zoomSteps[this.zoomIndex], false);
      this.cameraReady = true;
      this.cameraError = false;
      const s = this.track?.getSettings();
      console.log('[camera]', JSON.stringify(s));
      this.updateStatusIdle();
      this.drawOverlay();
      try {
        // PWA: liggend vastzetten waar de browser dat toestaat
        await (screen.orientation as any)?.lock?.('landscape');
      } catch {
        /* alleen in fullscreen/PWA mogelijk */
      }
    } catch (exc) {
      this.cameraError = true;
      console.warn('camera', exc);
      this.updateStatusIdle();
    }
  }

  private async cycleZoom(): Promise<void> {
    if (this.zoomApplying || !this.engineReady || this.state === 'bursting' || this.state === 'analyzing') return;
    this.zoomApplying = true;
    this.zoomButton.disabled = true;
    this.scanButton.disabled = true;
    try {
      this.zoomIndex = (this.zoomIndex + 1) % this.zoomSteps.length;
      await this.applyZoom(this.zoomSteps[this.zoomIndex], true);
    } finally {
      this.zoomApplying = false;
      this.zoomButton.disabled = !this.engineReady;
      this.scanButton.disabled = !this.engineReady;
    }
  }

  private cameraResolution(): string {
    const settings = this.track?.getSettings?.();
    return settings?.width && settings?.height ? `${settings.width} × ${settings.height}` : '—';
  }

  private async applyZoom(requested: number, announce: boolean): Promise<void> {
    const caps: any = this.track?.getCapabilities?.() ?? {};
    const previousZoom = Number((this.track?.getSettings?.() as any)?.zoom ?? 1);
    let hardwareZoom = Number.isFinite(previousZoom) && previousZoom > 0 ? previousZoom : 1;
    if (this.track && caps.zoom && Number(caps.zoom.max) > Number(caps.zoom.min ?? 1)) {
      const min = Number(caps.zoom.min ?? 1);
      const max = Number(caps.zoom.max ?? requested);
      const step = Number(caps.zoom.step ?? 0);
      let target = Math.max(min, Math.min(requested, max));
      if (step > 0) {
        const lastStep = Math.max(0, Math.floor((max - min) / step + 1e-7));
        const requestedStep = Math.max(0, Math.floor((target - min) / step + 1e-7));
        target = min + Math.min(lastStep, requestedStep) * step;
      }
      try {
        await this.track.applyConstraints({ advanced: [{ zoom: target } as any] });
        hardwareZoom = Number((this.track.getSettings() as any).zoom ?? target);
      } catch (exc) {
        console.warn('zoom', exc);
      }
    }
    this.digitalZoom = Math.max(1, requested / Math.max(1, hardwareZoom));
    this.video.style.transform = `scale(${this.digitalZoom})`;
    this.zoomButton.textContent = `🔍 ${requested.toFixed(1)}x`;
    if (announce) {
      this.setStatus(`MK8 | zoom ${requested.toFixed(1)}x${this.digitalZoom > 1.001 ? ' · digital crop' : ''}`);
      this.dbg(`zoom ${requested.toFixed(1)}x hardware=${hardwareZoom.toFixed(2)} digital=${this.digitalZoom.toFixed(2)}`);
    }
  }

  private captureFrame(): Frame | null {
    if (!this.cameraReady || this.video.videoWidth === 0) return null;
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    if (h > w) {
      // Staande camerastream (telefoon rechtop): de richtgids staat in het gecentreerde 4:3-vak over
      // de volle breedte (guide.ts, guideRects); precies dát vak wordt het analyseframe, zoals in de
      // APK (uprightResultCrop). Het was een platte 16:9-strook met de kaarten op tweederde van de
      // breedte; het hogere vak laat de gids de breedte benutten (2026-09-17). Het volledige staande
      // beeld laat het brede scherm te klein voor de detector, en roteren zet het op zijn kant.
      const bw = w;
      const bh = Math.round((w * 3) / 4);
      const by = Math.round((h - bh) / 2);
      const sw = bw / this.digitalZoom;
      const sh = bh / this.digitalZoom;
      const sx = (w - sw) / 2;
      const sy = by + (bh - sh) / 2;
      const canvas = new OffscreenCanvas(bw, bh);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(this.video, sx, sy, sw, sh, 0, 0, bw, bh);
      const data = ctx.getImageData(0, 0, bw, bh);
      return { width: bw, height: bh, rgba: data.data };
    }
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const sw = w / this.digitalZoom;
    const sh = h / this.digitalZoom;
    ctx.drawImage(this.video, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    return canonicalLandscape({ width: w, height: h, rgba: data.data }, this.layout);
  }

  /** Bij SCAN in portret: fullscreen + landschap vergrendelen (user gesture vereist), zoals de
   *  landschap-vergrendeling van de APK. Mislukt dit (iOS/desktop), dan scant de app in portret. */
  private async ensureLandscapeForScan(): Promise<void> {
    if (window.innerHeight <= window.innerWidth) return;
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      await (screen.orientation as any)?.lock?.('landscape');
      // camerastream past zich aan de nieuwe oriëntatie aan
      const t0 = performance.now();
      while (performance.now() - t0 < 1500 && this.video.videoHeight > this.video.videoWidth) await new Promise((r) => setTimeout(r, 100));
      this.drawOverlay();
    } catch {
      /* geen fullscreen/lock mogelijk: doorgaan in portret */
    }
  }

  private drawOverlay(): void {
    const rect = this.stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.overlay.width = Math.max(1, Math.round(rect.width * dpr));
    this.overlay.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = this.overlay.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (this.state !== 'idle' && this.state !== 'reposition') return;
    // FIT_CENTER van de bron (video of 16:9) in de stage
    const srcW = this.video.videoWidth || 1280;
    const srcH = this.video.videoHeight || 720;
    const scale = Math.min(rect.width / srcW, rect.height / srcH);
    const dx = (rect.width - srcW * scale) / 2;
    const dy = (rect.height - srcH * scale) / 2;
    drawGuide(ctx, { srcW, srcH, scale, dx, dy }, this.layout, this.guideLapMode, this.devVisible);
  }

  // ------------------------------------------------------------------ scan-flow
  private updateScanButton(): void {
    this.scanButton.classList.toggle('stop', this.state === 'bursting' || this.state === 'analyzing');
    switch (this.state) {
      case 'bursting':
      case 'analyzing':
        this.scanButton.textContent = '■\nSTOP';
        break;
      case 'locked':
      case 'reposition':
        this.scanButton.textContent = '↻\nRESCAN';
        break;
      default:
        this.scanButton.textContent = '📷\nSCAN';
    }
  }

  private onScanButton(): void {
    if (this.state === 'idle' || this.state === 'reposition') {
      void this.startScan();
    } else if (this.state === 'bursting' || this.state === 'analyzing') {
      this.stopScan('scan gestopt');
    } else {
      this.resetToAiming('opnieuw');
    }
  }

  private stopScan(reason: string): void {
    this.scanSeq++; // lopende scan-uitkomst wordt genegeerd
    this.client.stop();
    this.resetToAiming(reason);
    this.setStatus(`MK8 | ${t('stopped')}`);
  }

  private resetToAiming(_reason: string): void {
    this.state = 'idle';
    this.hideProgress();
    this.resultView.hide();
    this.unfreeze();
    this.updateScanButton();
    this.updateStatusIdle();
    this.drawOverlay();
  }

  private freeze(frame: Frame): void {
    const canvas = document.createElement('canvas');
    canvas.width = frame.width;
    canvas.height = frame.height;
    canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
    this.lastFrozenUrl = canvas.toDataURL('image/jpeg', 0.85);
    this.frozen.src = this.lastFrozenUrl;
    this.stage.classList.add('frozen');
    this.drawOverlay();
  }

  private freezeUrl(url: string): void {
    this.lastFrozenUrl = url;
    this.frozen.src = url;
    this.stage.classList.add('frozen');
    this.drawOverlay();
  }

  private unfreeze(): void {
    this.stage.classList.remove('frozen');
  }

  private async startScan(): Promise<void> {
    if (!this.engineReady || this.zoomApplying) return;
    if (!this.cameraReady) {
      this.setStatus(`MK8 | ${t('camera_denied')}`);
      return;
    }
    // Geen geforceerde landschap-lock bij SCAN: het scherm draait dan terwijl het toestel rechtop blijft
    // en de camera levert het beeld 90° gedraaid. Staand = rechtop scannen.
    const seq = ++this.scanSeq;
    this.state = 'bursting';
    this.resultView.hide();
    this.updateScanButton();
    this.setStatus(`MK8 | ${t('burst')}`);
    const frames: Frame[] = [];
    let last = 0;
    while (frames.length < SCAN_BURST_FRAMES) {
      if (seq !== this.scanSeq) return;
      const now = performance.now();
      const wait = Math.max(0, SCAN_BURST_GAP_MS - (now - last));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const frame = this.captureFrame();
      last = performance.now();
      if (!frame) continue;
      frames.push(frame);
      if (frames.length === 1) this.freeze(frame); // foto-moment = eerste frame
      this.setStatus(`MK8 | BURST ${frames.length}/${SCAN_BURST_FRAMES}`);
    }
    await this.analyze(seq, frames, true, null);
  }

  private async startInjectedScan(file: Blob, label: string): Promise<void> {
    if (!this.engineReady || this.state === 'bursting' || this.state === 'analyzing') return;
    const seq = ++this.scanSeq;
    this.state = 'bursting';
    this.resultView.hide();
    this.updateScanButton();
    this.setStatus(`MK8 | ${label}`);
    const url = URL.createObjectURL(file);
    this.freezeUrl(url);
    await this.analyze(seq, null, false, file);
  }

  /** GALLERY: eigen foto óf een van de meegeleverde testafbeeldingen (assets/demo_frames van de APK). */
  private async showGalleryChooser(): Promise<void> {
    this.modal.innerHTML = '';
    const box = el('div', 'box gallery-box');
    const own = document.createElement('button');
    own.className = 'gallery-own';
    own.textContent = `📁 ${t('gallery_own')}`;
    own.addEventListener('click', () => {
      this.modal.classList.remove('visible');
      this.fileInput.click();
    });
    box.append(own);
    const h = document.createElement('div');
    h.className = 'gallery-sub';
    h.textContent = t('gallery_demo');
    box.append(h);
    const grid = el('div', 'gallery-grid');
    box.append(grid);
    this.modal.append(box);
    this.modal.classList.add('visible');
    this.modal.onclick = (e) => {
      if (e.target === this.modal) this.modal.classList.remove('visible');
    };
    try {
      // meegeleverde testbeelden (demo_web/demo_list.json): RESULT 3/7 laps uit de APK-demo's + Select-a-Ghost 3/7 laps
      const entries: { src: string; layout: LayoutProfile; laps: 3 | 7; label: string }[] = await fetch(`${import.meta.env.BASE_URL}demo_web/demo_list.json`).then((r) => r.json());
      for (const e of entries) {
        const tile = document.createElement('button');
        tile.className = 'gallery-tile';
        const img = document.createElement('img');
        img.src = `${import.meta.env.BASE_URL}${e.src}`;
        img.alt = e.label;
        const cap = document.createElement('span');
        cap.textContent = e.label;
        tile.append(img, cap);
        tile.addEventListener('click', async () => {
          this.modal.classList.remove('visible');
          // layout en rondemodus meezetten zoals de gebruiker het zelf zou doen
          if (this.layout !== e.layout) this.setLayout(e.layout, false);
          if (!this.ecosystem && this.guideLapMode !== e.laps) {
            this.guideLapMode = e.laps;
            this.lapsButton.textContent = this.guideLapMode === 7 ? '🏁 7 LAPS' : '🏁 3 LAPS';
            this.drawOverlay();
          }
          const blob = await fetch(img.src).then((r) => r.blob());
          await this.startInjectedScan(blob, `DEMO ${e.label}`);
        });
        grid.append(tile);
      }
    } catch {
      /* geen demo-lijst: alleen eigen foto */
    }
  }

  private async startDemoScan(): Promise<void> {
    const listing = await fetch(`${import.meta.env.BASE_URL}assets/listings.json`).then((r) => r.json());
    const frames: string[] = listing.demo_frames ?? [];
    if (frames.length === 0) return;
    const name = frames[this.demoIndex % frames.length];
    this.demoIndex++;
    const blob = await fetch(`${import.meta.env.BASE_URL}assets/demo_frames/${name}`).then((r) => r.blob());
    await this.startInjectedScan(blob, `DEMO ${name}`);
  }

  /** Remember the console language a locked scan read with confidence (kart name fuzzy >= 0.85): it
   *  only breaks ties in the next scans' locale vote, so a friend's console in another language
   *  still reads as that language. */
  private rememberConsoleLocale(result: ScanResult): void {
    for (const frame of result.frames ?? []) {
      const owners = (frame as { kartConfig?: { owners?: Record<string, { text_locale?: { locale: string | null; fuzzy: number } }> } })
        .kartConfig?.owners ?? {};
      for (const owner of Object.values(owners)) {
        const read = owner?.text_locale;
        if (read?.locale && read.fuzzy >= 0.85) {
          if (prefs.get('console_locale', '') !== read.locale) prefs.set('console_locale', read.locale);
          return;
        }
      }
    }
  }

  /** engine-config: threads uit ?threads=N, anders uit de voorkeur (1 na een geconstateerde hang), anders auto */
  private engineConfig(provider: 'wasm' | 'webgpu'): EngineConfig {
    const q = new URLSearchParams(location.search);
    const fromUrl = q.get('threads');
    const fromPref = prefs.get('engine_threads', '');
    const threads = fromUrl !== null ? parseInt(fromUrl, 10) : fromPref ? parseInt(fromPref, 10) : undefined;
    const cfg = defaultEngineConfig(provider, true, Number.isFinite(threads as number) ? (threads as number) : undefined);
    // The last console language read with confidence breaks ties in the locale vote (phase 3).
    const rememberedLocale = prefs.get('console_locale', '');
    if (rememberedLocale) cfg.preferredLocales = [rememberedLocale];
    if (q.get('stalltest') === '1' && !this.stallFallbackDone) cfg.debugStallFirstScan = true;
    if (q.get('losetest') === '1' && !this.engineRecovered) cfg.debugLoseEngineAfterInit = true;
    return cfg;
  }

  /** Geen voortgangsevent binnen de watchdog-tijd (eerste inferentie hangt, gezien op iOS Safari met
   *  wasm-threads): worker beëindigen, met 1 thread herstarten (voorkeur bewaard) en dezelfde invoer opnieuw scannen. */
  private async fallbackToSingleThread(seq: number, blob: Blob): Promise<boolean> {
    if (this.stallFallbackDone || (this.engineStatus?.detector?.numThreads ?? 1) <= 1) return false;
    this.stallFallbackDone = true;
    prefs.set('engine_threads', '1');
    return this.restartEngineAndRescan(seq, blob, t('stall_retry'));
  }

  /** Engine (worker) opnieuw starten en dezelfde invoer opnieuw scannen — na een hang (watchdog) of een
   *  fatale workerfout ("engine niet geïnitialiseerd", gezien op iOS Safari). Eén keer per scan. */
  private async restartEngineAndRescan(seq: number, blob: Blob, why: string): Promise<boolean> {
    this.dbg(`engine-herstart: ${why}`);
    this.setStatus(`MK8 | ${why}`);
    this.client.terminate();
    this.client = new EngineClient();
    this.client.onStatus = (m) => { this.dbg(`init: ${m}`); this.setStatus(`MK8 | ${why} · ${m}`); };
    this.client.onError = (m) => this.dbg(`worker: ${m}`);
    this.client.onLog = (m) => this.dbg(`worker: ${m}`);
    this.engineReady = false;
    try {
      this.engineStatus = await this.client.init(this.engineConfig('wasm'));
      this.engineReady = true;
    } catch (exc) {
      const m = exc instanceof Error ? exc.message : String(exc);
      this.dbg(`herstart FOUT: ${m}`);
      this.setStatus(`MK8 | engine error: ${m}${/out of memory/i.test(m) ? ' — sluit dit tabblad en open de scanner opnieuw' : ''}`);
      return false;
    }
    if (seq !== this.scanSeq) return false;
    await this.analyze(seq, null, false, blob);
    return true;
  }

  private async analyze(seq: number, frames: Frame[] | null, minimalArtifacts: boolean, blob: Blob | null): Promise<void> {
    this.state = 'analyzing';
    this.updateScanButton();
    this.setStatus('MK8 | ANALYZING 0% ...');
    this.showProgress();
    let gotProgress = false;
    const onProgress = (e: ProgressEvent) => {
      if (seq !== this.scanSeq) return;
      gotProgress = true;
      this.dbg(`scan#${seq} ${e.phase} frame ${e.attemptIndex}/${e.attemptCount} ${Math.round(e.frameProgress)}% overall ${Math.round(e.overallProgress * 100)}%${e.stage ? ' ' + e.stage : ''}`);
      this.applyProgress(e);
    };
    // watchdog: de eerste voortgang komt normaal binnen ~1-3 s (stage 00/01); 30 s zonder = hangende inferentie
    const STALL_MS = 30_000;
    const stallInput = blob ?? (this.lastFrozenUrl ? await fetch(this.lastFrozenUrl).then((r) => r.blob()).catch(() => null) : null);
    let stalled = false;
    const watchdog = window.setTimeout(() => {
      if (!gotProgress && seq === this.scanSeq && stallInput) {
        stalled = true;
        this.dbg(`scan#${seq} WATCHDOG: geen voortgang na ${STALL_MS / 1000} s (threads ${this.engineStatus?.detector?.numThreads ?? '?'})`);
        this.showDebugCopy();
        void this.fallbackToSingleThread(seq, stallInput);
      }
    }, STALL_MS);
    let result: ScanResult;
    try {
      result = frames
        ? await this.client.scan(frames, this.layout, minimalArtifacts, onProgress, undefined, { wantFieldCrops: true })
        : await this.client.scanBlob(blob!, this.layout, onProgress, undefined, { wantFieldCrops: true });
    } catch (exc) {
      window.clearTimeout(watchdog);
      if (stalled || seq !== this.scanSeq) return; // de fallback neemt het over
      const msg = exc instanceof Error ? exc.message : String(exc);
      this.dbg(`scan#${seq} FOUT: ${msg}`);
      // engine weg (worker gestopt of nooit geïnitialiseerd): één keer herstarten en opnieuw scannen
      if (/niet ge.nitialiseerd|terminated|worker onerror/i.test(msg) && stallInput && !this.engineRecovered) {
        this.engineRecovered = true;
        if (await this.restartEngineAndRescan(seq, stallInput, 'engine opnieuw gestart')) return;
      }
      this.showDebugCopy();
      this.resetToAiming('analysefout');
      this.setStatus(`MK8 | error: ${exc instanceof Error ? exc.message : exc}`);
      return;
    }
    window.clearTimeout(watchdog);
    if (stalled) return;
    if (seq !== this.scanSeq || result.stopped) return; // STOP: geen succes tonen
    this.hideProgress();
    if (result.locked) {
      this.state = 'locked';
      this.rememberConsoleLocale(result);
      result.lockFrameJpeg = this.lastFrozenUrl;
      this.lastResult = result;
      void this.history.add(result, this.lastFrozenUrl);
      // Vanuit de taak geopend: er is één formulier en één controle, en die staan daar
      // (ADR-0206). De eigen resultaatweergave is dan diagnostiek en blijft achter de
      // diagnose-schakelaar; de speler gaat meteen terug naar zijn concept.
      if (this.ecosystem && !this.devVisible) {
        this.setStatus(`MK8 | ${t('locked')}`);
        this.handOverToEcosystem(result);
        this.updateScanButton();
        return;
      }
      this.resultView.render(result, true);
      this.setStatus(`MK8 | ${t('locked')} | ${t('rescan_hint')}`);
    } else {
      this.state = 'reposition';
      this.unfreeze();
      this.setStatus(`MK8 | ${t('no_lock')}`);
      this.hint.textContent = `${t('no_lock')}\n${t('gallery_or_retry')}`;
      this.hint.classList.add('visible');
      window.setTimeout(() => this.hint.classList.remove('visible'), 4000);
      this.drawOverlay();
    }
    this.updateScanButton();
  }

  // ------------------------------------------------------------------ voortgangspaneel
  private async loadCyclePools(): Promise<void> {
    try {
      const listing = await fetch(`${import.meta.env.BASE_URL}assets/listings.json`).then((r) => r.json());
      const pack = await fetch(`${import.meta.env.BASE_URL}assets/clean_assets/pack.json`).then((r) => r.json());
      const baseOnly = (group: string): Set<string> => {
        const keep = new Set<string>();
        const ids: string[] = pack.groups[group].ids;
        ids.forEach((id, i) => {
          if (!id.includes('_variant.')) keep.add(`${i}.png`);
        });
        return keep;
      };
      const pick = (dir: string, max: number, keep: Set<string> | null): string[] => {
        const names: string[] = (listing[dir] ?? []).filter((n: string) => !keep || keep.has(n));
        shuffle(names);
        return names.slice(0, max).map((n) => `${import.meta.env.BASE_URL}assets/${dir}/${n}`);
      };
      this.cyclePools = [
        pick('clean_assets/disp/characters', 10, baseOnly('characters')),
        pick('clean_assets/disp/bodies', 10, baseOnly('bodies')),
        pick('kart_config/tire', 10, null),
        pick('clean_assets/disp/gliders', 10, baseOnly('gliders')),
        pick('kart_config/mk8_flags', 10, null),
      ];
      this.headPool = pick('clean_assets/disp/characters', 24, null);
      for (const pool of [...this.cyclePools, this.headPool]) for (const url of pool) void fetch(url); // warm de cache
    } catch (exc) {
      console.warn('cycle pools', exc);
    }
  }

  private showProgress(): void {
    if (!this.progressPanel.classList.contains('visible')) {
      this.progressPanel.classList.add('visible');
      this.progressValue = 0;
      this.setBar(0);
      this.progressAttempt.textContent = '';
      this.progressPhase.textContent = t('ph_card');
      if (this.headPool.length > 0) {
        const img = document.createElement('img');
        img.src = this.headPool[Math.floor(Math.random() * this.headPool.length)];
        this.progressHead.innerHTML = '';
        this.progressHead.append(img);
      }
      const tick = () => {
        this.cycleTiles.forEach((tile, i) => {
          const pool = this.cyclePools[i];
          if (pool && pool.length > 0) (tile.firstElementChild as HTMLImageElement).src = pool[Math.floor(Math.random() * pool.length)];
        });
        this.cycleTime.textContent = `${Math.floor(Math.random() * 3)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}.${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
        this.cycleTimer = window.setTimeout(tick, 130);
      };
      tick();
    }
  }

  private hideProgress(): void {
    if (this.progressAnim) cancelAnimationFrame(this.progressAnim);
    this.progressAnim = null;
    if (this.cycleTimer) window.clearTimeout(this.cycleTimer);
    this.cycleTimer = null;
    this.progressPanel.classList.remove('visible');
    this.progressValue = 0;
    this.setBar(0);
    this.progressAttempt.textContent = '';
  }

  private setBar(value: number): void {
    this.progressValue = value;
    const f = value / 1000;
    this.progressFill.style.width = `${Math.max(2.4, f * 100)}%`;
    const barWidth = this.progressFill.parentElement!.clientWidth || 340;
    const head = Math.max(barWidth * 0.24 * 0.5, f * barWidth);
    this.progressHead.style.left = `${Math.max(0, Math.min(barWidth - 34, head - 17))}px`;
    this.progressPct.textContent = `${Math.trunc(value / 10)}%`;
    // % kleurt rood -> groen met de voortgang mee (DS_RED -> DS_GREEN)
    this.progressPct.style.color = `rgb(${Math.round(248 + (74 - 248) * f)}, ${Math.round(113 + (222 - 113) * f)}, ${Math.round(113 + (128 - 113) * f)})`;
  }

  private animateBar(target: number, durationMs: number, accelerate: boolean): void {
    if (target <= this.progressValue && !accelerate) return;
    if (this.progressAnim) cancelAnimationFrame(this.progressAnim);
    const from = this.progressValue;
    const start = performance.now();
    const step = (now: number) => {
      const u = Math.min(1, (now - start) / durationMs);
      const e = accelerate ? u * u : 1 - (1 - u) * (1 - u);
      this.setBar(Math.round(from + (target - from) * e));
      if (u < 1) this.progressAnim = requestAnimationFrame(step);
      else this.progressAnim = null;
    };
    this.progressAnim = requestAnimationFrame(step);
  }

  private applyProgress(e: ProgressEvent): void {
    this.setStatus(`MK8 | ANALYZING ${Math.trunc(e.overallProgress * 100)}% | frame ${e.attemptIndex}/${e.attemptCount}${e.timesLocked ? ' | times locked - identifying gear' : ''}`);
    if (e.phase === 'finish') {
      this.progressPhase.textContent = t('ph_finish');
      this.animateBar(1000, 320, true);
      return;
    }
    if (e.phase === 'failed') return;
    const labelKey = { card: 'ph_card', slots: 'ph_slots', read: 'ph_read', setup: 'ph_setup', confirm: 'ph_confirm', idle: 'ph_card' }[e.phase] ?? 'ph_card';
    this.progressPhase.textContent = t(labelKey);
    this.animateBar(Math.round(1000 * e.overallProgress), 1100, false);
    if (e.attemptCount <= 0) {
      this.progressAttempt.textContent = '';
    } else if (e.identityOnly) {
      this.progressAttempt.textContent = `${e.frameProgress}%`;
    } else {
      let line = `${t('ph_attempt')} ${e.attemptIndex}/${e.attemptCount} · ${e.frameProgress}%`;
      if (e.difficultFrame) line += ` — ${t('ph_hard')}`;
      this.progressAttempt.textContent = line;
    }
  }

  private registerServiceWorker(): void {
    if (!('serviceWorker' in navigator)) return;
    // vite-plugin-pwa registreert sw.js via injectRegister:'auto' in de build; in dev is er geen SW.
    // Update-race: een nieuwe versie (skipWaiting + clientsClaim + opruimen van de oude precache) laat
    // een al open pagina met oude scriptdelen achter — die faalt dan bij de eerstvolgende scan.
    // Daarom: zodra een nieuwe SW de pagina overneemt (en er al een controller wás), één keer herladen.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      if (this.state === 'bursting' || this.state === 'analyzing') return; // niet midden in een scan
      reloaded = true;
      location.reload();
    });
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener('click', onClick);
  return b;
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export function assetUrl(ref: string): string {
  // clean_assets/refs/<g>/<i>.png -> disp/ (echte alpha), zoals MainActivity.assetImageView
  if (ref.startsWith('clean_assets/refs/')) return `${import.meta.env.BASE_URL}assets/${ref.replace('/refs/', '/disp/')}`;
  return `${import.meta.env.BASE_URL}assets/${ref}`;
}

export type { FrameResult, IdentitySnapshot, ScanResult };
export { vocabTag };

new App().start();
