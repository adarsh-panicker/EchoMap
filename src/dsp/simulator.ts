import { SPEED_OF_SOUND_MPS } from './sonarProcessor.ts';
import type { ChirpReference } from './chirp.ts';

export interface SimTargetState {
  timeSec: number;
  handRangeM: number;
  handVelocityMps: number;
  breathingRateBpm: number;
}

/**
 * Generates realistic synthetic microphone audio frames containing:
 * 1. Direct speaker-to-mic acoustic bleed (with slight propagation delay)
 * 2. Static room clutter (desk/wall reflections)
 * 3. A moving hand target (sinusoidal sweep) + subtle chest-wall breathing target
 * 4. Thermal/ambient noise
 */
export function synthesizeSonarFrame(
  chirp: ChirpReference,
  sampleRate: number,
  frameLength: number,
  timeSec: number,
  scenario: 'hand' | 'breathing'
): { frame: Float32Array; state: SimTargetState } {
  const frame = new Float32Array(frameLength);
  const w = chirp.waveform;

  const addEcho = (delaySec: number, gain: number) => {
    const exactSample = delaySec * sampleRate;
    const baseIdx = Math.floor(exactSample);
    const frac = exactSample - baseIdx;
    for (let i = 0; i < w.length; i++) {
      const idx = baseIdx + i;
      if (idx >= 0 && idx + 1 < frameLength) {
        // Linear fractional-delay interpolation for sub-sample phase accuracy!
        frame[idx] += gain * w[i] * (1 - frac);
        frame[idx + 1] += gain * w[i] * frac;
      }
    }
  };

  // 1. Direct speaker-to-mic bleed at ~40 samples (~0.83 ms)
  const directDelaySec = 40 / sampleRate;
  addEcho(directDelaySec, 0.75);

  // 2. Static wall at 1.95 m
  addEcho(directDelaySec + (2 * 1.95) / SPEED_OF_SOUND_MPS, 0.14);

  // 3. Dynamic target
  let handRangeM = 0.65;
  let handVelocityMps = 0;
  const breathingBpm = 15;

  if (scenario === 'hand') {
    const omega = 2 * Math.PI * 0.35;
    handRangeM = 0.75 + 0.35 * Math.sin(omega * timeSec);
    handVelocityMps = 0.35 * omega * Math.cos(omega * timeSec);
    addEcho(directDelaySec + (2 * handRangeM) / SPEED_OF_SOUND_MPS, 0.24);
  } else {
    // Chest-wall breathing: ~6 mm peak-to-peak at 15 BPM (0.25 Hz) at 0.55 m
    const omega = 2 * Math.PI * (breathingBpm / 60);
    const dispM = 0.004 * Math.sin(omega * timeSec);
    handRangeM = 0.55 + dispM;
    handVelocityMps = 0.004 * omega * Math.cos(omega * timeSec);
    addEcho(directDelaySec + (2 * handRangeM) / SPEED_OF_SOUND_MPS, 0.22);
  }

  // 4. Ambient thermal noise
  for (let i = 0; i < frameLength; i++) {
    frame[i] += (Math.random() - 0.5) * 0.015;
  }

  return {
    frame,
    state: {
      timeSec,
      handRangeM,
      handVelocityMps,
      breathingRateBpm: breathingBpm,
    },
  };
}
