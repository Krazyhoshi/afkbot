'use strict';

const express = require('express');
const path = require('path');
const net = require('net');
const mineflayer = require('mineflayer');

const app = express();
const PORT = Number(process.env.DASHBOARD_PORT || 3000);
const HOST = '127.0.0.1';

// Keep the dashboard restricted to your own computer.
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));

let activeBot = null;
let currentStatus = 'disconnected';
let currentConfig = null;
let connectedAt = null;
let lastPosition = null;
let stoppingByUser = false;
let logs = [];

function addLog(message, type = 'info') {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    time: new Date().toLocaleTimeString(),
    message: String(message).slice(0, 500),
    type
  };

  logs.push(entry);

  if (logs.length > 160) {
    logs = logs.slice(-160);
  }

  console.log(`[${entry.time}] ${type.toUpperCase()}: ${entry.message}`);
}

function parseServerAddress(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error(
      'Enter a server address, such as play.example.net:25565.'
    );
  }

  const value = raw.trim();

  if (/[\s/\\?#@]/.test(value) || value.includes('://')) {
    throw new Error(
      'Enter only a hostname or IP address, optionally followed by :port.'
    );
  }

  let host = value;
  let port = 25565;

  // IPv6 format: [2001:db8::1]:25565
  if (value.startsWith('[')) {
    const match = value.match(/^\[([0-9a-fA-F:]+)\](?::(\d+))?$/);

    if (!match || net.isIP(match[1]) !== 6) {
      throw new Error('Invalid IPv6 address. Use [address]:port format.');
    }

    host = match[1];

    if (match[2]) {
      port = Number(match[2]);
    }
  } else {
    const colonCount = (value.match(/:/g) || []).length;

    if (colonCount === 1) {
      const splitAt = value.lastIndexOf(':');
      const possiblePort = value.slice(splitAt + 1);

      if (!/^\d+$/.test(possiblePort)) {
        throw new Error('The port must be a number, such as 25565.');
      }

      host = value.slice(0, splitAt);
      port = Number(possiblePort);
    } else if (colonCount > 1) {
      if (net.isIP(value) !== 6) {
        throw new Error('Invalid IPv6 address.');
      }

      host = value;
    }
  }

  if (!host || host.length > 253) {
    throw new Error('The server hostname is invalid.');
  }

  const isIPv6 = net.isIP(host) === 6;
  const isIPv4 = net.isIP(host) === 4;

  const hostnameValid =
    /^[a-zA-Z0-9.-]+$/.test(host) &&
    !host.startsWith('.') &&
    !host.endsWith('.') &&
    !host.includes('..');

  if (!isIPv4 && !isIPv6 && !hostnameValid) {
    throw new Error('The server hostname or IP address is invalid.');
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Port must be between 1 and 65535.');
  }

  return { host, port };
}

// Versions offered by the dashboard.
// Actual support depends on the installed Mineflayer protocol libraries.
const ALLOWED_VERSIONS = new Set([
  'auto',
  '1.8',
  '1.9',
  '1.10',
  '1.11',
  '1.12',
  '1.13',
  '1.14',
  '1.15',
  '1.16',
  '1.17',
  '1.18',
  '1.19',
  '1.20',
  '1.21',
  '1.21.9',
  '1.21.11',
  '26.1'
]);

function getStatus() {
  const uptime =
    connectedAt && currentStatus === 'connected'
      ? Math.max(
          0,
          Math.floor((Date.now() - connectedAt) / 1000)
        )
      : 0;

  return {
    status: currentStatus,
    config: currentConfig
      ? {
          serverAddress: currentConfig.serverAddress,
          host: currentConfig.host,
          port: currentConfig.port,
          username: currentConfig.username,
          version: currentConfig.version,
          auth: currentConfig.auth
        }
      : null,
    uptime,
    position: lastPosition,
    logs: logs.slice(-100)
  };
}

// Return the latest status and event logs.
app.get('/api/status', (_req, res) => {
  res.json(getStatus());
});

