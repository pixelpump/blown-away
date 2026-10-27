/**
 * One tick of player input. Sticks are quantized to integers in [-127, 127]
 * so live play and server-side replays see bit-identical input.
 * An aim of (0, 0) means "aim where you're walking".
 */
export interface InputFrame {
  mx: number;
  my: number;
  ax: number;
  ay: number;
}

export const NEUTRAL: Readonly<InputFrame> = { mx: 0, my: 0, ax: 0, ay: 0 };

export function isNeutral(f: InputFrame): boolean {
  return f.mx === 0 && f.my === 0 && f.ax === 0 && f.ay === 0;
}

/** Clamp a stick vector to the unit circle and quantize it. */
export function quantizeStick(x: number, y: number): [number, number] {
  const len = Math.sqrt(x * x + y * y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  return [Math.round(x * 127), Math.round(y * 127)];
}

/**
 * Run-length encoded input log: flat [count, mx, my, ax, ay, count, ...].
 * Players hold sticks steady most of the time, so this compresses well.
 */
export type EncodedInputs = number[];

export class InputLog {
  readonly data: EncodedInputs = [];

  push(f: InputFrame): void {
    const d = this.data;
    const n = d.length;
    if (n > 0 && d[n - 4] === f.mx && d[n - 3] === f.my && d[n - 2] === f.ax && d[n - 1] === f.ay) {
      d[n - 5]++;
    } else {
      d.push(1, f.mx, f.my, f.ax, f.ay);
    }
  }
}

export function* iterateInputs(encoded: EncodedInputs): Generator<InputFrame> {
  if (encoded.length % 5 !== 0) throw new Error('Input log length must be a multiple of 5');
  for (let i = 0; i < encoded.length; i += 5) {
    const count = encoded[i];
    const frame = { mx: encoded[i + 1], my: encoded[i + 2], ax: encoded[i + 3], ay: encoded[i + 4] };
    if (!Number.isInteger(count) || count < 1) throw new Error(`Bad repeat count at ${i}`);
    for (const v of [frame.mx, frame.my, frame.ax, frame.ay]) {
      if (!Number.isInteger(v) || v < -127 || v > 127) throw new Error(`Bad stick value at ${i}`);
    }
    for (let k = 0; k < count; k++) yield frame;
  }
}
