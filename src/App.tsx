import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, extend } from '@react-three/fiber';
import { OrbitControls, Stars, Html, Text, Line, Float } from '@react-three/drei';
import { EffectComposer, Bloom, Noise, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RawCommit {
  hash: string;
  parents: string[];
  message: string;
  time: number;
  refs: string[];
}

interface CommitNode extends RawCommit {
  x: number;
  y: number;
  z: number;
  color: string;
  lane: number;
}

// ─── Mock Data (Multiple branches for demo) ───────────────────────────────────

const MOCK_COMMITS: RawCommit[] = [
  { hash: 'a1b2c3d4', parents: [],           message: 'Initial commit',            time: 1000, refs: ['main'] },
  { hash: 'b2c3d4e5', parents: ['a1b2c3d4'], message: 'Add README',                 time: 1100, refs: [] },
  { hash: 'c3d4e5f6', parents: ['b2c3d4e5'], message: 'Add project structure',       time: 1200, refs: [] },
  { hash: 'd4e5f6g7', parents: ['c3d4e5f6'], message: 'feat: setup express server',  time: 1300, refs: [] },
  // feature-a branches off b2c3d4e5
  { hash: 'e5f6g7h8', parents: ['b2c3d4e5'], message: 'feat: init feature-a',        time: 1150, refs: ['feature-a'] },
  { hash: 'f6g7h8i9', parents: ['e5f6g7h8'], message: 'feat: feature-a progress',    time: 1250, refs: [] },
  { hash: 'g7h8i9j0', parents: ['f6g7h8i9'], message: 'feat: feature-a complete',   time: 1350, refs: ['HEAD -> feature-a'] },
  // feature-b branches off c3d4e5f6
  { hash: 'h8i9j0k1', parents: ['c3d4e5f6'], message: 'feat: init feature-b',        time: 1220, refs: ['feature-b'] },
  { hash: 'i9j0k1l2', parents: ['h8i9j0k1'], message: 'feat: feature-b commit 2',   time: 1320, refs: [] },
  { hash: 'j0k1l2m3', parents: ['i9j0k1l2'], message: 'feat: feature-b complete',   time: 1420, refs: ['HEAD -> feature-b'] },
  // hotfix branches off d4e5f6g7
  { hash: 'k1l2m3n4', parents: ['d4e5f6g7'], message: 'hotfix: critical bug fix',   time: 1310, refs: ['hotfix', 'HEAD -> main'] },
];

// ─── Branch color palette ─────────────────────────────────────────────────────

const BRANCH_COLORS: Record<string, string> = {
  main:       '#00f2ff',  // Cyan
  'feature-a':'#ff00ff',  // Magenta
  'feature-b':'#ffaa00',  // Amber
  hotfix:     '#ff3366',  // Red
  default:    '#aaffaa',  // Green
};

function getColorForRefs(refs: string[]): string {
  for (const ref of refs) {
    for (const [branch, color] of Object.entries(BRANCH_COLORS)) {
      if (ref.includes(branch)) return color;
    }
  }
  return BRANCH_COLORS.default;
}

// ─── Layout algorithm ─────────────────────────────────────────────────────────

function buildLayout(commits: RawCommit[]): CommitNode[] {
  // Build parent → children map
  const commitMap: Record<string, RawCommit> = {};
  commits.forEach(c => { commitMap[c.hash] = c; });

  // Topological sort (BFS from roots)
  const inDegree: Record<string, number> = {};
  commits.forEach(c => { inDegree[c.hash] = 0; });
  commits.forEach(c => { c.parents.forEach(p => { inDegree[c.hash] = (inDegree[c.hash] || 0); }); });

  // Sort by timestamp for Y axis
  const sorted = [...commits].sort((a, b) => a.time - b.time);
  const timeMin = sorted[0]?.time ?? 0;

  // Assign lanes based on branch detection
  const laneMap: Record<string, number> = {};
  const branchLanes: Record<string, number> = { main: 0 };
  let nextLane = 1;

  const assigned: Record<string, number> = {};

  // Walk sorted commits and assign lanes
  sorted.forEach(commit => {
    let lane = 0;
    const branchRef = commit.refs.find(r => {
      for (const branch of Object.keys(BRANCH_COLORS)) {
        if (r.includes(branch) && branch !== 'main') return true;
      }
      return false;
    });

    if (branchRef) {
      const branchName = Object.keys(BRANCH_COLORS).find(b => branchRef.includes(b) && b !== 'main') ?? 'default';
      if (branchLanes[branchName] === undefined) {
        branchLanes[branchName] = nextLane++;
      }
      lane = branchLanes[branchName];
    } else {
      // Inherit parent lane
      for (const p of commit.parents) {
        if (assigned[p] !== undefined) {
          lane = assigned[p];
          break;
        }
      }
    }

    assigned[commit.hash] = lane;
  });

  return sorted.map((commit, i) => {
    const lane = assigned[commit.hash] ?? 0;
    return {
      ...commit,
      x: lane * 4,
      y: (commit.time - timeMin) * 0.03,
      z: 0,
      color: getColorForRefs(commit.refs.length > 0 ? commit.refs : sorted.find(c => c.hash === commit.hash)?.refs ?? []),
      lane,
    };
  });
}

// ─── Commit Cube Component ────────────────────────────────────────────────────

const CommitCube = ({ commit, allCommits }: { commit: CommitNode; allCommits: CommitNode[] }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  const isHead = commit.refs.some(r => r.includes('HEAD'));
  const color = commit.color;

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.2;
      if (hovered) meshRef.current.rotation.y += delta * 1.5;
    }
  });

  return (
    <group position={[commit.x, commit.y, commit.z]}>
      <mesh
        ref={meshRef}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        scale={hovered ? 1.4 : isHead ? 1.2 : 1}
      >
        <boxGeometry args={[0.5, 0.5, 0.5]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hovered ? 8 : isHead ? 4 : 1.5}
          metalness={0.8}
          roughness={0.2}
        />
      </mesh>

      {/* Tooltip on hover */}
      {hovered && (
        <Html distanceFactor={15} style={{ pointerEvents: 'none' }}>
          <div className="tooltip">
            <div className="tooltip-hash">{commit.hash.substring(0, 7)}</div>
            <div className="tooltip-msg">{commit.message}</div>
            {commit.refs.length > 0 && (
              <div className="tooltip-refs">{commit.refs.join(' • ')}</div>
            )}
          </div>
        </Html>
      )}

      {/* Branch label above HEAD commits */}
      {commit.refs.filter(r => r.length > 0).map((ref, i) => (
        <Text
          key={ref}
          position={[0, 0.6 + i * 0.3, 0]}
          fontSize={0.22}
          color={color}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#000000"
        >
          {ref.replace('HEAD -> ', '⬤ ')}
        </Text>
      ))}
    </group>
  );
};

