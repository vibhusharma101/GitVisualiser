import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, Html, Text, Line } from '@react-three/drei';
import { EffectComposer, Bloom, Noise, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { io } from 'socket.io-client';

import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  sendDefaultPii: true,
});

// ─── Socket (connects via Vite proxy → port 3002) ───────────────────────────
// Use window.location so Vite proxy handles routing regardless of port
const SOCKET_URL = import.meta.env.DEV
  ? window.location.origin   // in dev: let Vite proxy /socket.io → 3002
  : 'http://localhost:3002';  // in prod: direct
const socket = io(SOCKET_URL);

// ─── Types ────────────────────────────────────────────────────────────────────
interface RawCommit {
  hash: string;
  parents: string[];
  message: string;
  time: number;
  refs: string[];
  branchOwner: string;
}

interface CommitNode extends RawCommit {
  x: number;
  y: number;
  z: number;
  color: string;
  lane: number;
}

// ─── Palette ──────────────────────────────────────────────────────────────────
const COLORS = [
  '#00f2ff', // lane 0 → main  → cyan
  '#ff00ff', // lane 1         → magenta
  '#ffaa00', // lane 2         → amber
  '#ff3366', // lane 3         → red
  '#00ff88', // lane 4         → green
  '#bb88ff', // lane 5         → purple
  '#ff8800', // lane 6         → orange
  '#88ddff', // lane 7         → sky
];

// ─── Layout ───────────────────────────────────────────────────────────────────
function buildLayout(rawCommits: RawCommit[], branchList: string[]): CommitNode[] {
  if (!rawCommits.length) return [];

  // Determine main branch
  const mainBranch =
    branchList.find(b => b === 'main' || b === 'master') ??
    branchList[0] ??
    'main';

  // Build lane map: main → 0, others → 1, 2, 3...
  const laneMap = new Map<string, number>();
  laneMap.set(mainBranch, 0);
  let nextLane = 1;
  branchList.forEach(b => {
    if (!laneMap.has(b)) { laneMap.set(b, nextLane++); }
  });

  // Sort by time ascending (oldest at bottom)
  const sorted = [...rawCommits].sort((a, b) => a.time - b.time);

  // Use INDEX-based Y (not time-based) to guarantee minimum spacing
  // This prevents commits with the same timestamp from overlapping
  const Y_STEP = 3; // units between commit rows

  // Group by time bucket so commits at the same time sit at same Y
  const timeSorted = [...new Set(sorted.map(c => c.time))].sort((a, b) => a - b);
  const timeToRow = new Map<number, number>();
  timeSorted.forEach((t, i) => timeToRow.set(t, i));

  return sorted.map(commit => {
    const owner = commit.branchOwner;
    const lane = laneMap.get(owner) ?? 0;
    const color = COLORS[lane % COLORS.length];
    const row = timeToRow.get(commit.time) ?? 0;

    return {
      ...commit,
      x: lane * 5,   // 5 units gap between lanes  → clearly separated
      y: row * Y_STEP,
      z: 0,
      color,
      lane,
    };
  });
}

// ─── Sentry Test Button ──────────────────────────────────────────────────────
const ErrorButton = () => {
  const [sent, setSent] = useState(false);

  const handleClick = () => {
    const err = new Error('Sentry test error — This is an updated error message!');
    Sentry.captureException(err);
    setSent(true);
    setTimeout(() => setSent(false), 3000);
  };

  return (
    <button className="sentry-test-btn" onClick={handleClick}>
      {sent ? '✅ Sent to Sentry!' : '🐛 Test Sentry'}
    </button>
  );
};

