import Phaser from 'phaser';
import { Sim, WEATHER_PRESETS, type EncodedInputs, type Level, type Mode, type Weather, type WeatherPreset } from '../core';
import { BlowerAudio } from '../render/audio';
import { GameScene } from '../render/GameScene';
import { loadLevels } from '../render/levels';
import { Controls } from '../ui/controls';
import '../ui/styles.css';

export interface FinishedRun {
  levelId: string;
  mode: Mode;
  weather: Weather;
  seed: number;
  ticks: number;
  timeMs: number;
  /** Recorded input. Send this to the server so it can replay and verify the time. */
  inputs: EncodedInputs;
}

export interface MountOptions {
  levelId?: string;
  /** Fix the mode (e.g. the daily challenge). Omit to let the player choose. */
  mode?: Mode;
  /** Fix the weather (e.g. today's real weather). Omit to let the player choose. */
  weather?: WeatherPreset | Weather;
  /** Leaf layout and gust seed. Same seed → same yard for everyone. */
  seed?: number;
  /** Heading shown above the title, e.g. "Today's challenge". */
  kicker?: string;
  onFinish?(run: FinishedRun): void;
  /** If set, the menu shows an Exit button. */
  onExit?(): void;
}

export interface GameHandle {
  destroy(): void;
}

const MODE_INFO: Record<Mode, { label: string; desc: string }> = {
  clear: { label: 'Clear It', desc: 'Blow every leaf out to the street.' },
  pile: { label: 'Pile It', desc: 'Blow every leaf onto the tarp.' },
};
const WEATHER_INFO: Record<WeatherPreset, { label: string; desc: string }> = {
  dry: { label: 'Dry', desc: 'Light, dry leaves. A good day.' },
  rain: { label: 'Rain', desc: 'Wet leaves are heavy and stick to the grass.' },
  wind: { label: 'Wind', desc: 'Gusts will undo your work. Stay ahead of them.' },
};

function formatTime(ms: number, decimals: 1 | 2 = 2): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(decimals);
  return m > 0 ? `${m}:${rest.padStart(decimals + 3, '0')}` : rest;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode etc. */
    }
  },
};

