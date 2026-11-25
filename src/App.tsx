import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowRight,
  AudioWaveform,
  Crosshair,
  Gauge,
  Mic,
  Play,
  Radio,
  RotateCcw,
  Sliders,
  Square,
  Waves,
} from 'lucide-react';
import { LiveSonarEngine } from './audio/sonarEngine';
import { AScanAndPhaseCanvas } from './components/AScanAndPhaseCanvas';
import { EchoMapLogo } from './components/EchoMapLogo';
import { RangeDopplerCanvas } from './components/RangeDopplerCanvas';
import { WaterfallCanvas } from './components/WaterfallCanvas';
import { synthesizeSonarFrame } from './dsp/simulator';
import { SPEED_OF_SOUND_MPS, SonarProcessor, type SonarFrameResult } from './dsp/sonarProcessor';

type BandPreset = 'ultrasonic' | 'wide-ultra' | 'audible-test';
type SourceMode = 'live' | 'sim-hand' | 'sim-breathing';
type ScreenView = 'home' | 'sonar';

const BANDS: Record<BandPreset, { label: string; fStart: number; fEnd: number }> = {
  ultrasonic: { label: '18.0 – 21.0 kHz (Inaudible)', fStart: 18000, fEnd: 21000 },
  'wide-ultra': { label: '16.5 – 21.5 kHz (High-Res)', fStart: 16500, fEnd: 21500 },
  'audible-test': { label: '2.0 – 5.0 kHz (Audible Test)', fStart: 2000, fEnd: 5000 },
};

const PRI_SEC = 0.08; // 12.5 Hz ping rate
const CHIRP_DURATION_SEC = 0.025; // 25 ms chirp
const MAX_RANGE_M = 2.5;
const DOPPLER_BINS = 32;

