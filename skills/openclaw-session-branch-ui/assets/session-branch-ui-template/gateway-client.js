const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const PROTOCOL_VERSION = 3;
const DEFAULT_URL = 'ws://127.0.0.1:18789';
const REQUEST_TIMEOUT_MS = 15000;

function parseLooseConfig(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return Function('return (' + raw + ')')();
}

function readGatewayRuntime() {
  const configPath = path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), '.openclaw', 'openclaw.json');
  let cfg = {};
  try {
    cfg = parseLooseConfig(configPath) || {};
  } catch {}

  const port = cfg.gateway?.port || 18789;
  const bind = cfg.gateway?.bind || 'loopback';
  const host = bind === 'loopback' ? '127.0.0.1' : '127.0.0.1';
  const mode = cfg.gateway?.auth?.mode || 'token';
  const token = process.env.OPENCLAW_GATEWAY_TOKEN || cfg.gateway?.auth?.token || '';
  const password = process.env.OPENCLAW_GATEWAY_PASSWORD || cfg.gateway?.auth?.password || '';
  const url = `ws://${host}:${port}`;
  return {
    url: process.env.OPENCLAW_GATEWAY_URL || url || DEFAULT_URL,
    mode,
    token,
    password,
  };
}

class GatewayWsClient {
  constructor() {
    this.socket = null;
    this.connectPromise = null;
    this.ready = false;
    this.pending = new Map();
    this.closed = false;
    this.challengeSeen = false;
    this.runtime = null;
    this.requestCounter = 0;
  }

  async request(method, params = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    await this.ensureConnected();
    const id = `req-${Date.now()}-${this.requestCounter += 1}`;
    const payload = { type: 'req', id, method, params };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Gateway request timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (message) => {
          clearTimeout(timeout);
          resolve(message.payload);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      try {
        this.socket.send(JSON.stringify(payload));
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async ensureConnected() {
    if (this.ready && this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.runtime = readGatewayRuntime();
    this.connectPromise = new Promise((resolve, reject) => {
      const ws = new WebSocket(this.runtime.url);
      this.socket = ws;
      this.ready = false;
      this.challengeSeen = false;

      const fail = (error) => {
        if (this.connectPromise) {
          this.connectPromise = null;
        }
        this.ready = false;
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const sendConnect = () => {
        const auth = {};
        if (this.runtime.mode === 'password' && this.runtime.password) {
          auth.password = this.runtime.password;
        } else if (this.runtime.token) {
          auth.token = this.runtime.token;
        }

        ws.send(JSON.stringify({
          type: 'req',
          id: 'connect',
          method: 'connect',
          params: {
            minProtocol: PROTOCOL_VERSION,
            maxProtocol: PROTOCOL_VERSION,
            client: {
              id: 'cli',
              version: 'session-branch-ui',
              platform: 'node',
              mode: 'cli',
            },
            role: 'operator',
            scopes: ['operator.read', 'operator.write'],
            auth,
          },
        }));
      };

      ws.onopen = () => {
        setTimeout(() => {
          if (!this.challengeSeen && !this.ready && ws.readyState === WebSocket.OPEN) {
            sendConnect();
          }
        }, 50);
      };

      ws.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }

        if (message.type === 'event' && message.event === 'connect.challenge') {
          this.challengeSeen = true;
          sendConnect();
          return;
        }

        if (message.type === 'res' && message.id === 'connect') {
          if (!message.ok) {
            fail(new Error(message.error?.message || 'Gateway connect failed'));
            try { ws.close(); } catch {}
            return;
          }
          this.ready = true;
          this.connectPromise = null;
          resolve();
          return;
        }

        if (message.type === 'res' && message.id && this.pending.has(message.id)) {
          const pending = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.ok) {
            pending.resolve(message);
          } else {
            pending.reject(new Error(message.error?.message || `Gateway method failed: ${message.id}`));
          }
        }
      };

      ws.onerror = () => {
        if (!this.ready) {
          fail(new Error('Gateway websocket error'));
        }
      };

      ws.onclose = () => {
        this.ready = false;
        this.connectPromise = null;
        this.socket = null;
        const pending = Array.from(this.pending.values());
        this.pending.clear();
        for (const item of pending) {
          item.reject(new Error('Gateway websocket closed'));
        }
      };
    });

    return this.connectPromise;
  }

  close() {
    this.closed = true;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      this.socket.close();
    }
    this.socket = null;
    this.ready = false;
    this.connectPromise = null;
  }
}

module.exports = {
  GatewayWsClient,
  readGatewayRuntime,
};