/** Mount the game into `el` (which should have a size, e.g. full screen). */
export function mountGame(el: HTMLElement, opts: MountOptions = {}): GameHandle {
  const assets = loadLevels();
  const asset = assets.find((a) => a.level.id === opts.levelId) ?? assets[0];
  if (!asset) throw new Error('Blown Away: no levels found');
  const level: Level = asset.level;
  const seed = opts.seed ?? 1;

  let mode: Mode = opts.mode ?? (storage.get('blown-away:mode') as Mode) ?? level.modes[0];
  if (!level.modes.includes(mode)) mode = level.modes[0];
  let weatherPreset: WeatherPreset = (storage.get('blown-away:weather') as WeatherPreset) ?? 'dry';
  if (!(weatherPreset in WEATHER_PRESETS)) weatherPreset = 'dry';
  const fixedWeather = typeof opts.weather === 'object' ? opts.weather : opts.weather ? WEATHER_PRESETS[opts.weather] : undefined;
  const currentWeather = (): Weather => fixedWeather ?? WEATHER_PRESETS[weatherPreset];
  const weatherKey = () => (opts.weather ? (typeof opts.weather === 'string' ? opts.weather : 'custom') : weatherPreset);
  const bestKey = () => `blown-away:best:${level.id}:${mode}:${weatherKey()}:${seed}`;

  // --- DOM ----------------------------------------------------------------
  const root = document.createElement('div');
  root.className = 'ba-root';
  root.innerHTML = `
    <div class="ba-hud" hidden>
      <button class="ba-icon-btn" data-act="pause" aria-label="Pause">❚❚</button>
      <div class="ba-time">0.0</div>
      <div class="ba-progress">
        <div class="ba-progress-label">— leaves left</div>
        <div class="ba-bar"><div></div></div>
      </div>
      <div class="ba-wind" aria-hidden="true">➜</div>
    </div>
    <div class="ba-stage"></div>
    <div class="ba-touch"><div class="ba-hint">Drag to walk · pull back to back up<br>2nd thumb aims</div></div>
    <div class="ba-screen" data-screen="menu"></div>
    <div class="ba-screen" data-screen="pause" hidden>
      <div class="ba-kicker">Paused</div>
      <h1 class="ba-title">Taking<br><span>five</span></h1>
      <button class="ba-btn" data-act="resume">Resume</button>
      <div class="ba-row">
        <button class="ba-btn ba-btn-secondary" data-act="restart">Restart</button>
        <button class="ba-btn ba-btn-secondary" data-act="menu">Menu</button>
      </div>
    </div>
    <div class="ba-screen" data-screen="results" hidden></div>
  `;
  el.appendChild(root);

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const hud = $('.ba-hud');
  const timeEl = $('.ba-time');
  const leftEl = $('.ba-progress-label');
  const barEl = $<HTMLDivElement>('.ba-bar > div');
  const windEl = $('.ba-wind');
  const hint = $('.ba-hint');
  const screens = {
    menu: $('[data-screen="menu"]'),
    pause: $('[data-screen="pause"]'),
    results: $('[data-screen="results"]'),
  };
  const show = (name: keyof typeof screens | null) => {
    for (const [k, s] of Object.entries(screens)) s.hidden = k !== name;
  };

  // --- Engine -------------------------------------------------------------
  const controls = new Controls($('.ba-touch'));
  const audio = new BlowerAudio();
  audio.muted = storage.get('blown-away:muted') === '1';

  const scene = new GameScene(assets);
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
  if (import.meta.env.DEV) (window as unknown as { __blownAway: unknown }).__blownAway = { scene, game };

  let playing = false;
  let lastShownTenths = -1;
  let lastDone = -1;

  scene.hooks = {
    onFrame(sim) {
      const tenths = Math.floor(sim.timeMs / 100);
      if (tenths !== lastShownTenths) {
        lastShownTenths = tenths;
        timeEl.textContent = formatTime(sim.timeMs, 1);
      }
      if (sim.done !== lastDone) {
        lastDone = sim.done;
        const left = Math.max(0, sim.target - sim.done);
        leftEl.textContent = `${left} leaves to go`;
        barEl.style.width = `${Math.min(100, (sim.done / sim.target) * 100)}%`;
      }
      hint.hidden = sim.started;
      const w = Math.hypot(sim.windX, sim.windY);
      windEl.style.opacity = String(Math.min(1, 0.2 + w / 60));
      windEl.style.transform = `rotate(${Math.atan2(sim.windY, sim.windX)}rad) scale(${1 + sim.gust * 0.4})`;
      audio.set(sim.started && !sim.finished ? 1 : 0.3, sim.playerMoving);
    },
    onFinish(sim) {
      finish(sim);
    },
  };

  // --- Flow ---------------------------------------------------------------
  function renderMenu() {
    const best = storage.get(bestKey());
    const modeButtons = level.modes
      .map((m) => `<button data-mode="${m}" aria-pressed="${m === mode}">${MODE_INFO[m].label}</button>`)
      .join('');
    const weatherButtons = (Object.keys(WEATHER_INFO) as WeatherPreset[])
      .map((w) => `<button data-weather="${w}" aria-pressed="${w === weatherPreset}">${WEATHER_INFO[w].label}</button>`)
      .join('');
    screens.menu.innerHTML = `
      <div>
        <div class="ba-kicker">${esc(opts.kicker ?? level.name)}</div>
        <h1 class="ba-title">Blown<br><span>Away</span></h1>
      </div>
      ${
        opts.mode
          ? ''
          : `<div class="ba-card"><div class="ba-seg">${modeButtons}</div><p class="ba-desc">${MODE_INFO[mode].desc}</p></div>`
      }
      ${
        fixedWeather
          ? ''
          : `<div class="ba-card"><div class="ba-seg">${weatherButtons}</div><p class="ba-desc">${WEATHER_INFO[weatherPreset].desc}</p></div>`
      }
      <div class="ba-best">${best ? `Your best: <strong>${formatTime(Number(best))}</strong>` : 'No time set yet.'}</div>
      <button class="ba-btn" data-act="play">Play</button>
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
    const sim = new Sim(level, { mode, weather: currentWeather(), seed });
    scene.startRun(sim);
    lastShownTenths = lastDone = -1;
    timeEl.textContent = formatTime(0, 1);
    hud.hidden = false;
    hint.hidden = false;
    show(null);
    controls.setEnabled(true);
    playing = true;
  }

  function finish(sim: Sim) {
    playing = false;
    controls.setEnabled(false);
    audio.set(0, false);
    audio.chime();

    const prev = Number(storage.get(bestKey()) ?? Infinity);
    const isBest = sim.timeMs < prev;
    if (isBest) storage.set(bestKey(), String(sim.timeMs));
    const par = level.par[mode];
    const secs = sim.timeMs / 1000;
    const stars = !par ? 0 : secs <= par ? 3 : secs <= par * 1.3 ? 2 : 1;

    screens.results.innerHTML = `
      <div class="ba-kicker">${esc(level.name)} · ${MODE_INFO[mode].label}</div>
      <div class="ba-badge" ${isBest ? '' : 'hidden'}>New personal best</div>
      <div class="ba-result-time">${formatTime(sim.timeMs)}</div>
      ${par ? `<div class="ba-stars" aria-label="${stars} of 3 stars">${[1, 2, 3].map((n) => `<span class="${n <= stars ? 'on' : ''}">★</span>`).join('')}</div>` : ''}
      <div class="ba-best">
        ${isBest && Number.isFinite(prev) ? `Previous best: <strong>${formatTime(prev)}</strong>` : ''}
        ${!isBest ? `Your best: <strong>${formatTime(prev)}</strong>` : ''}
        ${par ? `<br>3 stars under ${formatTime(par * 1000, 1)}` : ''}
      </div>
      <button class="ba-btn" data-act="restart">Go again</button>
      <button class="ba-btn ba-btn-secondary" data-act="menu">Menu</button>
    `;
    // Let the last leaves drift before covering the yard.
    setTimeout(() => show('results'), 700);

    opts.onFinish?.({
      levelId: level.id,
      mode,
      weather: currentWeather(),
      seed,
      ticks: sim.ticks,
      timeMs: sim.timeMs,
      inputs: sim.inputs.slice(),
    });
  }

  function pause() {
    if (!playing) return;
    scene.paused = true;
    controls.setEnabled(false);
    audio.set(0, false);
    show('pause');
  }

  function toMenu() {
    playing = false;
    scene.paused = true;
    controls.setEnabled(false);
    audio.set(0, false);
    hud.hidden = true;
    renderMenu();
    preview();
    show('menu');
  }

  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('button');
    if (!t) return;
    if (t.dataset.mode) {
      mode = t.dataset.mode as Mode;
      storage.set('blown-away:mode', mode);
      renderMenu();
      preview();
    } else if (t.dataset.weather) {
      weatherPreset = t.dataset.weather as WeatherPreset;
      storage.set('blown-away:weather', weatherPreset);
      renderMenu();
      preview();
    }
    switch (t.dataset.act) {
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
        storage.set('blown-away:muted', audio.muted ? '1' : '0');
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

  // Show the yard (with the right goal for the mode) behind the menu.
  let sceneReady = false;
  function preview() {
    if (!sceneReady) return;
    scene.startRun(new Sim(level, { mode, weather: currentWeather(), seed }));
    scene.paused = true;
  }
  void scene.ready.then(() => {
    sceneReady = true;
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
