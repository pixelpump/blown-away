import Phaser from 'phaser';
import type { EncodedInputs } from '../core/input';
import { BlowerAudio } from '../render/audio';
import '../ui/styles.css';
import { SwipeControls } from './controls';
import { loadMowLevels } from './levels';
import { MowScene } from './MowScene';
import { MowSim, TOY_PENALTY_S } from './sim';

export interface MowRun {
  levelId: string;
  ticks: number;
  penaltyTicks: number;
  timeMs: number;
  inputs: EncodedInputs;
}

export interface MowOptions {
  levelId?: string;
  kicker?: string;
  onFinish?(run: MowRun): void;
  onExit?(): void;
}

const fmt = (ms: number, decimals: 1 | 2 = 2) => {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(decimals);
  return m > 0 ? `${m}:${rest.padStart(decimals + 3, '0')}` : rest;
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

/** Mount the mowing game ("Stripes", working title) into `el`. */
export function mountMow(el: HTMLElement, opts: MowOptions = {}): { destroy(): void } {
  const assets = loadMowLevels();
  const asset = assets.find((a) => a.level.id === opts.levelId) ?? assets[0];
  const level = asset.level;
  const bestKey = `stripes:best:${level.id}`;

  const root = document.createElement('div');
  root.className = 'ba-root';
  root.innerHTML = `
    <div class="ba-hud" hidden>
      <button class="ba-icon-btn" data-act="pause" aria-label="Pause">❚❚</button>
      <div class="ba-time">0.0</div>
      <div class="ba-progress">
        <div class="ba-progress-label">0% mowed</div>
        <div class="ba-bar"><div></div></div>
      </div>
      <div class="mw-penalty" aria-live="polite"></div>
    </div>
    <div class="ba-stage"></div>
    <div class="ba-touch"><div class="ba-hint">Swipe to steer<br>The mower turns at the next gap</div></div>
    <div class="ba-screen" data-screen="menu"></div>
    <div class="ba-screen" data-screen="pause" hidden>
      <div class="ba-kicker">Paused</div>
      <h1 class="ba-title">Water<br><span>break</span></h1>
      <button class="ba-btn" data-act="resume">Resume</button>
      <div class="ba-row">
        <button class="ba-btn ba-btn-secondary" data-act="restart">Restart</button>
        <button class="ba-btn ba-btn-secondary" data-act="menu">Menu</button>
      </div>
    </div>
    <div class="ba-screen" data-screen="results" hidden></div>
  `;
  el.appendChild(root);
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const hud = $('.ba-hud');
  const timeEl = $('.ba-time');
  const pctEl = $('.ba-progress-label');
  const barEl = $<HTMLDivElement>('.ba-bar > div');
  const penEl = $('.mw-penalty');
  const hint = $('.ba-hint');
  const screens = { menu: $('[data-screen="menu"]'), pause: $('[data-screen="pause"]'), results: $('[data-screen="results"]') };
  const show = (name: keyof typeof screens | null) => {
    for (const [k, s] of Object.entries(screens)) s.hidden = k !== name;
  };

  const controls = new SwipeControls($('.ba-touch'));
  const audio = new BlowerAudio();
  audio.muted = store.get('blown-away:muted') === '1';

  const scene = new MowScene(assets);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: $('.ba-stage'),
    width: level.width,
    height: level.height,
    pixelArt: true,
    backgroundColor: '#2a2118',
    banner: false,
    input: false,
    audio: { noAudio: true },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
    scene: [scene],
  });
  scene.readInput = () => controls.sample();
  if (import.meta.env.DEV) (window as unknown as { __stripes: unknown }).__stripes = { scene };

  let playing = false;
  let lastTenths = -1;
  let lastPct = -1;
  scene.hooks = {
    onFrame(sim) {
      const tenths = Math.floor(sim.timeMs / 100);
      if (tenths !== lastTenths) {
        lastTenths = tenths;
        timeEl.textContent = fmt(sim.timeMs, 1);
      }
      const pct = Math.floor(sim.progress * 100);
      if (pct !== lastPct) {
        lastPct = pct;
        pctEl.textContent = `${pct}% mowed`;
        barEl.style.width = `${pct}%`;
      }
      hint.hidden = sim.started;
      // A lower, chuggier version of the blower sound for the mower.
      audio.set(sim.started && !sim.finished ? (sim.dir ? 0.9 : 0.5) : 0.3, 0.45);
    },
    onToy(sim) {
      penEl.textContent = `+${(sim.penaltyTicks / 60).toFixed(0)}s`;
      penEl.classList.remove('mw-flash');
      void penEl.offsetWidth;
      penEl.classList.add('mw-flash');
    },
    onFinish(sim) {
      finish(sim);
    },
  };

  function renderMenu() {
    const best = store.get(bestKey);
    screens.menu.innerHTML = `
      <div>
        <div class="ba-kicker">${esc(opts.kicker ?? `${level.name} · Prototype`)}</div>
        <h1 class="ba-title">Stripes</h1>
      </div>
      <div class="ba-card">
        <p class="ba-desc"><strong>Swipe</strong> to steer. The mower drives itself in straight lines and turns at the next gap, so swipe early.</p>
        <p class="ba-desc">Mow every patch of lawn. Mowing a toy costs <strong>+${TOY_PENALTY_S}s</strong>.</p>
      </div>
      <div class="ba-best">${best ? `Your best: <strong>${fmt(Number(best))}</strong>` : 'No time set yet.'}</div>
      <button class="ba-btn" data-act="play">Mow</button>
      <div class="ba-foot">
        <span>Passengers only 🚫🚗</span>
        <span>
          <button class="ba-link" data-act="mute">${audio.muted ? 'Sound off' : 'Sound on'}</button>
          ${opts.onExit ? ' · <button class="ba-link" data-act="exit">Exit</button>' : ''}
        </span>
      </div>
    `;
  }

  function startRun() {
    audio.start();
    scene.startRun(new MowSim(level));
    lastTenths = lastPct = -1;
    timeEl.textContent = fmt(0, 1);
    penEl.textContent = '';
    hud.hidden = false;
    hint.hidden = false;
    show(null);
    controls.setEnabled(true);
    playing = true;
  }

  function finish(sim: MowSim) {
    playing = false;
    controls.setEnabled(false);
    audio.set(0);
    audio.chime();
    const prev = Number(store.get(bestKey) ?? Infinity);
    const isBest = sim.timeMs < prev;
    if (isBest) store.set(bestKey, String(sim.timeMs));
    const secs = sim.timeMs / 1000;
    const par = level.par;
    const stars = !par ? 0 : secs <= par ? 3 : secs <= par * 1.3 ? 2 : 1;
    const mowMs = Math.round((sim.ticks * 1000) / 60);
    screens.results.innerHTML = `
      <div class="ba-kicker">${esc(level.name)}</div>
      <div class="ba-badge" ${isBest ? '' : 'hidden'}>New personal best</div>
      <div class="ba-result-time">${fmt(sim.timeMs)}</div>
      ${par ? `<div class="ba-stars" aria-label="${stars} of 3 stars">${[1, 2, 3].map((n) => `<span class="${n <= stars ? 'on' : ''}">★</span>`).join('')}</div>` : ''}
      <div class="ba-best">
        Mowing <strong>${fmt(mowMs, 1)}</strong>${sim.penaltyTicks ? ` + toys <strong>${fmt((sim.penaltyTicks * 1000) / 60, 1)}</strong>` : ' · no toys hit'}
        ${!isBest && Number.isFinite(prev) ? `<br>Your best: <strong>${fmt(prev)}</strong>` : ''}
        ${par ? `<br>3 stars under ${fmt(par * 1000, 1)}` : ''}
      </div>
      <button class="ba-btn" data-act="restart">Mow again</button>
      <button class="ba-btn ba-btn-secondary" data-act="menu">Menu</button>
    `;
    setTimeout(() => show('results'), 900);
    opts.onFinish?.({ levelId: level.id, ticks: sim.ticks, penaltyTicks: sim.penaltyTicks, timeMs: sim.timeMs, inputs: sim.inputs.slice() });
  }

  function pause() {
    if (!playing) return;
    scene.paused = true;
    controls.setEnabled(false);
    audio.set(0);
    show('pause');
  }

  let ready = false;
  function preview() {
    if (!ready) return;
    scene.startRun(new MowSim(level));
    scene.paused = true;
  }
  function toMenu() {
    playing = false;
    controls.setEnabled(false);
    audio.set(0);
    hud.hidden = true;
    renderMenu();
    preview();
    show('menu');
  }

  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('button');
    switch (t?.dataset.act) {
      case 'play':
      case 'restart':
        startRun();
        break;
      case 'pause':
        pause();
        break;
      case 'resume':
        show(null);
        scene.paused = false;
        controls.setEnabled(true);
        break;
      case 'menu':
        toMenu();
        break;
      case 'mute':
        audio.muted = !audio.muted;
        store.set('blown-away:muted', audio.muted ? '1' : '0');
        renderMenu();
        break;
      case 'exit':
        opts.onExit?.();
        break;
    }
  });
  const onVisibility = () => {
    if (document.hidden) pause();
  };
  document.addEventListener('visibilitychange', onVisibility);

  void scene.ready.then(() => {
    ready = true;
    preview();
  });
  renderMenu();

  return {
    destroy() {
      document.removeEventListener('visibilitychange', onVisibility);
      controls.destroy();
      audio.destroy();
      game.destroy(true);
      root.remove();
    },
  };
}
