import { FFTPlan } from './fft.ts';
import { buildChirpReference, type ChirpConfig, type ChirpReference } from './chirp.ts';

export const SPEED_OF_SOUND_MPS = 343.2;

export interface SonarFrameResult {
  rangeBinsM: Float32Array;
  rawEnvelope: Float32Array;
  mtiEnvelope: Float32Array;
  /** Flattened [rangeBin * dopplerBins + vBin] magnitude */
  dopplerMap: Float32Array;
  dopplerBins: number;
  maxVelocityMps: number;
  directPathSample: number;
  peakRangeCm: number;
  peakStrengthDb: number;
  peakVelocityCms: number;
  /** Instantaneous displacement in mm at the tracked bin */
  phaseDisplacementMm: number;
  /** Estimated periodic motion rate (e.g. breathing) in BPM, or null if unstable */
  estimatedBpm: number | null;
  displacementHistoryMm: Float32Array;
}

export interface SonarConfig extends ChirpConfig {
  priSec: number;
  maxRangeM: number;
  mtiAlpha: number;
  dopplerWindowSize: number;
}

/**
 * Real-time complex matched-filter + MTI + Range-Doppler + sub-mm phase-tracking DSP engine.
 */
export class SonarProcessor {
  readonly fftSize: number;
  readonly fftPlan: FFTPlan;
  readonly dopplerPlan: FFTPlan;
  readonly chirpRef: ChirpReference;
  readonly config: SonarConfig;

  readonly numRangeBins: number;
  readonly dopplerBins: number;
  readonly rangeBinsM: Float32Array;

  private readonly workRe: Float64Array;
  private readonly workIm: Float64Array;
  private readonly dopRe: Float64Array;
  private readonly dopIm: Float64Array;
  private readonly dopWindow: Float64Array;

  // EMA background clutter model in aligned range coordinates
  private readonly emaRe: Float32Array;
  private readonly emaIm: Float32Array;
  private emaInitialized = false;

  // Optional static room calibration snapshot
  private baselineRe: Float32Array | null = null;
  private baselineIm: Float32Array | null = null;

  // Slow-time ring buffer: [frameIdx * numRangeBins + r]
  private readonly slowRe: Float32Array;
  private readonly slowIm: Float32Array;
  private slowWriteIdx = 0;
  private slowCount = 0;

  // Phase tracking at locked/peak bin
  private trackedBin = 12;
  private prevComplexRe = 0;
  private prevComplexIm = 0;
  private hasPrevComplex = false;
  private cumulativeDisplacementMm = 0;
  private readonly dispHistory: Float32Array;
  private dispWriteIdx = 0;
  private dispCount = 0;

  // Reusable output buffers
  private readonly rawEnvelope: Float32Array;
  private readonly mtiEnvelope: Float32Array;
  private readonly dopplerMap: Float32Array;
  private readonly dispOrdered: Float32Array;

  // Smoothed direct-path index to prevent jitter
  private smoothedDirectIdx = -1;

