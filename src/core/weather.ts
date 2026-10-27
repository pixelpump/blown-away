export interface Weather {
  /** Fraction of leaves that are wet (heavier, grippier). 0..1 */
  wet: number;
  /** Constant wind acceleration (px/s²). */
  windX: number;
  windY: number;
  /** Strength and frequency of random gusts. 0..1 */
  gustiness: number;
}

export type WeatherPreset = 'dry' | 'rain' | 'wind';

export const WEATHER_PRESETS: Record<WeatherPreset, Weather> = {
  dry: { wet: 0, windX: 0, windY: 0, gustiness: 0 },
  rain: { wet: 0.6, windX: 3, windY: -4, gustiness: 0.25 },
  wind: { wet: 0.1, windX: 10, windY: -6, gustiness: 1 },
};
