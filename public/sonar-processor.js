/**
 * Synchronous Ultrasonic Chirp Transceiver AudioWorkletProcessor.
 * Emits the reference chirp on output channel 0 every `priSamples`
 * while capturing microphone channel 0 into a sample-aligned frame buffer.
 */
class SonarWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chirp = new Float32Array(0);
    this.priSamples = 3840; // 80 ms @ 48 kHz
    this.recordBuffer = new Float32Array(this.priSamples);
    this.sampleIdx = 0;
    this.active = false;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'config') {
        this.chirp = new Float32Array(msg.chirp);
        this.priSamples = msg.priSamples;
        this.recordBuffer = new Float32Array(this.priSamples);
        this.sampleIdx = 0;
      } else if (msg.type === 'active') {
        this.active = Boolean(msg.value);
        this.sampleIdx = 0;
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    const blockLen = output ? output.length : 128;

    if (!this.active || this.chirp.length === 0) {
      if (output) output.fill(0);
      return true;
    }

    for (let i = 0; i < blockLen; i++) {
      // Emit chirp during active pulse window
      if (output) {
        output[i] = this.sampleIdx < this.chirp.length ? this.chirp[this.sampleIdx] : 0;
      }

      // Record microphone input
      this.recordBuffer[this.sampleIdx] = input ? input[i] : 0;
      this.sampleIdx++;

      if (this.sampleIdx >= this.priSamples) {
        // Transfer frame buffer to main thread for matched-filter DSP
        const frameCopy = new Float32Array(this.recordBuffer);
        this.port.postMessage({ type: 'frame', frame: frameCopy }, [frameCopy.buffer]);
        this.sampleIdx = 0;
      }
    }

    return true;
  }
}

registerProcessor('sonar-worklet-processor', SonarWorkletProcessor);