  constructor(config: SonarConfig, fftSize = 4096) {
    this.config = config;
    this.fftSize = fftSize;
    this.fftPlan = new FFTPlan(fftSize);
    this.chirpRef = buildChirpReference(config, this.fftPlan);

    this.dopplerBins = config.dopplerWindowSize;
    this.dopplerPlan = new FFTPlan(this.dopplerBins);

    const samplesPerMeter = (2 * config.sampleRate) / SPEED_OF_SOUND_MPS;
    this.numRangeBins = Math.min(
      Math.floor(config.maxRangeM * samplesPerMeter),
      fftSize >> 1
    );

    this.rangeBinsM = new Float32Array(this.numRangeBins);
    for (let r = 0; r < this.numRangeBins; r++) {
      this.rangeBinsM[r] = r / samplesPerMeter;
    }

    this.workRe = new Float64Array(fftSize);
    this.workIm = new Float64Array(fftSize);
    this.dopRe = new Float64Array(this.dopplerBins);
    this.dopIm = new Float64Array(this.dopplerBins);
    this.dopWindow = new Float64Array(this.dopplerBins);
    for (let i = 0; i < this.dopplerBins; i++) {
      this.dopWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (this.dopplerBins - 1)));
    }

    this.emaRe = new Float32Array(this.numRangeBins);
    this.emaIm = new Float32Array(this.numRangeBins);
    this.slowRe = new Float32Array(this.dopplerBins * this.numRangeBins);
    this.slowIm = new Float32Array(this.dopplerBins * this.numRangeBins);

    this.rawEnvelope = new Float32Array(this.numRangeBins);
    this.mtiEnvelope = new Float32Array(this.numRangeBins);
    this.dopplerMap = new Float32Array(this.numRangeBins * this.dopplerBins);

    const historyLen = 180; // ~12-18s at 10-15 Hz ping rate
    this.dispHistory = new Float32Array(historyLen);
    this.dispOrdered = new Float32Array(historyLen);
  }

  captureStaticBaseline(): void {
    this.baselineRe = new Float32Array(this.emaRe);
    this.baselineIm = new Float32Array(this.emaIm);
  }

  clearStaticBaseline(): void {
    this.baselineRe = null;
    this.baselineIm = null;
  }

  resetTracking(): void {
    this.emaInitialized = false;
    this.slowCount = 0;
    this.slowWriteIdx = 0;
    this.hasPrevComplex = false;
    this.cumulativeDisplacementMm = 0;
    this.dispCount = 0;
    this.dispWriteIdx = 0;
    this.smoothedDirectIdx = -1;
  }

  /**
   * Process one recorded audio frame aligned to a single ping PRI.
   */
  processFrame(recorded: Float32Array, useMti = true): SonarFrameResult {
    const N = this.fftSize;
    const re = this.workRe;
    const im = this.workIm;

    re.fill(0);
    im.fill(0);
    const copyLen = Math.min(recorded.length, N);
    for (let i = 0; i < copyLen; i++) {
      re[i] = recorded[i];
    }

    // Forward FFT of recorded signal
    this.fftPlan.transform(re, im, false);

    // Multiply by conjugated analytic chirp spectrum
    const cRe = this.chirpRef.analyticConjRe;
    const cIm = this.chirpRef.analyticConjIm;
    for (let k = 0; k < N; k++) {
      const xr = re[k];
      const xi = im[k];
      const cr = cRe[k];
      const ci = cIm[k];
      re[k] = xr * cr - xi * ci;
      im[k] = xr * ci + xi * cr;
    }

    // Inverse FFT -> Complex analytic impulse response h[n]
    this.fftPlan.transform(re, im, true);

    // 1. Find direct speaker-to-mic bleed peak (within first 30 ms of frame)
    const searchLimit = Math.min(Math.floor(0.03 * this.config.sampleRate), N >> 1);
    let maxMag = -1;
    let directIdx = 0;
    for (let i = 0; i < searchLimit; i++) {
      const mag = re[i] * re[i] + im[i] * im[i];
      if (mag > maxMag) {
        maxMag = mag;
        directIdx = i;
      }
    }

    if (this.smoothedDirectIdx < 0) {
      this.smoothedDirectIdx = directIdx;
    } else if (Math.abs(directIdx - this.smoothedDirectIdx) <= 2) {
      this.smoothedDirectIdx = directIdx;
    }
    const zeroIdx = this.smoothedDirectIdx;

    // 2. Extract aligned range bins, apply EMA MTI or static baseline subtraction
    const alpha = this.config.mtiAlpha;
    const oneMinusAlpha = 1 - alpha;
    const minDetectBin = Math.max(4, Math.floor((0.12 * 2 * this.config.sampleRate) / SPEED_OF_SOUND_MPS));

    let peakVal = 0;
    let peakBin = minDetectBin;

    for (let r = 0; r < this.numRangeBins; r++) {
      const idx = (zeroIdx + r) % N;
      const hr = re[idx];
      const hi = im[idx];

      const rawMag = Math.hypot(hr, hi);
      this.rawEnvelope[r] = rawMag;

      if (!this.emaInitialized) {
        this.emaRe[r] = hr;
        this.emaIm[r] = hi;
      } else {
        this.emaRe[r] = alpha * this.emaRe[r] + oneMinusAlpha * hr;
        this.emaIm[r] = alpha * this.emaIm[r] + oneMinusAlpha * hi;
      }

      let dr: number;
      let di: number;
      if (this.baselineRe && this.baselineIm) {
        dr = hr - this.baselineRe[r];
        di = hi - this.baselineIm[r];
      } else if (useMti) {
        dr = hr - this.emaRe[r];
        di = hi - this.emaIm[r];
      } else {
        dr = hr;
        di = hi;
      }

      const mtiMag = Math.hypot(dr, di);
      this.mtiEnvelope[r] = mtiMag;

      // Store in slow-time ring buffer for Range-Doppler FFT
      const slowOffset = this.slowWriteIdx * this.numRangeBins + r;
      this.slowRe[slowOffset] = dr;
      this.slowIm[slowOffset] = di;

      if (r >= minDetectBin && mtiMag > peakVal) {
        peakVal = mtiMag;
        peakBin = r;
      }
    }
    this.emaInitialized = true;

    this.slowWriteIdx = (this.slowWriteIdx + 1) % this.dopplerBins;
    if (this.slowCount < this.dopplerBins) {
      this.slowCount++;
    }

    // Smoothly update tracked bin if strong target appears
    if (peakVal > 1e-4) {
      this.trackedBin = peakBin;
    }

    // 3. Sub-millimeter phase displacement at trackedBin
    const trackIdx = (zeroIdx + this.trackedBin) % N;
    const curRe = re[trackIdx];
    const curIm = im[trackIdx];
    if (this.hasPrevComplex) {
      // Conjugate multiply cur * conj(prev) to get phase delta
      const dRe = curRe * this.prevComplexRe + curIm * this.prevComplexIm;
      const dIm = curIm * this.prevComplexRe - curRe * this.prevComplexIm;
      const dPhi = Math.atan2(dIm, dRe);
      const lambdaMm = (SPEED_OF_SOUND_MPS / this.chirpRef.centerFreqHz) * 1000;
      const dMm = (lambdaMm / (4 * Math.PI)) * dPhi;
      // Clamp wild phase jumps caused by noise
      if (Math.abs(dMm) < lambdaMm * 0.4) {
        this.cumulativeDisplacementMm += dMm;
      }
    }
    this.prevComplexRe = curRe;
    this.prevComplexIm = curIm;
    this.hasPrevComplex = true;

    // Gentle high-pass drift removal on cumulative displacement
    this.cumulativeDisplacementMm *= 0.985;
    this.dispHistory[this.dispWriteIdx] = this.cumulativeDisplacementMm;
    this.dispWriteIdx = (this.dispWriteIdx + 1) % this.dispHistory.length;
    if (this.dispCount < this.dispHistory.length) {
      this.dispCount++;
    }

    // 4. Compute Range-Doppler Map (slow-time FFT per range bin)
    const D = this.dopplerBins;
    const halfD = D >> 1;
    let peakVelBin = halfD;
    let peakVelMag = 0;

    for (let r = 0; r < this.numRangeBins; r++) {
      this.dopRe.fill(0);
      this.dopIm.fill(0);
      const count = this.slowCount;
      const startFrame = (this.slowWriteIdx - count + D) % D;
      for (let t = 0; t < count; t++) {
        const frameIdx = (startFrame + t) % D;
        const off = frameIdx * this.numRangeBins + r;
        const w = this.dopWindow[t];
        this.dopRe[t] = this.slowRe[off] * w;
        this.dopIm[t] = this.slowIm[off] * w;
      }

      this.dopplerPlan.transform(this.dopRe, this.dopIm, false);

      // FFTShift so 0 Hz is at D/2
      const outBase = r * D;
      for (let v = 0; v < D; v++) {
        const shifted = (v + halfD) % D;
        const mag = Math.hypot(this.dopRe[shifted], this.dopIm[shifted]) / Math.max(1, count);
        this.dopplerMap[outBase + v] = mag;

        if (r === this.trackedBin && v !== halfD && mag > peakVelMag) {
          peakVelMag = mag;
          peakVelBin = v;
        }
      }
    }

    const pingRateHz = 1 / this.config.priSec;
    const lambdaM = SPEED_OF_SOUND_MPS / this.chirpRef.centerFreqHz;
    const maxVelocityMps = (lambdaM * pingRateHz) / 4;
    const peakVelocityMps = ((peakVelBin - halfD) / halfD) * maxVelocityMps;

    // Order displacement history oldest -> newest
    const hLen = this.dispHistory.length;
    const startH = (this.dispWriteIdx - this.dispCount + hLen) % hLen;
    for (let i = 0; i < this.dispCount; i++) {
      this.dispOrdered[i] = this.dispHistory[(startH + i) % hLen];
    }

    const estimatedBpm = this.estimateBpm(this.dispOrdered, this.dispCount, pingRateHz);

    return {
      rangeBinsM: this.rangeBinsM,
      rawEnvelope: this.rawEnvelope,
      mtiEnvelope: this.mtiEnvelope,
      dopplerMap: this.dopplerMap,
      dopplerBins: D,
      maxVelocityMps,
      directPathSample: zeroIdx,
      peakRangeCm: this.rangeBinsM[this.trackedBin] * 100,
      peakStrengthDb: 20 * Math.log10(Math.max(peakVal, 1e-6)),
      peakVelocityCms: peakVelocityMps * 100,
      phaseDisplacementMm: this.cumulativeDisplacementMm,
      estimatedBpm,
      displacementHistoryMm: this.dispOrdered.subarray(0, this.dispCount),
    };
  }

  private estimateBpm(buf: Float32Array, len: number, pingRateHz: number): number | null {
    // Need at least 6 seconds of phase history for reliable low-frequency BPM
    if (len < Math.floor(pingRateHz * 6)) return null;

    let mean = 0;
    for (let i = 0; i < len; i++) mean += buf[i];
    mean /= len;

    let energy = 0;
    for (let i = 0; i < len; i++) {
      const d = buf[i] - mean;
      energy += d * d;
    }
    const rms = Math.sqrt(energy / len);
    if (rms < 0.08) return null; // Too quiet / no periodic motion

    // Spectral peak search in [6, 45] BPM (0.10 Hz .. 0.75 Hz)
    let bestBpm = 0;
    let bestPower = -1;
    const minBpm = 6;
    const maxBpm = 45;

    for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.5) {
      const freqHz = bpm / 60;
      const omega = (2 * Math.PI * freqHz) / pingRateHz;
      let cosSum = 0;
      let sinSum = 0;
      for (let n = 0; n < len; n++) {
        // Hann window to reduce spectral leakage
        const w = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (len - 1)));
        const x = (buf[n] - mean) * w;
        cosSum += x * Math.cos(omega * n);
        sinSum += x * Math.sin(omega * n);
      }
      const power = cosSum * cosSum + sinSum * sinSum;
      if (power > bestPower) {
        bestPower = power;
        bestBpm = bpm;
      }
    }

    return bestPower > 0 ? Math.round(bestBpm) : null;
  }
}
