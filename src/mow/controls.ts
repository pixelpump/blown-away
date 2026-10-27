import type { InputFrame } from '../core/input';

/** How far a finger must travel (CSS px) to count as a swipe. */
const SWIPE = 18;

const KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
};

/**
 * Swipe controls. Each swipe requests a direction; keep the finger down and
 * change direction to chain turns in one gesture. Arrow keys / WASD on desktop.
 */
export class SwipeControls {
  private enabled = false;
  private pointer?: { id: number; x: number; y: number };
  private pending?: [number, number];
  private held?: [number, number];

  constructor(private readonly layer: HTMLElement) {
    layer.addEventListener('pointerdown', this.onDown);
    layer.addEventListener('pointermove', this.onMove);
    layer.addEventListener('pointerup', this.onUp);
    layer.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.layer.classList.toggle('ba-active', on);
    if (!on) {
      this.pointer = this.pending = this.held = undefined;
    }
  }

  /** One frame of input: a fresh swipe (once), else a held key, else nothing. */
  sample(): InputFrame {
    const d = this.pending ?? this.held;
    this.pending = undefined;
    return d ? { mx: d[0] * 127, my: d[1] * 127, ax: 0, ay: 0 } : { mx: 0, my: 0, ax: 0, ay: 0 };
  }

  destroy(): void {
    this.layer.removeEventListener('pointerdown', this.onDown);
    this.layer.removeEventListener('pointermove', this.onMove);
    this.layer.removeEventListener('pointerup', this.onUp);
    this.layer.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.enabled || this.pointer) return;
    e.preventDefault();
    this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try {
      this.layer.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
  };

  private onMove = (e: PointerEvent): void => {
    const p = this.pointer;
    if (!p || p.id !== e.pointerId) return;
    e.preventDefault();
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (Math.hypot(dx, dy) < SWIPE) return;
    const d: [number, number] = Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
    this.pending = d;
    this.flash(e.clientX, e.clientY, d);
    // Re-anchor so the same finger can swipe again without lifting.
    p.x = e.clientX;
    p.y = e.clientY;
  };

  private onUp = (e: PointerEvent): void => {
    if (this.pointer?.id === e.pointerId) this.pointer = undefined;
  };

  private onKey = (e: KeyboardEvent): void => {
    const d = KEYS[e.code];
    if (!this.enabled || !d) return;
    e.preventDefault();
    if (e.type === 'keydown') this.held = d;
    else if (this.held === d) this.held = undefined;
  };

  /** Brief arrow under the finger so a swipe visibly "took". */
  private flash(x: number, y: number, d: [number, number]): void {
    const r = this.layer.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'mw-swipe';
    el.textContent = '➜';
    const deg = d[0] === 1 ? 0 : d[0] === -1 ? 180 : d[1] === 1 ? 90 : -90;
    el.style.left = `${x - r.left}px`;
    el.style.top = `${y - r.top}px`;
    el.style.setProperty('--rot', `${deg}deg`);
    this.layer.appendChild(el);
    setTimeout(() => el.remove(), 400);
  }
}
