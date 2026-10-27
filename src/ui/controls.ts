import { quantizeStick, type InputFrame } from '../core';

/** Stick travel in CSS pixels. Big on purpose: bumpy truck, maybe gloves. */
const RADIUS = 46;
const DEADZONE = 0.14;

interface Stick {
  pointerId: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
  base: HTMLElement;
  knob: HTMLElement;
}

const MOVE_KEYS: Record<string, [number, number]> = { KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] };
const AIM_KEYS: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

/**
 * Floating twin-stick touch controls.
 *   first finger anywhere  → walk (the blower points where you walk)
 *   second finger          → aim the blower independently
 * Keyboard for desktop testing: WASD walk, arrow keys aim.
 */
export class Controls {
  private enabled = false;
  private move?: Stick;
  private aim?: Stick;
  private keys = new Set<string>();

  constructor(private readonly layer: HTMLElement) {
    layer.addEventListener('pointerdown', this.onDown);
    layer.addEventListener('pointermove', this.onMove);
    layer.addEventListener('pointerup', this.onUp);
    layer.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', this.reset);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.layer.classList.toggle('ba-active', on);
    if (!on) this.reset();
  }

  sample(): InputFrame {
    let [mx, my] = this.stickVector(this.move);
    let [ax, ay] = this.stickVector(this.aim);
    if (!this.move) [mx, my] = this.keyVector(MOVE_KEYS);
    if (!this.aim) [ax, ay] = this.keyVector(AIM_KEYS);
    const [qmx, qmy] = quantizeStick(mx, my);
    const [qax, qay] = quantizeStick(ax, ay);
    return { mx: qmx, my: qmy, ax: qax, ay: qay };
  }

  destroy(): void {
    this.reset();
    this.layer.removeEventListener('pointerdown', this.onDown);
    this.layer.removeEventListener('pointermove', this.onMove);
    this.layer.removeEventListener('pointerup', this.onUp);
    this.layer.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('blur', this.reset);
  }

  private stickVector(s?: Stick): [number, number] {
    if (!s) return [0, 0];
    const dx = (s.x - s.ox) / RADIUS;
    const dy = (s.y - s.oy) / RADIUS;
    const len = Math.hypot(dx, dy);
    if (len < DEADZONE) return [0, 0];
    const k = Math.min(1, (len - DEADZONE) / (1 - DEADZONE)) / len;
    return [dx * k, dy * k];
  }

  private keyVector(map: Record<string, [number, number]>): [number, number] {
    let x = 0;
    let y = 0;
    for (const k of this.keys) {
      const v = map[k];
      if (v) {
        x += v[0];
        y += v[1];
      }
    }
    return [x, y];
  }

  private makeStick(e: PointerEvent, kind: string): Stick {
    const base = document.createElement('div');
    base.className = `ba-stick ba-stick-${kind}`;
    const knob = document.createElement('div');
    knob.className = 'ba-knob';
    base.appendChild(knob);
    this.layer.appendChild(base);
    const { x, y } = this.local(e);
    const s = { pointerId: e.pointerId, ox: x, oy: y, x, y, base, knob };
    this.place(s);
    return s;
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.layer.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private place(s: Stick): void {
    s.base.style.transform = `translate(${s.ox}px, ${s.oy}px)`;
    s.knob.style.transform = `translate(${s.x - s.ox}px, ${s.y - s.oy}px)`;
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    if (!this.move) this.move = this.makeStick(e, 'move');
    else if (!this.aim) this.aim = this.makeStick(e, 'aim');
    else return;
    try {
      this.layer.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or already-released pointer */
    }
  };

  private onMove = (e: PointerEvent): void => {
    const s = this.move?.pointerId === e.pointerId ? this.move : this.aim?.pointerId === e.pointerId ? this.aim : undefined;
    if (!s) return;
    e.preventDefault();
    const { x, y } = this.local(e);
    s.x = x;
    s.y = y;
    // Floating stick: drag the base along so reversing direction is instant.
    const dx = x - s.ox;
    const dy = y - s.oy;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      s.ox = x - (dx / len) * RADIUS;
      s.oy = y - (dy / len) * RADIUS;
    }
    this.place(s);
  };

  private onUp = (e: PointerEvent): void => {
    if (this.move?.pointerId === e.pointerId) {
      this.move.base.remove();
      this.move = undefined;
    } else if (this.aim?.pointerId === e.pointerId) {
      this.aim.base.remove();
      this.aim = undefined;
    }
  };

  private onKey = (e: KeyboardEvent): void => {
    if (!this.enabled || !(e.code in MOVE_KEYS || e.code in AIM_KEYS)) return;
    e.preventDefault();
    if (e.type === 'keydown') this.keys.add(e.code);
    else this.keys.delete(e.code);
  };

  private reset = (): void => {
    this.move?.base.remove();
    this.aim?.base.remove();
    this.move = this.aim = undefined;
    this.keys.clear();
  };
}
