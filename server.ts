import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { initDatabase } from './server/db.ts';
import { authRouter } from './server/routes/authRoutes.ts';
import { capsuleAndAiRouter } from './server/routes/capsuleAndAiRoutes.ts';
import { communityAndSkillRouter } from './server/routes/communityAndSkillRoutes.ts';
import { memoryMediaRouter } from './server/routes/memoryAndMediaRoutes.ts';
import { objectDreamAndSyncRouter } from './server/routes/objectDreamAndSyncRoutes.ts';
import { attachWebSocketServer } from './server/ws.ts';

async function startServer() {
  initDatabase();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'echo-memory-network' });
  });

  app.use('/api', authRouter);
  app.use('/api', memoryMediaRouter);
  app.use('/api', capsuleAndAiRouter);
  app.use('/api', communityAndSkillRouter);
  app.use('/api', objectDreamAndSyncRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const errObj = err as { type?: string; status?: number; statusCode?: number; message?: string };
    if (err instanceof SyntaxError && errObj?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Invalid JSON request body.' });
      return;
    }
    const rawStatus = errObj?.status ?? errObj?.statusCode;
    const status = typeof rawStatus === 'number' && rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;
    const message = err instanceof Error ? err.message : 'Internal server error.';
    res.status(status).json({ error: message });
  });

  const server = http.createServer(app);
  attachWebSocketServer(server);

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        allowedHosts: true,
        ws: { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build.');
      }
    });
  }

  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`ECHO server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ECHO server:', err);
  process.exit(1);
});