// ─── Rotating Cube ────────────────────────────────────────────────────────────
const CommitCube = ({ commit }: { commit: CommitNode }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  const isHead = commit.refs.some(r => r.startsWith('HEAD'));
  const displayRefs = commit.refs.filter(r => !r.includes('origin/'));

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * (hovered ? 3 : 0.4);
    }
  });

  return (
    <group position={[commit.x, commit.y, commit.z]}>
      <mesh
        ref={meshRef}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        scale={hovered ? 1.6 : isHead ? 1.3 : 1}
      >
        <boxGeometry args={[0.7, 0.7, 0.7]} />
        <meshStandardMaterial
          color={commit.color}
          emissive={commit.color}
          emissiveIntensity={hovered ? 10 : isHead ? 5 : 2}
          metalness={0.8}
          roughness={0.15}
        />
      </mesh>

      {/* Tooltip */}
      {hovered && (
        <Html distanceFactor={14} style={{ pointerEvents: 'none' }}>
          <div className="tooltip">
            <div className="tooltip-hash">{commit.hash.substring(0, 7)}</div>
            <div className="tooltip-branch">⬡ {commit.branchOwner}</div>
            <div className="tooltip-msg">{commit.message}</div>
            {displayRefs.length > 0 && (
              <div className="tooltip-refs">{displayRefs.join(' • ')}</div>
            )}
          </div>
        </Html>
      )}

      {/* Branch labels */}
      {displayRefs.map((ref, i) => (
        <Text
          key={ref}
          position={[0, 0.75 + i * 0.35, 0]}
          fontSize={0.22}
          color={commit.color}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#000"
        >
          {ref.startsWith('HEAD -> ')
            ? `▶ ${ref.replace('HEAD -> ', '')}`
            : ref}
        </Text>
      ))}
    </group>
  );
};

// ─── Connection Line ──────────────────────────────────────────────────────────
const ConnectionLine = ({
  start,
  end,
  color,
}: {
  start: [number, number, number];
  end: [number, number, number];
  color: string;
}) => {
  const pts = useMemo(
    () => [new THREE.Vector3(...start), new THREE.Vector3(...end)],
    [start, end],
  );
  return <Line points={pts} color={color} lineWidth={2} transparent opacity={0.55} />;
};

// ─── Scene ────────────────────────────────────────────────────────────────────
const Scene = ({ commits }: { commits: CommitNode[] }) => {
  const map = useMemo(() => {
    const m: Record<string, CommitNode> = {};
    commits.forEach(c => (m[c.hash] = c));
    return m;
  }, [commits]);

  return (
    <>
      {commits.map(c => <CommitCube key={c.hash} commit={c} />)}
      {commits.map(c =>
        c.parents.map(ph => {
          const parent = map[ph];
          if (!parent) return null;
          return (
            <ConnectionLine
              key={`${c.hash}-${ph}`}
              start={[c.x, c.y, c.z]}
              end={[parent.x, parent.y, parent.z]}
              color={c.color}
            />
          );
        }),
      )}
    </>
  );
};