export function App() {
  const [screen, setScreen] = useState<ScreenView>('home');
  const [band, setBand] = useState<BandPreset>('ultrasonic');
  const [sourceMode, setSourceMode] = useState<SourceMode>('live');
  const [isRunning, setIsRunning] = useState(false);
  const [useMti, setUseMti] = useState(true);
  const [hasBaseline, setHasBaseline] = useState(false);
  const [outputGain, setOutputGain] = useState(0.55);
  const [sensitivityDb, setSensitivityDb] = useState(8);
  const [sampleRate, setSampleRate] = useState(48000);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [frameTick, setFrameTick] = useState(0);
  const [result, setResult] = useState<SonarFrameResult | null>(null);

  const engineRef = useRef<LiveSonarEngine | null>(null);
  const processorRef = useRef<SonarProcessor | null>(null);
  const simTimerRef = useRef<number | null>(null);
  const simTimeRef = useRef(0);
  const useMtiRef = useRef(useMti);
  useMtiRef.current = useMti;

  const bandSpec = BANDS[band];

  const createProcessor = useCallback(
    (sr: number) => {
      const fEndClamped = Math.min(bandSpec.fEnd, sr * 0.46);
      const fStartClamped = Math.min(bandSpec.fStart, fEndClamped - 500);
      const proc = new SonarProcessor(
        {
          sampleRate: sr,
          fStart: fStartClamped,
          fEnd: fEndClamped,
          durationSec: CHIRP_DURATION_SEC,
          amplitude: 0.9,
          priSec: PRI_SEC,
          maxRangeM: MAX_RANGE_M,
          mtiAlpha: 0.9,
          dopplerWindowSize: DOPPLER_BINS,
        },
        4096
      );
      processorRef.current = proc;
      setHasBaseline(false);
      return proc;
    },
    [bandSpec.fEnd, bandSpec.fStart]
  );

  const stopAll = useCallback(async () => {
    if (simTimerRef.current !== null) {
      window.clearInterval(simTimerRef.current);
      simTimerRef.current = null;
    }
    if (engineRef.current) {
      await engineRef.current.stop();
    }
    setIsRunning(false);
  }, []);

  const goHome = useCallback(async () => {
    await stopAll();
    setScreen('home');
  }, [stopAll]);

  const startSonar = useCallback(
    async (overrideMode?: SourceMode) => {
      const activeMode = overrideMode ?? sourceMode;
      if (overrideMode) setSourceMode(overrideMode);
      setScreen('sonar');

      await stopAll();
      setErrorMsg(null);
      setResetToken((t) => t + 1);

      if (activeMode === 'live') {
        const engine = engineRef.current ?? new LiveSonarEngine();
        engineRef.current = engine;

        let proc = createProcessor(sampleRate);
        try {
          const priSamples = Math.round(PRI_SEC * sampleRate);
          const actualSr = await engine.start(proc.chirpRef.waveform, priSamples, outputGain, {
            onSampleRate: (sr) => {
              setSampleRate(sr);
              if (sr !== sampleRate) {
                proc = createProcessor(sr);
                engine.updateConfig(
                  proc.chirpRef.waveform,
                  Math.round(PRI_SEC * sr),
                  outputGain
                );
              }
            },
            onFrame: (frame) => {
              if (!processorRef.current) return;
              const res = processorRef.current.processFrame(frame, useMtiRef.current);
              setResult({ ...res });
              setFrameTick((t) => t + 1);
            },
            onError: (msg) => setErrorMsg(msg),
          });
          setSampleRate(actualSr);
          setIsRunning(true);
        } catch {
          setIsRunning(false);
        }
      } else {
        const sr = 48000;
        setSampleRate(sr);
        const proc = createProcessor(sr);
        const priSamples = Math.round(PRI_SEC * sr);
        simTimeRef.current = 0;

        simTimerRef.current = window.setInterval(() => {
          simTimeRef.current += PRI_SEC;
          const scenario = activeMode === 'sim-breathing' ? 'breathing' : 'hand';
          const { frame } = synthesizeSonarFrame(
            proc.chirpRef,
            sr,
            priSamples,
            simTimeRef.current,
            scenario
          );
          const res = proc.processFrame(frame, useMtiRef.current);
          setResult({ ...res });
          setFrameTick((t) => t + 1);
        }, PRI_SEC * 1000);

        setIsRunning(true);
      }
    },
    [createProcessor, outputGain, sampleRate, sourceMode, stopAll]
  );

  // Live-update gain when slider moves
  useEffect(() => {
    if (isRunning && sourceMode === 'live' && engineRef.current && processorRef.current) {
      engineRef.current.updateConfig(
        processorRef.current.chirpRef.waveform,
        Math.round(PRI_SEC * sampleRate),
        outputGain
      );
    }
  }, [outputGain, isRunning, sourceMode, sampleRate]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      void stopAll();
    };
  }, [stopAll]);

  const physicsStats = useMemo(() => {
    const bw = bandSpec.fEnd - bandSpec.fStart;
    const fc = 0.5 * (bandSpec.fStart + bandSpec.fEnd);
    const rangeResCm = (SPEED_OF_SOUND_MPS / (2 * bw)) * 100;
    const lambdaMm = (SPEED_OF_SOUND_MPS / fc) * 1000;
    const compressionGainDb = 10 * Math.log10(bw * CHIRP_DURATION_SEC);
    return {
      rangeResCm: rangeResCm.toFixed(1),
      lambdaMm: lambdaMm.toFixed(1),
      compressionGainDb: compressionGainDb.toFixed(1),
      pingRateHz: (1 / PRI_SEC).toFixed(1),
    };
  }, [bandSpec]);

  const handleCalibrate = () => {
    if (!processorRef.current) return;
    if (hasBaseline) {
      processorRef.current.clearStaticBaseline();
      setHasBaseline(false);
    } else {
      processorRef.current.captureStaticBaseline();
      setHasBaseline(true);
    }
  };

  return (
    <div className="app-shell">
      <header className="header-bar">
        <button
          type="button"
          className="brand-btn"
          onClick={() => void goHome()}
          title="Return to EchoMap Home Screen"
        >
          <EchoMapLogo size={42} />
          <div>
            <h1>EchoMap</h1>
            <p>Active Ultrasonic Chirp Sonar · Zero-Hardware Acoustic Radar</p>
          </div>
        </button>

        <div className="status-pills">
          <span className="pill author">Made by Adarsh Panicker</span>
          {screen === 'sonar' && (
            <>
              <span className={`pill ${isRunning ? (sourceMode === 'live' ? 'live' : 'sim') : ''}`}>
                <span className="dot" />
                {!isRunning
                  ? 'IDLE'
                  : sourceMode === 'live'
                  ? `LIVE SONAR · ${(sampleRate / 1000).toFixed(1)} kHz`
                  : 'SYNTHETIC PHYSICS SIM'}
              </span>
              <span className="pill mono">
                {useMti ? 'MTI CLUTTER REJECT ON' : 'RAW ENVELOPE'}
              </span>
            </>
          )}
        </div>
      </header>

      {screen === 'home' ? (
        <>
          <section className="home-hero">
            <EchoMapLogo size={76} />
            <span className="home-badge">
              <Radio size={14} /> STEM Innovation Challenge 2026 · Engineering &amp; Scientific Computing
            </span>
            <h2>Turn Any Laptop Into an Active Ultrasonic Sonar</h2>
            <p>
              EchoMap emits inaudible 18–21 kHz linear frequency-modulated (LFM) chirps through your
              standard speaker and captures echoes on your microphone—computing real-time matched-filter
              pulse compression, Range-Doppler velocity maps, and sub-millimeter phase interferometry
              directly in the browser.
            </p>

            <div className="home-actions">
              <button
                className="btn btn-primary"
                onClick={() => void startSonar('live')}
              >
                <Mic size={16} /> Launch Live Sonar <ArrowRight size={15} />
              </button>
              <button
                className="btn"
                onClick={() => void startSonar('sim-hand')}
              >
                <Waves size={16} /> Demo: Hand Tracking Sim
              </button>
              <button
                className="btn"
                onClick={() => void startSonar('sim-breathing')}
              >
                <Activity size={16} /> Demo: Breathing Rate Sim
              </button>
            </div>
          </section>

          <section className="home-grid">
            <div className="feature-card">
              <h3>
                <AudioWaveform size={17} /> Complex Matched Filtering
              </h3>
              <p>
                Cross-correlates incoming microphone frames against an analytic Hilbert-transformed
                chirp reference in real time, achieving +{physicsStats.compressionGainDb} dB pulse
                compression gain and {physicsStats.rangeResCm} cm range resolution.
              </p>
            </div>

            <div className="feature-card">
              <h3>
                <Gauge size={17} /> 2D Range-Doppler Radar
              </h3>
              <p>
                Applies a 32-ping slow-time FFT across every range bin with EMA Moving Target
                Indication (MTI) to cancel static desk/wall clutter and resolve approaching vs.
                receding hand velocities.
              </p>
            </div>

            <div className="feature-card">
              <h3>
                <Activity size={17} /> Sub-mm Phase Interferometry
              </h3>
              <p>
                Tracks carrier-phase shifts (Δφ) at the locked target bin to measure millimeter-scale
                displacements—capable of detecting non-contact chest-wall breathing rates (BPM).
              </p>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="controls-bar">
            <div className="control-group">
              <label>Signal Source</label>
              <select
                value={sourceMode}
                disabled={isRunning}
                onChange={(e) => setSourceMode(e.target.value as SourceMode)}
              >
                <option value="live">Live Laptop Mic + Speaker</option>
                <option value="sim-hand">Simulator: Moving Hand</option>
                <option value="sim-breathing">Simulator: Chest Breathing (15 BPM)</option>
              </select>
            </div>

            <div className="control-group">
              <label>Chirp Band</label>
              <select
                value={band}
                disabled={isRunning}
                onChange={(e) => setBand(e.target.value as BandPreset)}
              >
                {Object.entries(BANDS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="control-group">
              <label>Tx Volume ({Math.round(outputGain * 100)}%)</label>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={outputGain}
                onChange={(e) => setOutputGain(Number(e.target.value))}
              />
            </div>

            <div className="control-group">
              <label>Display Gain (+{sensitivityDb} dB)</label>
              <input
                type="range"
                min={-6}
                max={24}
                step={1}
                value={sensitivityDb}
                onChange={(e) => setSensitivityDb(Number(e.target.value))}
              />
            </div>

            {!isRunning ? (
              <button className="btn btn-primary" onClick={() => void startSonar()}>
                <Play size={15} /> Start Sonar
              </button>
            ) : (
              <button className="btn btn-danger" onClick={() => void stopAll()}>
                <Square size={15} /> Stop
              </button>
            )}

            <button
              className={`btn ${useMti ? 'btn-active' : ''}`}
              onClick={() => setUseMti((v) => !v)}
              title="Exponential Moving Average background clutter subtraction"
            >
              <Waves size={15} /> MTI Filter
            </button>

            <button
              className={`btn ${hasBaseline ? 'btn-active' : ''}`}
              disabled={!isRunning}
              onClick={handleCalibrate}
              title="Capture static room impulse response to detect stationary objects"
            >
              <Crosshair size={15} /> {hasBaseline ? 'Clear Room Cal' : 'Calibrate Room'}
            </button>

            <button
              className="btn"
              onClick={() => {
                processorRef.current?.resetTracking();
                setResetToken((t) => t + 1);
              }}
            >
              <RotateCcw size={15} /> Reset
            </button>
          </section>

          {errorMsg && (
            <div className="error-banner">
              <strong>Audio Error:</strong> {errorMsg} (Tip: try switching Signal Source to{' '}
              <em>Simulator</em> if no microphone is attached.)
            </div>
          )}

          <section className="telemetry-grid">
            <div className="metric-card">
              <div className="metric-label">Tracked Target Range</div>
              <div className="metric-value mono">
                {result ? `${result.peakRangeCm.toFixed(1)} cm` : '—'}
              </div>
              <div className="metric-sub">
                Direct-path lock: {result ? `${result.directPathSample} samples` : 'waiting'}
              </div>
            </div>

            <div className="metric-card">
              <div className="metric-label">Radial Velocity (Doppler)</div>
              <div className="metric-value mono">
                {result
                  ? `${result.peakVelocityCms >= 0 ? '+' : ''}${result.peakVelocityCms.toFixed(1)} cm/s`
                  : '—'}
              </div>
              <div className="metric-sub">Slow-time 32-ping FFT</div>
            </div>

            <div className="metric-card">
              <div className="metric-label">Sub-mm Phase Shift</div>
              <div className="metric-value mono">
                {result ? `${result.phaseDisplacementMm.toFixed(2)} mm` : '—'}
              </div>
              <div className="metric-sub">Carrier-phase Δφ interferometry</div>
            </div>

            <div className="metric-card">
              <div className="metric-label">Periodic Rate (Breathing)</div>
              <div className="metric-value mono">
                {result?.estimatedBpm ? `${result.estimatedBpm} BPM` : '—'}
              </div>
              <div className="metric-sub">6–60 BPM zero-crossing tracker</div>
            </div>

            <div className="metric-card">
              <div className="metric-label">Echo SNR / Peak</div>
              <div className="metric-value mono">
                {result ? `${result.peakStrengthDb.toFixed(1)} dB` : '—'}
              </div>
              <div className="metric-sub">Matched-filter compressed peak</div>
            </div>
          </section>

          <section className="viz-grid">
            <div className="panel">
              <div className="panel-header">
                <div className="panel-title">
                  <AudioWaveform size={16} />
                  Range-Time Waterfall (B-Scan)
                </div>
                <span className="panel-meta mono">0.0 – {MAX_RANGE_M.toFixed(1)} m</span>
              </div>
              <WaterfallCanvas
                envelope={result ? result.mtiEnvelope : null}
                maxRangeM={MAX_RANGE_M}
                peakRangeCm={result?.peakRangeCm ?? 0}
                sensitivityDb={sensitivityDb}
                resetToken={resetToken}
              />
            </div>

            <div className="panel">
              <div className="panel-header">
                <div className="panel-title">
                  <Gauge size={16} />
                  Range-Doppler Map (Range vs. Velocity)
                </div>
                <span className="panel-meta mono">
                  ±{result ? (result.maxVelocityMps * 100).toFixed(0) : '5'} cm/s
                </span>
              </div>
              <RangeDopplerCanvas
                dopplerMap={result ? result.dopplerMap : null}
                dopplerBins={result?.dopplerBins ?? DOPPLER_BINS}
                numRangeBins={result?.rangeBinsM.length ?? 0}
                maxRangeM={MAX_RANGE_M}
                maxVelocityMps={result?.maxVelocityMps ?? 0.055}
                sensitivityDb={sensitivityDb}
                frameTick={frameTick}
              />
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div className="panel-title">
                <Activity size={16} />
                Matched-Filter A-Scan &amp; Sub-mm Phase Interferometer
              </div>
              <span className="panel-meta mono">
                <Mic size={12} style={{ display: 'inline', marginRight: 4 }} />
                AEC/AGC/NS Disabled
              </span>
            </div>
            <AScanAndPhaseCanvas
              rawEnvelope={result?.rawEnvelope ?? null}
              mtiEnvelope={result?.mtiEnvelope ?? null}
              displacementHistoryMm={result?.displacementHistoryMm ?? null}
              maxRangeM={MAX_RANGE_M}
              peakRangeCm={result?.peakRangeCm ?? 0}
            />
          </section>
        </>
      )}

      <footer className="physics-footer mono">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <span>
            <Sliders size={12} style={{ display: 'inline', marginRight: 5 }} />
            <strong>c</strong> = {SPEED_OF_SOUND_MPS} m/s
          </span>
          <span>
            <strong>λ_center</strong> = {physicsStats.lambdaMm} mm
          </span>
          <span>
            <strong>ΔR (c/2B)</strong> = {physicsStats.rangeResCm} cm
          </span>
          <span>
            <strong>Pulse Compression</strong> = +{physicsStats.compressionGainDb} dB
          </span>
          <span>
            <strong>PRI</strong> = {(PRI_SEC * 1000).toFixed(0)} ms ({physicsStats.pingRateHz} Hz)
          </span>
        </div>
        <span>
          Made by <strong>Adarsh Panicker</strong>
        </span>
      </footer>
    </div>
  );
}

export default App;
