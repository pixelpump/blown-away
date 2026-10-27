import treeUrl from '../render/sprites/shrub.png';
import '../ui/styles.css';
import './plot.css';
import { checkBoard, daily, EMPTY, generate, MARK, TREE, type Puzzle } from './puzzle';

export interface PlotResult {
  /** YYYY-MM-DD for the daily puzzle; undefined for practice. */
  dailyKey?: string;
  number?: number;
  size: number;
  timeMs: number;
  /** Tree column per row, so the server can check it. */
  answer: number[];
}

export interface PlotOptions {
  /** Makes the daily puzzle unique to a company (e.g. its id). */
  salt?: string;
  /** Override "today" (testing). */
  date?: Date;
  onFinish?(result: PlotResult): void;
  onExit?(): void;
}

/** One distinct colour per garden bed, light enough for dark marks on top. */
const BED_COLOURS = ['#a9d672', '#f2d46b', '#f0a77f', '#e9a1c0', '#b9a5e2', '#95c6ec', '#86d4c1', '#dcc49f', '#e8e3d3'];
const BED_NAMES = ['clover', 'sunflower', 'terracotta', 'rose', 'lavender', 'forget-me-not', 'mint', 'mulch', 'gravel'];

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
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
const solvedKey = (key: string) => `garden-plot:solved:${key}`;

/** Example shown with the rules: a 4×4 plot, solved. */
const EXAMPLE = { size: 4, beds: [0, 0, 1, 1, 0, 2, 2, 1, 3, 2, 2, 1, 3, 3, 2, 2], trees: [1, 7, 8, 14] };

