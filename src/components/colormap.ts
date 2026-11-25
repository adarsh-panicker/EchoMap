/**
 * Precomputed 256-entry scientific sonar colormap (Deep Navy -> Cyan -> Emerald -> Amber -> White).
 */
export const SONAR_LUT: Uint8ClampedArray = (() => {
  const lut = new Uint8ClampedArray(256 * 3);
  const stops = [
    [0.0, 3, 7, 18],
    [0.2, 8, 47, 73],
    [0.45, 6, 182, 212],
    [0.7, 52, 211, 153],
    [0.88, 251, 191, 36],
    [1.0, 255, 255, 240],
  ];

  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let s0 = stops[0];
    let s1 = stops[stops.length - 1];
    for (let k = 0; k < stops.length - 1; k++) {
      if (t >= stops[k][0] && t <= stops[k + 1][0]) {
        s0 = stops[k];
        s1 = stops[k + 1];
        break;
      }
    }
    const span = Math.max(1e-6, s1[0] - s0[0]);
    const f = (t - s0[0]) / span;
    lut[i * 3] = Math.round(s0[1] + f * (s1[1] - s0[1]));
    lut[i * 3 + 1] = Math.round(s0[2] + f * (s1[2] - s0[2]));
    lut[i * 3 + 2] = Math.round(s0[3] + f * (s1[3] - s0[3]));
  }
  return lut;
})();
