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
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
});

const git = simpleGit(process.cwd());

async function getGitData() {
  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return { error: 'Not a git repository' };

    const log = await git.raw([
      'log',
      '--all',
      '--format=%H|%P|%s|%at|%d',
    ]);

    const commits = log.trim().split('\n').filter(Boolean).map(line => {
      const [hash, parents, message, time, refs] = line.split('|');
      return {
        hash,
        parents: parents ? parents.split(' ') : [],
        message,
        time: parseInt(time, 10),
        refs: refs ? refs.trim().replace(/[()]/g, '').split(', ') : [],
      };
    });

    return { commits };
  } catch (err: any) {
    return { error: err.message };
  }
}

io.on('connection', async (socket) => {
  console.log('Client connected');
  const initialData = await getGitData();
  socket.emit('git-update', initialData);
});

// Watch for git changes
const watcher = chokidar.watch(path.join(process.cwd(), '.git'), {
  ignored: /(^|[\/\\])\../,
  persistent: true,
});

watcher.on('all', async () => {
  console.log('Git change detected, updating clients...');
  const data = await getGitData();
  io.emit('git-update', data);
});

// Serve frontend in production
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
