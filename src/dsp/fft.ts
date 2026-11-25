/**
 * Reusable Radix-2 Cooley-Tukey FFT plan with precomputed bit-reversal
 * and twiddle tables for zero-allocation real-time DSP.
 */
export class FFTPlan {
  readonly size: number;
  private readonly log2N: number;
  private readonly bitRev: Uint32Array;
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;

  constructor(size: number) {
    if ((size & (size - 1)) !== 0 || size < 2) {
      throw new Error(`FFT size must be a power of 2 >= 2, got ${size}`);
    }
    this.size = size;
    this.log2N = Math.round(Math.log2(size));
    this.bitRev = new Uint32Array(size);
    this.cosTable = new Float64Array(size / 2);
    this.sinTable = new Float64Array(size / 2);

    for (let i = 0; i < size; i++) {
      let rev = 0;
      let x = i;
      for (let b = 0; b < this.log2N; b++) {
        rev = (rev << 1) | (x & 1);
        x >>= 1;
      }
      this.bitRev[i] = rev;
    }

    for (let i = 0; i < size / 2; i++) {
      const angle = (-2 * Math.PI * i) / size;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }
  }

  /**
   * In-place complex FFT (forward if inverse=false, inverse normalized by 1/N if inverse=true).
   */
  transform(re: Float64Array, im: Float64Array, inverse = false): void {
    const N = this.size;
    const bitRev = this.bitRev;

    for (let i = 0; i < N; i++) {
      const j = bitRev[i];
      if (i < j) {
        const tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        const ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }

    const sign = inverse ? -1 : 1;
    for (let len = 2; len <= N; len <<= 1) {
      const half = len >> 1;
      const step = N / len;
      for (let i = 0; i < N; i += len) {
        for (let k = 0; k < half; k++) {
          const twIdx = k * step;
          const wr = this.cosTable[twIdx];
          const wi = sign * this.sinTable[twIdx];

          const evenIdx = i + k;
          const oddIdx = evenIdx + half;

          const or = re[oddIdx];
          const oi = im[oddIdx];

          const tr = wr * or - wi * oi;
          const ti = wr * oi + wi * or;

          re[oddIdx] = re[evenIdx] - tr;
          im[oddIdx] = im[evenIdx] - ti;
          re[evenIdx] += tr;
          im[evenIdx] += ti;
        }
      }
    }

    if (inverse) {
      const invN = 1 / N;
      for (let i = 0; i < N; i++) {
        re[i] *= invN;
        im[i] *= invN;
      }
    }
  }
}