// ─── Connection Line Component ────────────────────────────────────────────────

const ConnectionLine = ({
  start,
  end,
  color,
}: {
  start: [number, number, number];
  end: [number, number, number];
  color: string;
}) => {
  const points = useMemo(
    () => [new THREE.Vector3(...start), new THREE.Vector3(...end)],
    [start, end]
  );

  return (
    <Line
      points={points}
      color={color}
      lineWidth={1.5}
      transparent
      opacity={0.5}
    />
  );
};

// ─── Scene ────────────────────────────────────────────────────────────────────

const Scene = ({ commits }: { commits: CommitNode[] }) => {
  const commitMap = useMemo(() => {
    const m: Record<string, CommitNode> = {};
    commits.forEach(c => { m[c.hash] = c; });
    return m;
  }, [commits]);

  return (
    <>
      {commits.map(commit => (
        <CommitCube key={commit.hash} commit={commit} allCommits={commits} />
      ))}
      {commits.map(commit =>
        commit.parents.map(parentHash => {
          const parent = commitMap[parentHash];
          if (!parent) return null;
          return (
            <ConnectionLine
              key={`${commit.hash}-${parentHash}`}
              start={[commit.x, commit.y, commit.z]}
              end={[parent.x, parent.y, parent.z]}
              color={commit.color}
            />
          );
        })
      )}
    </>
  );
};

// ─── Legend ───────────────────────────────────────────────────────────────────

