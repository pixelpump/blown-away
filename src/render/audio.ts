/** Procedural leaf-blower sound: filtered brown noise plus a two-stroke buzz. */
export class BlowerAudio {
  private ctx?: AudioContext;
  private gain?: GainNode;
  private filter?: BiquadFilterNode;
  private engine?: OscillatorNode;
  muted = false;

  /** Must be called from a user gesture (tap) on mobile. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'bandpass';
    this.filter.frequency.value = 600;
    this.filter.Q.value = 0.6;

    this.engine = ctx.createOscillator();
    this.engine.type = 'sawtooth';
    this.engine.frequency.value = 95;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.05;
    const engineLp = ctx.createBiquadFilter();
    engineLp.type = 'lowpass';
    engineLp.frequency.value = 400;

    this.gain = ctx.createGain();
    this.gain.gain.value = 0;

    noise.connect(this.filter).connect(this.gain);
    this.engine.connect(engineLp).connect(engineGain).connect(this.gain);
    this.gain.connect(ctx.destination);
    noise.start();
    this.engine.start();
  }

  /**
   * level: 0 = off, 0.3 = idling, 1 = running.
   * power: the blower's current strength (1 = normal, 1.5 = full blast);
   * the engine pitch and hiss rise with it so revving up is audible.
   */
  set(level: number, power = 1): void {
    if (!this.ctx || !this.gain || !this.filter || !this.engine) return;
    const t = this.ctx.currentTime;
    this.gain.gain.setTargetAtTime(this.muted ? 0 : level * (0.22 + 0.13 * power), t, 0.08);
    this.filter.frequency.setTargetAtTime(400 + 450 * power, t, 0.15);
    this.engine.frequency.setTargetAtTime(level > 0.5 ? 60 + 55 * power : 60, t, 0.12);
  }

  chime(): void {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    [660, 880, 1320].forEach((f, i) => {
      const o = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      o.type = 'square';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.09);
      g.gain.linearRampToValueAtTime(0.08, t + i * 0.09 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.25);
      o.connect(g).connect(this.ctx!.destination);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.3);
    });
  }

  destroy(): void {
    void this.ctx?.close();
    this.ctx = undefined;
  }
}
