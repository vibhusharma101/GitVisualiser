import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import simpleGit from 'simple-git';
import chokidar from 'chokidar';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

const git = simpleGit(process.cwd());

async function getGitData() {
  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return { error: 'Not a git repository' };

    // Step 1: Get all LOCAL branch names + their tip hashes
    const refOut = await git.raw([
      'for-each-ref',
      '--format=%(refname:short)|%(objectname)',
      'refs/heads/',
    ]);

    const localBranches: { name: string; tipHash: string }[] = refOut
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [name, tipHash] = line.split('|');
        return { name: name.trim(), tipHash: tipHash.trim() };
      });

    console.log('[git-3d] Local branches:', localBranches.map(b => b.name).join(', '));

    if (!localBranches.length) return { commits: [], branches: [] };

    // Step 2: Get ALL commits from the full log
    const logOut = await git.raw([
      'log', '--all',
      '--format=%H|%P|%s|%at|%D',
    ]);

    if (!logOut.trim()) return { commits: [], branches: [] };

    interface RawCommit {
      hash: string;
      parents: string[];
      message: string;
      time: number;
      refs: string[];
    }

    const allCommits: RawCommit[] = logOut
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const parts = line.split('|');
        const hash = parts[0]?.trim() ?? '';
        const parents = parts[1]?.trim() ? parts[1].trim().split(' ').filter(Boolean) : [];
        const message = parts[2]?.trim() ?? '';
        const time = parseInt(parts[3]?.trim() ?? '0', 10);
        const refsRaw = parts[4]?.trim() ?? '';
        const refs = refsRaw ? refsRaw.split(',').map(r => r.trim()).filter(Boolean) : [];
        return { hash, parents, message, time, refs };
      });

    // Build fast lookup
    const commitMap = new Map<string, RawCommit>();
    allCommits.forEach(c => commitMap.set(c.hash, c));

    // Step 3: For each branch, find commits REACHABLE from its tip
    // We do this by walking the ancestor chain from each tip
    const branchReachable = new Map<string, Set<string>>();
    for (const branch of localBranches) {
      const reachable = new Set<string>();
      const queue = [branch.tipHash];
      while (queue.length) {
        const h = queue.shift()!;
        // Support abbreviated hashes from for-each-ref
        const fullHash = allCommits.find(c => c.hash.startsWith(h))?.hash ?? h;
        if (reachable.has(fullHash)) continue;
        reachable.add(fullHash);
        const commit = commitMap.get(fullHash);
        if (commit) commit.parents.forEach(p => queue.push(p));
      }
      branchReachable.set(branch.name, reachable);
    }

    // Step 4: For each commit, find its MOST SPECIFIC branch
    // A commit belongs to a branch if:
    //   a) The branch tip IS this commit (direct ownership), OR
    //   b) Fewest other branches also reach it (most exclusive)
    // Strategy: assign to the branch whose tip is CLOSEST in ancestry
    const hashToBranch = new Map<string, string>();
    const mainName = localBranches.find(b => b.name === 'main' || b.name === 'master')?.name ?? localBranches[0].name;

    for (const commit of allCommits) {
      // Which branches can reach this commit?
      const ownerBranches = localBranches.filter(b => {
        const reachable = branchReachable.get(b.name);
        return reachable?.has(commit.hash);
      });

      if (ownerBranches.length === 0) {
        hashToBranch.set(commit.hash, mainName);
      } else if (ownerBranches.length === 1) {
        // Only one branch reaches it → exclusively owned
        hashToBranch.set(commit.hash, ownerBranches[0].name);
      } else {
        // Multiple branches reach it → it's a shared ancestor
        // Assign to the branch whose TIP COMMIT is the CLOSEST DESCENDANT
        // i.e. find the branch where this commit is nearest to the tip
        // Simplification: prefer non-main branches if commit is also reachable by features
        // The commit is "shared history" → assign to main (it's the base)
        hashToBranch.set(commit.hash, mainName);
      }
    }

    // Step 5: Build enriched commits
    const enriched = allCommits.map(c => ({
      ...c,
      branchOwner: hashToBranch.get(c.hash) ?? mainName,
    }));

    console.log('[git-3d] Branch ownership:');
    const ownCount: Record<string, number> = {};
    enriched.forEach(c => {
      ownCount[c.branchOwner] = (ownCount[c.branchOwner] ?? 0) + 1;
    });
    console.log(JSON.stringify(ownCount, null, 2));

    return {
      commits: enriched,
      branches: localBranches.map(b => b.name),
    };
  } catch (err: any) {
    console.error('[git-3d] Error:', err.message);
    return { error: err.message };
  }
}

io.on('connection', async socket => {
  console.log('[git-3d] Client connected');
  const data = await getGitData();
  socket.emit('git-update', data);
});

// Watch .git folder for real-time updates
chokidar
  .watch(path.join(process.cwd(), '.git'), {
    ignored: /FETCH_HEAD|index\.lock/,
    persistent: true,
    ignoreInitial: true,
  })
  .on('all', async (event, filePath) => {
    const file = path.basename(filePath);
    console.log(`[git-3d] Change detected: ${event} → ${file}`);
    const data = await getGitData();
    io.emit('git-update', data);
  });

// Serve built frontend
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));

const PORT = process.env.PORT || 3002;
httpServer.listen(PORT, () => {
  console.log(`[git-3d] 🚀 Server at http://localhost:${PORT}`);
  console.log(`[git-3d] 📂 Watching: ${process.cwd()}`);
});