const Legend = ({ commits }: { commits: CommitNode[] }) => {
  const branches = useMemo(() => {
    const seen = new Set<string>();
    const result: { name: string; color: string }[] = [];
    commits.forEach(c => {
      c.refs.forEach(ref => {
        const branchName = ref.replace('HEAD -> ', '');
        if (!seen.has(branchName) && branchName.length > 0) {
          seen.add(branchName);
          result.push({ name: branchName, color: c.color });
        }
      });
    });
    return result;
  }, [commits]);

  return (
    <div className="legend">
      {branches.map(b => (
        <div key={b.name} className="legend-item">
          <div className="legend-dot" style={{ background: b.color, boxShadow: `0 0 8px ${b.color}` }} />
          <span>{b.name}</span>
        </div>
      ))}
    </div>
  );
};

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  const [commitCount, setCommitCount] = useState(0);

  const processedCommits = useMemo(() => {
    const layout = buildLayout(MOCK_COMMITS);
    setCommitCount(layout.length);
    return layout;
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      {/* Header Overlay */}
      <div className="overlay">
        <h1>🌌 Git Multiverse 3D</h1>
        <p className="status">
          {commitCount} commits across {new Set(processedCommits.map(c => c.lane)).size} branches
        </p>
        <p className="hint">Drag to orbit · Scroll to zoom · Hover a node for details</p>
      </div>

      {/* Legend */}
      <Legend commits={processedCommits} />

      {/* 3D Canvas */}
      <Canvas camera={{ position: [12, 8, 18], fov: 55 }}>
        <color attach="background" args={['#050508']} />
        <ambientLight intensity={0.3} />
        <pointLight position={[10, 20, 10]} intensity={2} color="#00f2ff" />
        <pointLight position={[-10, -20, -10]} intensity={1} color="#ff00ff" />

        <Stars radius={150} depth={60} count={6000} factor={4} saturation={0} fade speed={0.5} />

        {/* Subtle grid floor */}
        <gridHelper args={[40, 40, '#111133', '#111133']} position={[0, -1, 0]} />

        <Scene commits={processedCommits} />

        <OrbitControls
          enableDamping
          dampingFactor={0.06}
          minDistance={5}
          maxDistance={60}
          autoRotate
          autoRotateSpeed={0.4}
        />

        <EffectComposer>
          <Bloom
            luminanceThreshold={0.5}
            mipmapBlur
            intensity={2}
            radius={0.5}
          />
          <Noise opacity={0.04} />
          <Vignette eskil={false} offset={0.1} darkness={1.1} />
        </EffectComposer>
      </Canvas>

      {/* Inline CSS for tooltip & legend */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=JetBrains+Mono&display=swap');
        * { box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; }
        .overlay {
          position: absolute;
          top: 24px;
          left: 24px;
          z-index: 10;
          background: rgba(5, 5, 15, 0.7);
          padding: 1.2rem 1.6rem;
          border-radius: 14px;
          backdrop-filter: blur(14px);
          border: 1px solid rgba(0, 242, 255, 0.2);
          pointer-events: none;
          max-width: 280px;
        }
        h1 {
          font-size: 1.1rem;
          margin: 0 0 0.3rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #00f2ff;
          text-shadow: 0 0 12px rgba(0, 242, 255, 0.6);
        }
        .status {
          font-size: 0.78rem;
          color: rgba(255,255,255,0.7);
          margin: 0 0 0.2rem;
          font-family: 'JetBrains Mono', monospace;
        }
        .hint {
          font-size: 0.7rem;
          color: rgba(255,255,255,0.35);
          margin: 0;
        }
        .legend {
          position: absolute;
          top: 24px;
          right: 24px;
          z-index: 10;
          background: rgba(5, 5, 15, 0.7);
          padding: 1rem 1.4rem;
          border-radius: 14px;
          backdrop-filter: blur(14px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .legend-item {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          font-size: 0.78rem;
          color: rgba(255,255,255,0.8);
          font-family: 'JetBrains Mono', monospace;
        }
        .legend-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .tooltip {
          background: rgba(5, 5, 20, 0.92);
          color: white;
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 11px;
          white-space: nowrap;
          pointer-events: none;
          border: 1px solid rgba(0, 242, 255, 0.4);
          box-shadow: 0 0 20px rgba(0, 242, 255, 0.15);
          font-family: 'JetBrains Mono', monospace;
        }
        .tooltip-hash {
          color: #00f2ff;
          font-weight: 600;
          margin-bottom: 4px;
          letter-spacing: 0.05em;
        }
        .tooltip-msg {
          color: rgba(255,255,255,0.8);
          margin-bottom: 4px;
        }
        .tooltip-refs {
          color: #ffaa00;
          font-size: 10px;
        }
      `}</style>
    </div>
  );
}

export default App;
