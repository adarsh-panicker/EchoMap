export interface LiveSonarCallbacks {
  onFrame: (frame: Float32Array) => void;
  onSampleRate: (sampleRate: number) => void;
  onError: (message: string) => void;
}

/**
 * Manages WebAudio AudioContext, raw microphone capture (AEC/AGC/NS disabled),
 * and the SonarWorkletProcessor transceiver.
 */
export class LiveSonarEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private gainNode: GainNode | null = null;
  private running = false;

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  async start(
    chirpWaveform: Float32Array,
    priSamples: number,
    outputGain: number,
    callbacks: LiveSonarCallbacks
  ): Promise<number> {
    if (this.running) {
      await this.stop();
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });

      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }

      callbacks.onSampleRate(this.ctx.sampleRate);

      await this.ctx.audioWorklet.addModule('/sonar-processor.js');

      this.sourceNode = this.ctx.createMediaStreamSource(this.stream);
      this.workletNode = new AudioWorkletNode(this.ctx, 'sonar-worklet-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = outputGain;

      this.workletNode.port.onmessage = (e) => {
        if (e.data?.type === 'frame') {
          callbacks.onFrame(e.data.frame as Float32Array);
        }
      };

      this.workletNode.port.postMessage({
        type: 'config',
        chirp: chirpWaveform,
        priSamples,
      });
      this.workletNode.port.postMessage({ type: 'active', value: true });

      this.sourceNode.connect(this.workletNode);
      this.workletNode.connect(this.gainNode);
      this.gainNode.connect(this.ctx.destination);

      this.running = true;
      return this.ctx.sampleRate;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to access microphone/speaker for WebAudio sonar.';
      callbacks.onError(msg);
      await this.stop();
      throw err;
    }
  }

  updateConfig(chirpWaveform: Float32Array, priSamples: number, outputGain: number): void {
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setTargetAtTime(outputGain, this.ctx.currentTime, 0.02);
    }
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'config',
        chirp: chirpWaveform,
        priSamples,
      });
      this.workletNode.port.postMessage({ type: 'active', value: true });
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'active', value: false });
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
    }
  }
}
