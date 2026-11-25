import { FFTPlan } from './fft.ts';

export interface ChirpConfig {
  sampleRate: number;
  fStart: number;
  fEnd: number;
  durationSec: number;
  amplitude: number;
  taperRatio?: number;
}

export interface ChirpReference {
  waveform: Float32Array;
  analyticConjRe: Float64Array;
  analyticConjIm: Float64Array;
  bandwidthHz: number;
  centerFreqHz: number;
  timeBandwidthProduct: number;
}

/**
 * Generates a Tukey-windowed Linear Frequency Modulated (LFM) chirp
 * and its conjugated analytic spectrum for complex matched filtering.
 */
export function buildChirpReference(config: ChirpConfig, fftPlan: FFTPlan): ChirpReference {
  const { sampleRate, fStart, fEnd, durationSec, amplitude, taperRatio = 0.15 } = config;
  const numSamples = Math.max(16, Math.round(durationSec * sampleRate));
  const waveform = new Float32Array(numSamples);

  const sweepRate = (fEnd - fStart) / durationSec;
  const taperSamples = Math.floor((taperRatio * numSamples) / 2);

  for (let n = 0; n < numSamples; n++) {
    const t = n / sampleRate;
    const phase = 2 * Math.PI * (fStart * t + 0.5 * sweepRate * t * t);

    let win = 1;
    if (taperSamples > 0) {
      if (n < taperSamples) {
        win = 0.5 * (1 - Math.cos((Math.PI * n) / taperSamples));
      } else if (n >= numSamples - taperSamples) {
        const k = numSamples - 1 - n;
        win = 0.5 * (1 - Math.cos((Math.PI * k) / taperSamples));
      }
    }

    waveform[n] = amplitude * win * Math.cos(phase);
  }

  // Compute analytic spectrum S_a[k] by zeroing negative frequencies, then conjugate.
  const N = fftPlan.size;
  const re = new Float64Array(N);
  const im = new Float64Array(N);

  // Normalize reference energy so matched-filter output scales cleanly
  let energy = 0;
  for (let n = 0; n < numSamples && n < N; n++) {
    re[n] = waveform[n];
    energy += waveform[n] * waveform[n];
  }
  const norm = energy > 1e-12 ? 1 / Math.sqrt(energy) : 1;
  for (let n = 0; n < numSamples && n < N; n++) {
    re[n] *= norm;
  }

  fftPlan.transform(re, im, false);

  const analyticConjRe = new Float64Array(N);
  const analyticConjIm = new Float64Array(N);

  // DC and Nyquist keep 1x; positive freqs (1..N/2-1) get 2x; negative freqs become 0.
  analyticConjRe[0] = re[0];
  analyticConjIm[0] = -im[0];

  const half = N >> 1;
  for (let k = 1; k < half; k++) {
    analyticConjRe[k] = 2 * re[k];
    analyticConjIm[k] = -2 * im[k];
  }
  analyticConjRe[half] = re[half];
  analyticConjIm[half] = -im[half];

  return {
    waveform,
    analyticConjRe,
    analyticConjIm,
    bandwidthHz: Math.abs(fEnd - fStart),
    centerFreqHz: 0.5 * (fStart + fEnd),
    timeBandwidthProduct: Math.abs(fEnd - fStart) * durationSec,
  };
}
