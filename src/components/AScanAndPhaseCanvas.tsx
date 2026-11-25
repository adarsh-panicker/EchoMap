import { useEffect, useRef } from 'react';

interface AScanAndPhaseCanvasProps {
  rawEnvelope: Float32Array | null;
  mtiEnvelope: Float32Array | null;
  displacementHistoryMm: Float32Array | null;
  maxRangeM: number;
  peakRangeCm: number;
  frameTick: number;
}

const WIDTH = 1260;
const HEIGHT = 185;

export function AScanAndPhaseCanvas({
  rawEnvelope,
  mtiEnvelope,
  displacementHistoryMm,
  maxRangeM,
  peakRangeCm,
  frameTick,
}: AScanAndPhaseCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#02050b';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const midX = Math.floor(WIDTH * 0.54);
    const pad = 14;

    // --- LEFT: A-Scan Impulse Response (dB vs Range) ---
    const aW = midX - pad * 2;
    const aH = HEIGHT - 36;
    const aX = pad + 26;
    const aY = 14;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = aY + (i / 4) * aH;
      ctx.beginPath();
      ctx.moveTo(aX, y);
      ctx.lineTo(aX + aW - 26, y);
      ctx.stroke();
    }

    const drawCurve = (env: Float32Array, color: string, lineWidth: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      const plotW = aW - 26;
      for (let i = 0; i < env.length; i++) {
        const x = aX + (i / (env.length - 1)) * plotW;
        const db = 20 * Math.log10(Math.max(env[i], 1e-5));
        const norm = Math.min(1, Math.max(0, (db + 75) / 75));
        const y = aY + (1 - norm) * aH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    if (rawEnvelope) drawCurve(rawEnvelope, 'rgba(148, 163, 184, 0.4)', 1.2);
    if (mtiEnvelope) drawCurve(mtiEnvelope, '#22d3ee', 2);

    if (peakRangeCm > 0 && peakRangeCm / 100 <= maxRangeM) {
      const px = aX + (peakRangeCm / 100 / maxRangeM) * (aW - 26);
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(px, aY);
      ctx.lineTo(px, aY + aH);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('A-Scan Impulse (Raw Gray / MTI Cyan)', aX, HEIGHT - 6);
    ctx.textAlign = 'right';
    ctx.fillText(`${maxRangeM.toFixed(1)}m`, aX + aW - 26, HEIGHT - 6);

    // Divider
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
    ctx.beginPath();
    ctx.moveTo(midX, 10);
    ctx.lineTo(midX, HEIGHT - 10);
    ctx.stroke();

    // --- RIGHT: Sub-mm Phase / Breathing Waveform ---
    const bX = midX + 20;
    const bW = WIDTH - bX - 18;
    const bY = aY;
    const bH = aH;
    const centerY = bY + bH / 2;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.beginPath();
    ctx.moveTo(bX, centerY);
    ctx.lineTo(bX + bW, centerY);
    ctx.stroke();

    if (displacementHistoryMm && displacementHistoryMm.length > 1) {
      let maxAbs = 2.0;
      for (let i = 0; i < displacementHistoryMm.length; i++) {
        const a = Math.abs(displacementHistoryMm[i]);
        if (a > maxAbs) maxAbs = a;
      }

      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < displacementHistoryMm.length; i++) {
        const x = bX + (i / (displacementHistoryMm.length - 1)) * bW;
        const y = centerY - (displacementHistoryMm[i] / maxAbs) * (bH * 0.44);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.textAlign = 'right';
      ctx.fillText(`±${maxAbs.toFixed(1)} mm`, bX + bW, bY + 11);
    }

    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'left';
    ctx.fillText('Sub-mm Phase Displacement @ Locked Bin (Breathing / Micro-Motion)', bX, HEIGHT - 6);
  }, [rawEnvelope, mtiEnvelope, displacementHistoryMm, maxRangeM, peakRangeCm, frameTick]);

  return (
    <div className="canvas-frame">
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />
    </div>
  );
}
