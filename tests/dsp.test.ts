import assert from 'node:assert/strict';
import { FFTPlan } from '../src/dsp/fft.ts';
import { SonarProcessor, SPEED_OF_SOUND_MPS } from '../src/dsp/sonarProcessor.ts';
import { synthesizeSonarFrame } from '../src/dsp/simulator.ts';

function testFftRoundtrip() {
  const N = 1024;
  const plan = new FFTPlan(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const orig = new Float64Array(N);

  for (let i = 0; i < N; i++) {
    orig[i] = Math.sin(0.13 * i) + 0.5 * Math.cos(0.41 * i);
    re[i] = orig[i];
  }

  plan.transform(re, im, false);
  plan.transform(re, im, true);

  let maxErr = 0;
  for (let i = 0; i < N; i++) {
    maxErr = Math.max(maxErr, Math.abs(re[i] - orig[i]), Math.abs(im[i]));
  }
  assert.ok(maxErr < 1e-10, `FFT roundtrip error too large: ${maxErr}`);
  console.log(`PASS testFftRoundtrip (maxErr=${maxErr.toExponential(2)})`);
}

function testMatchedFilterRangeLocalization() {
  const sr = 48000;
  const proc = new SonarProcessor(
    {
      sampleRate: sr,
      fStart: 18000,
      fEnd: 21000,
      durationSec: 0.025,
      amplitude: 0.9,
      priSec: 0.08,
      maxRangeM: 2.5,
      mtiAlpha: 0.85,
      dopplerWindowSize: 32,
    },
    4096
  );

  // Build synthetic frame with direct path at sample 40 and single target at 1.10 m
  const targetRangeM = 1.10;
  const frameLen = Math.round(0.08 * sr);
  const w = proc.chirpRef.waveform;

  const makeFrame = (rangeM: number) => {
    const f = new Float32Array(frameLen);
    const directDelay = 40;
    const echoDelay = directDelay + Math.round((2 * rangeM * sr) / SPEED_OF_SOUND_MPS);
    for (let i = 0; i < w.length; i++) {
      if (directDelay + i < frameLen) f[directDelay + i] += 0.8 * w[i];
      if (echoDelay + i < frameLen) f[echoDelay + i] += 0.3 * w[i];
    }
    return f;
  };

  // Feed 1 frame without target to prime EMA, then target moving slightly
  proc.processFrame(makeFrame(0.4), true);
  const res = proc.processFrame(makeFrame(targetRangeM), true);

  assert.ok(
    Math.abs(res.directPathSample - 40) <= 1,
    `Expected directPathSample ~40, got ${res.directPathSample}`
  );
  assert.ok(
    Math.abs(res.peakRangeCm - targetRangeM * 100) < 4.0,
    `Expected peakRangeCm ~${targetRangeM * 100}, got ${res.peakRangeCm}`
  );
  console.log(
    `PASS testMatchedFilterRangeLocalization (detected=${res.peakRangeCm.toFixed(1)} cm vs actual=${targetRangeM * 100} cm)`
  );
}

function testBreathingRateEstimation() {
  const sr = 48000;
  const priSec = 0.08;
  const priSamples = Math.round(priSec * sr);
  const proc = new SonarProcessor(
    {
      sampleRate: sr,
      fStart: 18000,
      fEnd: 21000,
      durationSec: 0.025,
      amplitude: 0.9,
      priSec,
      maxRangeM: 2.5,
      mtiAlpha: 0.9,
      dopplerWindowSize: 32,
    },
    4096
  );

  let lastRes = null;
  // Simulate 14 seconds of 15 BPM chest-wall breathing
  for (let k = 0; k < 175; k++) {
    const { frame } = synthesizeSonarFrame(proc.chirpRef, sr, priSamples, k * priSec, 'breathing');
    lastRes = proc.processFrame(frame, true);
  }

  assert.ok(lastRes !== null);
  assert.ok(
    lastRes.estimatedBpm !== null && Math.abs(lastRes.estimatedBpm - 15) <= 3,
    `Expected ~15 BPM, got ${lastRes.estimatedBpm}`
  );
  console.log(`PASS testBreathingRateEstimation (estimated=${lastRes.estimatedBpm} BPM)`);
}

testFftRoundtrip();
testMatchedFilterRangeLocalization();
testBreathingRateEstimation();