export function mountPlot(el: HTMLElement, opts: PlotOptions = {}): { destroy(): void } {
  const today = daily(opts.date ?? new Date(), opts.salt);

  const root = document.createElement('div');
  root.className = 'ba-root gp-root';
  root.innerHTML = `
    <div class="ba-screen" data-screen="menu"></div>
    <div class="gp-game" hidden>
      <div class="gp-bar">
        <button class="ba-icon-btn" data-act="menu" aria-label="Back to menu">←</button>
        <div class="gp-label"></div>
        <div class="gp-time" aria-label="Time">0:00</div>
      </div>
      <div class="gp-status" aria-live="polite"></div>
      <div class="gp-board-wrap">
        <div class="gp-board" role="grid"></div>
        <button class="gp-paused" data-act="resume" hidden>Paused · tap to keep going</button>
      </div>
      <div class="gp-tools">
        <button class="ba-btn ba-btn-secondary" data-act="undo">Undo</button>
        <button class="ba-btn ba-btn-secondary" data-act="clear">Clear</button>
      </div>
      <p class="gp-rule">One tree in every row, column and colour. Trees can't touch, not even corners.<br>Tap once for ×, twice for a tree. Drag to mark several.</p>
    </div>
    <div class="ba-screen" data-screen="results" hidden></div>
  `;
  el.appendChild(root);
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const menu = $('[data-screen="menu"]');
  const results = $('[data-screen="results"]');
  const game = $('.gp-game');
  const boardEl = $('.gp-board');
  const labelEl = $('.gp-label');
  const timeEl = $('.gp-time');
  const statusEl = $('.gp-status');
  const pausedEl = $<HTMLButtonElement>('.gp-paused');
  const show = (which: 'menu' | 'game' | 'results') => {
    menu.hidden = which !== 'menu';
    game.hidden = which !== 'game';
    results.hidden = which !== 'results';
  };

  // --- state ----------------------------------------------------------------
  let puzzle: Puzzle | undefined;
  let isDaily = false;
  let board: Uint8Array = new Uint8Array(0);
  let cells: HTMLElement[] = [];
  let undo: Uint8Array[] = [];
  let elapsed = 0;
  let runningSince = 0;
  let running = false;
  let done = false;
  let timer = 0;

  const now = () => elapsed + (running ? performance.now() - runningSince : 0);
  const startClock = () => {
    if (running || done) return;
    running = true;
    runningSince = performance.now();
  };
  const stopClock = () => {
    if (!running) return;
    elapsed += performance.now() - runningSince;
    running = false;
  };

  // --- menu -------------------------------------------------------------------
  function streak(): number {
    let n = 0;
    const d = opts.date ? new Date(opts.date) : new Date();
    if (!store.get(solvedKey(today.key))) d.setDate(d.getDate() - 1); // today not done yet: count up to yesterday
    for (;;) {
      if (!store.get(solvedKey(daily(d, opts.salt).key))) return n;
      n++;
      d.setDate(d.getDate() - 1);
    }
  }

  function exampleHtml(): string {
    const { size, beds, trees } = EXAMPLE;
    return `<div class="gp-board gp-example" style="--n:${size}" aria-label="Example: a solved 4 by 4 plot">${beds
      .map((b, i) => `<div class="gp-cell${trees.includes(i) ? ' gp-tree' : ''}" style="--bed:${BED_COLOURS[b]};${borders(i, size, beds)}">${trees.includes(i) ? `<img class="gp-t" src="${treeUrl}" alt="">` : ''}</div>`)
      .join('')}</div>`;
  }

  function renderMenu() {
    const best = store.get(solvedKey(today.key));
    const s = streak();
    menu.innerHTML = `
      <div>
        <div class="ba-kicker">Daily puzzle #${today.number} · ${today.weekday}</div>
        <h1 class="ba-title">Garden<br><span>Plot</span></h1>
      </div>
      <div class="ba-card gp-rules">
        ${exampleHtml()}
        <div>
          <p class="ba-desc">Plant <strong>one tree</strong> in every row, every column and every colour.</p>
          <p class="ba-desc">Trees <strong>can't touch</strong>, not even at the corners.</p>
        </div>
      </div>
      ${
        best
          ? `<div class="ba-best">Today: solved in <strong>${fmt(Number(best))}</strong>. New puzzle tomorrow.${s > 1 ? ` <br>${s}-day streak 🌱` : ''}</div>`
          : `<div class="ba-best">Today's plot: <strong>${today.options.size}×${today.options.size}</strong>. Easier early in the week, bigger by the weekend.${s > 0 ? `<br>${s}-day streak 🌱` : ''}</div>`
      }
      <button class="ba-btn" data-act="daily">${best ? 'Play today again' : "Play today's puzzle"}</button>
      <button class="ba-btn ba-btn-secondary" data-act="practice">Practice puzzle</button>
      <div class="ba-foot">
        <span>Passengers only 🚫🚗</span>
        ${opts.onExit ? '<button class="ba-link" data-act="exit">Exit</button>' : '<span></span>'}
      </div>
    `;
  }

  // --- board ------------------------------------------------------------------
  function borders(i: number, size: number, beds: ArrayLike<number>): string {
    const r = Math.floor(i / size);
    const c = i % size;
    const thick = '2.5px solid var(--gp-line)';
    const thin = '1px solid var(--gp-thin)';
    const top = r === 0 ? 'none' : beds[i] !== beds[i - size] ? thick : thin;
    const left = c === 0 ? 'none' : beds[i] !== beds[i - 1] ? thick : thin;
    return `border-top:${top};border-left:${left}`;
  }

  function start(p: Puzzle, daily: boolean) {
    puzzle = p;
    isDaily = daily;
    board = new Uint8Array(p.size * p.size);
    undo = [];
    elapsed = 0;
    done = false;
    labelEl.textContent = daily ? `#${today.number} · ${today.weekday}` : `Practice · ${p.size}×${p.size}`;
    boardEl.style.setProperty('--n', String(p.size));
    boardEl.innerHTML = [...p.beds]
      .map(
        (b, i) =>
          `<div class="gp-cell" role="gridcell" data-i="${i}" aria-label="Row ${Math.floor(i / p.size) + 1}, column ${(i % p.size) + 1}, ${BED_NAMES[b]} bed" style="--bed:${BED_COLOURS[b]};${borders(i, p.size, p.beds)}"><span class="gp-x" aria-hidden="true">×</span><img class="gp-t" src="${treeUrl}" alt=""></div>`,
      )
      .join('');
    cells = [...boardEl.querySelectorAll<HTMLElement>('.gp-cell')];
    pausedEl.hidden = true;
    boardEl.classList.remove('gp-hidden');
    show('game');
    render();
    startClock();
    clearInterval(timer);
    timer = window.setInterval(() => (timeEl.textContent = fmt(now())), 250);
    timeEl.textContent = '0:00';
  }

  function render(fresh?: number) {
    const p = puzzle!;
    const check = checkBoard(p, board);
    cells.forEach((cell, i) => {
      cell.classList.toggle('gp-mark', board[i] === MARK);
      cell.classList.toggle('gp-tree', board[i] === TREE);
      cell.classList.toggle('gp-bad', check.conflicts.has(i));
      if (i === fresh && board[i] === TREE) {
        cell.classList.remove('gp-pop');
        void cell.offsetWidth;
        cell.classList.add('gp-pop');
      }
    });
    statusEl.textContent = check.conflicts.size
      ? 'Some trees break the rules (shown striped).'
      : `${check.trees} of ${p.size} trees planted`;
    statusEl.classList.toggle('gp-warn', check.conflicts.size > 0);
    if (check.solved) win();
  }

  function snapshot() {
    undo.push(board.slice());
    if (undo.length > 200) undo.shift();
  }

  // Tap cycles empty → × → tree → empty. Dragging paints × on empty cells
  // (or rubs × out, if the drag started on a ×). Trees are never dragged over.
  let drag: { start: number; last: number; mode: 'mark' | 'erase' | null; moved: boolean; id: number } | undefined;
  const cellAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.gp-cell');
    return el && boardEl.contains(el) ? Number(el.dataset.i) : -1;
  };
  const paint = (i: number) => {
    if (drag!.mode === 'mark' && board[i] === EMPTY) board[i] = MARK;
    else if (drag!.mode === 'erase' && board[i] === MARK) board[i] = EMPTY;
  };
  boardEl.addEventListener('pointerdown', (e) => {
    if (done || !running) return;
    const i = cellAt(e.clientX, e.clientY);
    if (i < 0) return;
    e.preventDefault();
    drag = { start: i, last: i, mode: board[i] === EMPTY ? 'mark' : board[i] === MARK ? 'erase' : null, moved: false, id: e.pointerId };
    try {
      boardEl.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
  });
  boardEl.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const i = cellAt(e.clientX, e.clientY);
    if (i < 0 || i === drag.last) return;
    if (!drag.moved) {
      drag.moved = true;
      snapshot();
      paint(drag.start);
    }
    drag.last = i;
    paint(i);
    render();
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || drag.id !== e.pointerId) return;
    if (!drag.moved && e.type === 'pointerup') {
      const i = drag.start;
      snapshot();
      board[i] = board[i] === EMPTY ? MARK : board[i] === MARK ? TREE : EMPTY;
      render(i);
    }
    drag = undefined;
  };
  boardEl.addEventListener('pointerup', endDrag);
  boardEl.addEventListener('pointercancel', endDrag);

  function win() {
    if (done) return;
    done = true;
    stopClock();
    clearInterval(timer);
    const p = puzzle!;
    const timeMs = Math.round(elapsed);
    timeEl.textContent = fmt(timeMs);
    // Trees bounce one after another, row by row.
    p.solution.forEach((c, r) => {
      const cell = cells[r * p.size + c];
      cell.style.animationDelay = `${r * 70}ms`;
      cell.classList.remove('gp-pop');
      void cell.offsetWidth;
      cell.classList.add('gp-pop', 'gp-won');
    });
    boardEl.classList.add('gp-solved');
    statusEl.textContent = 'Planted!';

    let firstToday = false;
    if (isDaily && !store.get(solvedKey(today.key))) {
      store.set(solvedKey(today.key), String(timeMs));
      firstToday = true;
    }
    const answer = [...p.solution];
    opts.onFinish?.({ dailyKey: isDaily ? today.key : undefined, number: isDaily ? today.number : undefined, size: p.size, timeMs, answer });

    const s = streak();
    results.innerHTML = `
      <div class="ba-kicker">${isDaily ? `Garden Plot #${today.number} · ${p.size}×${p.size}` : `Practice · ${p.size}×${p.size}`}</div>
      <h1 class="ba-title">Planted<span>!</span></h1>
      <div class="ba-result-time">${fmt(timeMs)}</div>
      <div class="ba-best">${
        isDaily
          ? firstToday
            ? `That's today's time.${s > 1 ? ` ${s}-day streak 🌱` : ''}`
            : `Replays don't change today's time (<strong>${fmt(Number(store.get(solvedKey(today.key))))}</strong>).`
          : 'Practice puzzles are just for fun.'
      }</div>
      <button class="ba-btn" data-act="practice">Practice puzzle</button>
      <button class="ba-btn ba-btn-secondary" data-act="menu">Menu</button>
    `;
    setTimeout(() => show('results'), 1400);
  }

  function pause() {
    if (!running || done) return;
    stopClock();
    boardEl.classList.add('gp-hidden'); // no peeking while the clock is stopped
    pausedEl.hidden = false;
  }

  root.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest('button');
    switch (t?.dataset.act) {
      case 'daily':
        start(generate(today.seed, today.options), true);
        break;
      case 'practice':
        start(generate((Math.random() * 2 ** 32) >>> 0, { size: 8, maxLevel: 3, minLevel: 2 }), false);
        break;
      case 'undo':
        if (!done && running && undo.length) {
          board = undo.pop()!;
          render();
        }
        break;
      case 'clear':
        if (!done && running && board.some((v) => v !== EMPTY)) {
          snapshot();
          board.fill(EMPTY);
          render();
        }
        break;
      case 'resume':
        pausedEl.hidden = true;
        boardEl.classList.remove('gp-hidden');
        startClock();
        break;
      case 'menu':
        stopClock();
        clearInterval(timer);
        renderMenu();
        show('menu');
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

  if (import.meta.env.DEV) (window as unknown as { __plot: unknown }).__plot = { get puzzle() { return puzzle; } };

  renderMenu();
  show('menu');

  return {
    destroy() {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      root.remove();
    },
  };
}