// ─── Legend ───────────────────────────────────────────────────────────────────
const Legend = ({
  commits,
  branchList,
}: {
  commits: CommitNode[];
  branchList: string[];
}) => {
  const items = useMemo(() => {
    const cMap = new Map<string, string>();
    commits.forEach(c => cMap.set(c.branchOwner, c.color));
    return branchList.map(b => ({ name: b, color: cMap.get(b) ?? '#fff' }));
  }, [commits, branchList]);

  if (!items.length) return null;

  return (
    <div className="legend">
      <div className="legend-title">Branches</div>
      {items.map(b => (
        <div key={b.name} className="legend-item">
          <div
            className="legend-dot"
            style={{ background: b.color, boxShadow: `0 0 8px ${b.color}` }}
          />
          <span>{b.name}</span>
        </div>
      ))}
    </div>
  );
};

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const [rawCommits, setRawCommits] = useState<RawCommit[]>([]);
  const [branchList, setBranchList] = useState<string[]>([]);
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [errorMsg, setErrorMsg] = useState('');

  const [debugData, setDebugData] = useState<Record<string,string>>({});

  useEffect(() => {
    socket.on('git-update', (data: {
      commits?: RawCommit[];
      branches?: string[];
      error?: string;
    }) => {
      if (data.error) {
        setStatus('error');
        setErrorMsg(data.error);
      } else {
        const commits = data.commits ?? [];
        const branches = data.branches ?? [];
        setRawCommits(commits);
        setBranchList(branches);
        setStatus('live');
        // Debug: show branch owners
        const ownerCount: Record<string, number> = {};
        commits.forEach(c => {
          ownerCount[c.branchOwner] = (ownerCount[c.branchOwner] ?? 0) + 1;
        });
        const dbg: Record<string,string> = {};
        branches.forEach(b => { dbg[b] = `${ownerCount[b] ?? 0} commits`; });
        setDebugData(dbg);
      }
    });
    return () => { socket.off('git-update'); };
  }, []);

  const commits = useMemo(
    () => buildLayout(rawCommits, branchList),
    [rawCommits, branchList],
  );

  const laneCount = useMemo(
    () => new Set(commits.map(c => c.lane)).size,
    [commits],
  );

  // Camera position: center horizontally between all lanes
  const maxLane = Math.max(0, laneCount - 1);
  const centerX = (maxLane * 5) / 2;

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      {/* Header */}
      <div className="overlay">
        <h1>🌌 Git Multiverse</h1>
        <div className={`badge badge-${status}`}>
          {status === 'connecting' && '⏳ Connecting…'}
          {status === 'live' &&
            `✅ ${commits.length} commits · ${branchList.length} branch${branchList.length !== 1 ? 'es' : ''}`}
          {status === 'error' && `❌ ${errorMsg}`}
        </div>
        <p className="hint">Drag to orbit · Scroll to zoom · Hover nodes</p>
        <ErrorButton />
      </div>

      {/* Legend */}
      <Legend commits={commits} branchList={branchList} />

      {/* Tip when only 1 branch */}
      {status === 'live' && branchList.length <= 1 && (
        <div className="tip-box">
          <strong>💡 Only one local branch found.</strong>
          <br />
          Create a branch with commits to see divergence:
          <code>git checkout -b feature-a</code>
          <code>git commit --allow-empty -m "feat: my feature"</code>
        </div>
      )}

      {/* Debug panel: shows raw branch → commit count from server */}
      {status === 'live' && Object.keys(debugData).length > 0 && (
        <div className="debug-panel">
          <div className="legend-title">🔍 Branch ownership (debug)</div>
          {Object.entries(debugData).map(([branch, count]) => (
            <div key={branch} className="legend-item">
              <div
                className="legend-dot"
                style={{
                  background: commits.find(c => c.branchOwner === branch)?.color ?? '#fff',
                  boxShadow: `0 0 6px ${commits.find(c => c.branchOwner === branch)?.color ?? '#fff'}`,
                }}
              />
              <span>{branch}: {count}</span>
            </div>
          ))}
        </div>
      )}


      <Canvas camera={{ position: [centerX, 8, 22], fov: 55 }}>
        <color attach="background" args={['#030307']} />
        <ambientLight intensity={0.25} />
        <pointLight position={[centerX, 30, 10]} intensity={3} color="#00f2ff" />
        <pointLight position={[centerX, -20, -10]} intensity={1.5} color="#ff00ff" />

        <Stars radius={200} depth={80} count={7000} factor={4} saturation={0} fade speed={0.4} />
        <gridHelper args={[80, 80, '#0a0a22', '#0a0a22']} position={[centerX, -1, 0]} />

        {commits.length > 0 && <Scene commits={commits} />}

        <OrbitControls
          enableDamping
          dampingFactor={0.06}
          minDistance={4}
          maxDistance={100}
          autoRotate={status === 'live'}
          autoRotateSpeed={0.3}
          target={[centerX, 5, 0]}
        />

        <EffectComposer>
          <Bloom luminanceThreshold={0.4} mipmapBlur intensity={2.2} radius={0.5} />
          <Noise opacity={0.03} />
          <Vignette eskil={false} offset={0.1} darkness={1.1} />
        </EffectComposer>
      </Canvas>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=JetBrains+Mono&display=swap');
        * { box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; background: #030307; }

        .overlay {
          position: absolute; top: 24px; left: 24px; z-index: 10;
          background: rgba(3,3,15,0.82);
          padding: 1.2rem 1.6rem; border-radius: 14px;
          backdrop-filter: blur(16px);
          border: 1px solid rgba(0,242,255,0.2);
          pointer-events: none; max-width: 300px;
        }
        h1 {
          font-size: 1.05rem; margin: 0 0 0.5rem;
          letter-spacing: 0.1em; text-transform: uppercase;
          color: #00f2ff; text-shadow: 0 0 14px rgba(0,242,255,0.7);
        }
        .badge {
          display: inline-block; font-size: 0.7rem;
          font-family: 'JetBrains Mono', monospace;
          padding: 3px 9px; border-radius: 6px; margin-bottom: 0.4rem;
        }
        .badge-connecting { background: rgba(255,170,0,.15); color: #ffaa00; border: 1px solid #ffaa0055; }
        .badge-live       { background: rgba(0,255,136,.15); color: #00ff88; border: 1px solid #00ff8855; }
        .badge-error      { background: rgba(255,50,50,.15);  color: #ff5555; border: 1px solid #ff555555; }
        .hint { font-size: 0.67rem; color: rgba(255,255,255,0.3); margin: 0; }

        .sentry-test-btn {
          margin-top: 0.7rem;
          padding: 5px 12px; border-radius: 6px; font-size: 0.68rem;
          font-family: 'JetBrains Mono', monospace; cursor: pointer;
          background: rgba(255,60,60,0.12); color: #ff6b6b;
          border: 1px solid rgba(255,60,60,0.4);
          transition: all 0.2s ease;
          pointer-events: all;
        }
        .sentry-test-btn:hover {
          background: rgba(255,60,60,0.25); border-color: #ff6b6b;
          box-shadow: 0 0 12px rgba(255,60,60,0.3);
          transform: scale(1.04);
        }

        .tip-box {
          position: absolute; bottom: 24px; left: 24px; z-index: 10;
          background: rgba(3,3,15,0.88);
          padding: 1rem 1.4rem; border-radius: 12px;
          backdrop-filter: blur(16px); border: 1px solid rgba(255,170,0,0.35);
          font-size: 0.74rem; color: rgba(255,255,255,0.7);
          max-width: 320px; line-height: 1.7;
        }
        .tip-box code {
          display: block; background: rgba(0,0,0,0.45);
          color: #ffaa00; padding: 2px 8px; border-radius: 4px;
          font-family: 'JetBrains Mono', monospace; margin-top: 4px; font-size: 0.7rem;
        }

        .debug-panel {
          position: absolute; bottom: 24px; right: 24px; z-index: 10;
          background: rgba(3,3,15,0.88);
          padding: 1rem 1.4rem; border-radius: 12px;
          backdrop-filter: blur(16px); border: 1px solid rgba(0,242,255,0.2);
          display: flex; flex-direction: column; gap: 0.4rem; min-width: 180px;
        }

        .legend {
          position: absolute; top: 24px; right: 24px; z-index: 10;
          background: rgba(3,3,15,0.82);
          padding: 1rem 1.4rem; border-radius: 14px;
          backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.07);
          display: flex; flex-direction: column; gap: 0.45rem; min-width: 140px;
        }
        .legend-title {
          font-size: 0.62rem; letter-spacing: 0.12em; text-transform: uppercase;
          color: rgba(255,255,255,0.3); margin-bottom: 0.2rem;
        }
        .legend-item {
          display: flex; align-items: center; gap: 0.6rem;
          font-size: 0.76rem; color: rgba(255,255,255,0.82);
          font-family: 'JetBrains Mono', monospace;
        }
        .legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }

        .tooltip {
          background: rgba(3,3,22,0.96); color: white;
          padding: 10px 14px; border-radius: 8px; font-size: 11px;
          white-space: nowrap; pointer-events: none;
          border: 1px solid rgba(0,242,255,0.35);
          box-shadow: 0 0 22px rgba(0,242,255,0.12);
          font-family: 'JetBrains Mono', monospace;
          transform: translateY(-50%);
        }
        .tooltip-hash   { color: #00f2ff; font-weight: 600; margin-bottom: 3px; }
        .tooltip-branch { color: #aaaaff; font-size: 10px; margin-bottom: 3px; }
        .tooltip-msg    { color: rgba(255,255,255,0.8); margin-bottom: 3px; }
        .tooltip-refs   { color: #ffaa00; font-size: 10px; }
      `}</style>
    </div>
  );
}

export default App;
