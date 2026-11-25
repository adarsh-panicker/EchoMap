import { useEffect, useRef } from 'react';
import { SONAR_LUT } from './colormap';

interface RangeDopplerCanvasProps {
  dopplerMap: Float32Array | null;
  dopplerBins: number;
  numRangeBins: number;
  maxRangeM: number;
  maxVelocityMps: number;
  sensitivityDb: number;
  frameTick: number;
}

const WIDTH = 520;
const HEIGHT = 300;
const PAD_LEFT = 46;
const PAD_BOTTOM = 26;
const PLOT_W = WIDTH - PAD_LEFT - 10;
const PLOT_H = HEIGHT - PAD_BOTTOM - 10;

export function RangeDopplerCanvas({
  dopplerMap,
  dopplerBins,
  numRangeBins,
  maxRangeM,
  maxVelocityMps,
  sensitivityDb,
  frameTick,
}: RangeDopplerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgDataRef = useRef<ImageData | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#02050b';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    if (dopplerMap && dopplerBins > 0 && numRangeBins > 0) {
      if (!imgDataRef.current || imgDataRef.current.width !== PLOT_W || imgDataRef.current.height !== PLOT_H) {
        imgDataRef.current = ctx.createImageData(PLOT_W, PLOT_H);
      }
      const img = imgDataRef.current;
      const data = img.data;

      const minDb = -62 - sensitivityDb;
      const maxDb = -12 - sensitivityDb * 0.4;
      const dbSpan = Math.max(10, maxDb - minDb);

      for (let y = 0; y < PLOT_H; y++) {
        const normR = 1 - y / (PLOT_H - 1);
        const rIdx = Math.min(numRangeBins - 1, Math.max(0, Math.floor(normR * (numRangeBins - 1))));

        for (let x = 0; x < PLOT_W; x++) {
          const normV = x / (PLOT_W - 1);
          const vIdx = Math.min(dopplerBins - 1, Math.max(0, Math.floor(normV * (dopplerBins - 1))));

          const val = dopplerMap[rIdx * dopplerBins + vIdx];
          const db = 20 * Math.log10(Math.max(val, 1e-6));
          const norm = Math.min(1, Math.max(0, (db - minDb) / dbSpan));
          const lutIdx = Math.floor(norm * 255) * 3;

          const p = (y * PLOT_W + x) * 4;
          data[p] = SONAR_LUT[lutIdx];
          data[p + 1] = SONAR_LUT[lutIdx + 1];
          data[p + 2] = SONAR_LUT[lutIdx + 2];
          data[p + 3] = 255;
        }
      }
      ctx.putImageData(img, PAD_LEFT, 8);
    }

    // Center zero-velocity crosshair
    const zeroX = PAD_LEFT + PLOT_W / 2;
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.25)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(zeroX, 8);
    ctx.lineTo(zeroX, 8 + PLOT_H);
    ctx.stroke();
    ctx.setLineDash([]);

    // Range grid & labels
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px ui-monospace, monospace';
    for (let i = 0; i <= 5; i++) {
      const frac = i / 5;
      const y = 8 + (1 - frac) * PLOT_H;
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(PAD_LEFT + PLOT_W, y);
      ctx.stroke();

      ctx.textAlign = 'right';
      ctx.fillText(`${(frac * maxRangeM).toFixed(1)}m`, PAD_LEFT - 6, y + 4);
    }

    const maxVCms = (maxVelocityMps * 100).toFixed(0);
    ctx.textAlign = 'left';
    ctx.fillText(`-${maxVCms} cm/s`, PAD_LEFT, HEIGHT - 7);
    ctx.textAlign = 'center';
    ctx.fillText('0 cm/s', zeroX, HEIGHT - 7);
    ctx.textAlign = 'right';
    ctx.fillText(`+${maxVCms} cm/s`, PAD_LEFT + PLOT_W, HEIGHT - 7);
  }, [dopplerMap, dopplerBins, numRangeBins, maxRangeM, maxVelocityMps, sensitivityDb, frameTick]);

  return (
    <div className="canvas-frame">
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />
    </div>
  );
}
