import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { extractCookieToken, getUserFromToken } from './auth.ts';
import { db } from './db.ts';

interface ClientMeta {
  userId: string;
  exchangeIds: Set<string>;
}

const userSockets = new Map<string, Set<WebSocket>>();
const socketMeta = new WeakMap<WebSocket, ClientMeta>();

function bindAuthenticatedSocket(ws: WebSocket, userId: string): void {
  const existing = socketMeta.get(ws);
  if (existing) {
    userSockets.get(existing.userId)?.delete(ws);
  }

  const meta: ClientMeta = { userId, exchangeIds: existing?.exchangeIds ?? new Set() };
  socketMeta.set(ws, meta);
  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  userSockets.get(userId)!.add(ws);
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'auth:ok', userId }));
  }
}

export function attachWebSocketServer(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    try {
      const pathname = new URL(req.url || '/', 'http://localhost').pathname;
      if (pathname === '/ws') {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      }
    } catch {
      // Ignore malformed upgrade URLs
    }
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const cookieToken = extractCookieToken(req.headers.cookie);
    const cookieUser = getUserFromToken(cookieToken);
    if (cookieUser) {
      bindAuthenticatedSocket(ws, cookieUser.id);
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          token?: string;
          exchangeId?: string;
        };

        if (msg.type === 'auth' && typeof msg.token === 'string') {
          const user = getUserFromToken(msg.token);
          if (!user) {
            ws.send(JSON.stringify({ type: 'auth:error', error: 'Invalid session' }));
            ws.close(4001, 'Unauthorized');
            return;
          }

          bindAuthenticatedSocket(ws, user.id);
          return;
        }

        const meta = socketMeta.get(ws);
        if (!meta) return;

        if (msg.type === 'exchange:join' && typeof msg.exchangeId === 'string') {
          const ex = db
            .prepare('SELECT id, requester_id, recipient_id FROM skill_exchanges WHERE id = ?')
            .get(msg.exchangeId) as { id: string; requester_id: string; recipient_id: string } | undefined;
          if (ex && (ex.requester_id === meta.userId || ex.recipient_id === meta.userId)) {
            meta.exchangeIds.add(ex.id);
            ws.send(JSON.stringify({ type: 'exchange:joined', exchangeId: ex.id }));
          }
        }
      } catch {
        // Ignore malformed client frames
      }
    });

    ws.on('close', () => {
      const meta = socketMeta.get(ws);
      if (meta) {
        userSockets.get(meta.userId)?.delete(ws);
      }
    });
  });
}

export function broadcastToUser(userId: string, payload: Record<string, unknown>): void {
  const sockets = userSockets.get(userId);
  if (!sockets || sockets.size === 0) return;
  const serialized = JSON.stringify(payload);
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serialized);
    }
  }
}

export function broadcastExchangeMessage(
  requesterId: string,
  recipientId: string,
  exchangeId: string,
  messagePayload: Record<string, unknown>
): void {
  const frame = {
    type: 'exchange:message',
    exchangeId,
    message: messagePayload,
  };
  broadcastToUser(requesterId, frame);
  if (recipientId !== requesterId) {
    broadcastToUser(recipientId, frame);
  }
}

export function pushNotification(
  userId: string,
  notification: {
    id: string;
    type: string;
    title: string;
    body: string;
    linkModule: string;
    linkId?: string | null;
    createdAt: string;
  }
): void {
  broadcastToUser(userId, {
    type: 'notification:new',
    notification,
  });
}
