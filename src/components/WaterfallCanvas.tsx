import { useEffect, useRef } from 'react';
import { SONAR_LUT } from './colormap';

interface WaterfallCanvasProps {
  envelope: Float32Array | null;
  maxRangeM: number;
  peakRangeCm: number;
  sensitivityDb: number;
  resetToken: number;
  frameTick: number;
}

const WIDTH = 720;
const HEIGHT = 300;
const PAD_LEFT = 46;
const PAD_BOTTOM = 24;
const PLOT_W = WIDTH - PAD_LEFT - 10;
const PLOT_H = HEIGHT - PAD_BOTTOM - 10;

export function WaterfallCanvas({
  envelope,
  maxRangeM,
  peakRangeCm,
  sensitivityDb,
  resetToken,
  frameTick,
}: WaterfallCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const off = document.createElement('canvas');
    off.width = PLOT_W;
    off.height = PLOT_H;
    const octx = off.getContext('2d');
    if (octx) {
      octx.fillStyle = '#030712';
      octx.fillRect(0, 0, PLOT_W, PLOT_H);
    }
    offscreenRef.current = off;
  }, [resetToken]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const off = offscreenRef.current;
    if (!canvas || !off) return;
    const ctx = canvas.getContext('2d');
    const octx = off.getContext('2d');
    if (!ctx || !octx) return;

    if (envelope && envelope.length > 0) {
      // Shift existing waterfall 2px to the left
      octx.drawImage(off, 2, 0, PLOT_W - 2, PLOT_H, 0, 0, PLOT_W - 2, PLOT_H);

      // Draw newest column on the right edge (2px wide)
      const colImg = octx.createImageData(2, PLOT_H);
      const data = colImg.data;
      const numBins = envelope.length;
      const minDb = -65 - sensitivityDb;
      const maxDb = -10 - sensitivityDb * 0.4;
      const dbSpan = Math.max(10, maxDb - minDb);

      for (let y = 0; y < PLOT_H; y++) {
        // Top = maxRangeM, Bottom = 0m
        const normRange = 1 - y / (PLOT_H - 1);
        const binIdx = Math.min(numBins - 1, Math.max(0, Math.floor(normRange * (numBins - 1))));
        const db = 20 * Math.log10(Math.max(envelope[binIdx], 1e-6));
        const norm = Math.min(1, Math.max(0, (db - minDb) / dbSpan));
        const lutIdx = Math.floor(norm * 255) * 3;
        const r = SONAR_LUT[lutIdx];
        const g = SONAR_LUT[lutIdx + 1];
        const b = SONAR_LUT[lutIdx + 2];

        for (let dx = 0; dx < 2; dx++) {
          const p = (y * 2 + dx) * 4;
          data[p] = r;
          data[p + 1] = g;
          data[p + 2] = b;
          data[p + 3] = 255;
        }
      }
      octx.putImageData(colImg, PLOT_W - 2, 0);
    }

    // Composite onto main canvas with axes
    ctx.fillStyle = '#02050b';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.drawImage(off, PAD_LEFT, 8);

    // Grid & Y-axis range labels
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px ui-monospace, monospace';
    ctx.lineWidth = 1;

    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const frac = i / steps;
      const y = 8 + (1 - frac) * PLOT_H;
      const meters = frac * maxRangeM;

      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(PAD_LEFT + PLOT_W, y);
      ctx.stroke();

      ctx.textAlign = 'right';
      ctx.fillText(`${meters.toFixed(1)}m`, PAD_LEFT - 6, y + 4);
    }

    // Peak marker on right edge
    if (peakRangeCm > 0 && peakRangeCm / 100 <= maxRangeM) {
      const py = 8 + (1 - peakRangeCm / 100 / maxRangeM) * PLOT_H;
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT + PLOT_W - 14, py);
      ctx.lineTo(PAD_LEFT + PLOT_W, py);
      ctx.stroke();
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = '#64748b';
    ctx.fillText('← Past', PAD_LEFT + 4, HEIGHT - 6);
    ctx.textAlign = 'right';
    ctx.fillText('Now →', PAD_LEFT + PLOT_W, HEIGHT - 6);
  }, [envelope, maxRangeM, peakRangeCm, sensitivityDb, frameTick]);

  return (
    <div className="canvas-frame">
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />
    </div>
  );
}
