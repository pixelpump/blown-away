import { iterateInputs, type EncodedInputs } from './input';
import type { Level } from './map';
import { Sim, type RunResult, type SimOptions } from './sim';
import { TICK_HZ } from './tuning';

/** Ten minutes. Anything longer is not a speedrun. */
export const MAX_RUN_TICKS = TICK_HZ * 60 * 10;

/**
 * Re-run a recorded run from scratch. The server uses this to verify a
 * submitted score: trust the returned ticks, not the client's claimed time.
 */
export function replay(level: Level, options: SimOptions, inputs: EncodedInputs): RunResult {
  const sim = new Sim(level, options);
  for (const frame of iterateInputs(inputs)) {
    sim.step(frame);
    if (sim.finished || sim.ticks >= MAX_RUN_TICKS) break;
  }
  return sim.result();
}