// Start a Minecraft bot.
app.post('/api/connect', (req, res) => {
  if (
    activeBot ||
    currentStatus === 'connecting' ||
    currentStatus === 'connected'
  ) {
    return res.status(409).json({
      error: 'A bot is already connecting or connected. Stop it first.'
    });
  }

  try {
    const { host, port } = parseServerAddress(
      req.body?.serverAddress
    );

    const username =
      typeof req.body?.username === 'string'
        ? req.body.username.trim()
        : '';

    const auth = req.body?.auth;
    const version = req.body?.version || 'auto';

    if (!username || username.length > 100) {
      throw new Error('Enter a valid bot username or account email.');
    }

    if (!['offline', 'microsoft'].includes(auth)) {
      throw new Error('Choose a valid login method.');
    }

    if (!ALLOWED_VERSIONS.has(version)) {
      throw new Error('Choose a Minecraft version from the list.');
    }

    currentConfig = {
      serverAddress: req.body.serverAddress.trim(),
      host,
      port,
      username,
      auth,
      version
    };

    currentStatus = 'connecting';
    connectedAt = null;
    lastPosition = null;
    stoppingByUser = false;

    addLog(
      `Connecting to ${host}:${port} using ${
        version === 'auto'
          ? 'automatic version detection'
          : `Minecraft ${version}`
      }...`
    );

    if (auth === 'microsoft') {
      addLog(
        'Complete the Microsoft sign-in prompt in this terminal if requested.'
      );
    } else {
      addLog(
        'Offline login selected. The server must allow offline-mode players.'
      );
    }

    const options = {
      host,
      port,
      username,
      auth,
      version: version === 'auto' ? false : version,
      hideErrors: true
    };

    const bot = mineflayer.createBot(options);
    activeBot = bot;

    bot.once('login', () => {
      if (activeBot !== bot) return;

      currentStatus = 'connecting';
      addLog('Login accepted. Waiting for the world to load...');
    });

    bot.once('spawn', () => {
      if (activeBot !== bot) return;

      currentStatus = 'connected';
      connectedAt = Date.now();

      if (bot.entity?.position) {
        const pos = bot.entity.position;

        lastPosition = {
          x: Number(pos.x.toFixed(2)),
          y: Number(pos.y.toFixed(2)),
          z: Number(pos.z.toFixed(2))
        };
      }

      addLog(
        `Connected as ${bot.username}. AFK mode is active.`,
        'success'
      );
    });

    bot.on('move', () => {
      if (activeBot !== bot || !bot.entity?.position) return;

      const pos = bot.entity.position;

      lastPosition = {
        x: Number(pos.x.toFixed(2)),
        y: Number(pos.y.toFixed(2)),
        z: Number(pos.z.toFixed(2))
      };
    });

    bot.on('kicked', (reason) => {
      if (activeBot !== bot) return;

      let readable = reason;

      try {
        if (typeof reason === 'string') {
          const parsed = JSON.parse(reason);
          readable = parsed.text || parsed.translate || reason;
        } else if (reason && typeof reason === 'object') {
          readable =
            reason.text ||
            reason.translate ||
            JSON.stringify(reason);
        }
      } catch {
        // Keep the original reason if it is not JSON.
      }

      addLog(`Server kicked the bot: ${String(readable)}`, 'error');
    });

    bot.on('error', (error) => {
      if (activeBot !== bot) return;

      addLog(
        `Connection error: ${error?.message || String(error)}`,
        'error'
      );

      if (currentStatus !== 'connected') {
        currentStatus = 'error';
      }
    });

    bot.once('end', (reason) => {
      if (activeBot !== bot) return;

      activeBot = null;
      connectedAt = null;
      lastPosition = null;
      currentStatus = 'disconnected';

      if (stoppingByUser) {
        addLog('Bot stopped.');
      } else {
        addLog(
          `Bot disconnected${reason ? ` (${String(reason)})` : ''}.`,
          'error'
        );
      }

      stoppingByUser = false;
    });

    return res.json({
      ok: true,
      message: 'Connection attempt started.'
    });
  } catch (error) {
    currentStatus = 'disconnected';
    activeBot = null;

    addLog(error.message || 'Could not start the bot.', 'error');

    return res.status(400).json({
      error: error.message || 'Could not start the bot.'
    });
  }
});

// Stop the active bot.
app.post('/api/disconnect', (_req, res) => {
  if (!activeBot) {
    currentStatus = 'disconnected';
    connectedAt = null;

    return res.json({
      ok: true,
      message: 'No active bot.'
    });
  }

  stoppingByUser = true;
  currentStatus = 'disconnected';
  connectedAt = null;

  addLog('Disconnect requested...');

  const bot = activeBot;

  try {
    bot.quit('Stopped from AFK dashboard');
  } catch (error) {
    addLog(`Disconnect note: ${error.message}`, 'error');

    if (activeBot === bot) {
      activeBot = null;
    }

    stoppingByUser = false;
  }

  return res.json({
    ok: true,
    message: 'Disconnect requested.'
  });
});

// Clear dashboard logs.
app.post('/api/clear-logs', (_req, res) => {
  logs = [];
  addLog('Log cleared.');
  res.json({ ok: true });
});

// Start the local dashboard.
app.listen(PORT, HOST, () => {
  console.log(
    `Minecraft AFK Dashboard running at http://${HOST}:${PORT}`
  );

  console.log(
    'Keep this terminal open while using the dashboard. Press CTRL+C to exit.'
  );
});