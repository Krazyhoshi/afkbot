'use strict';

const form = document.querySelector('#connect-form');
const connectButton = document.querySelector('#connect-button');
const disconnectButton = document.querySelector('#disconnect-button');
const message = document.querySelector('#form-message');
const statusIndicator = document.querySelector('#status-indicator');
const statusLabel = document.querySelector('#status-label');
const usernameInput = document.querySelector('#bot-username');
const serverInput = document.querySelector('#server-address');
const versionSelect = document.querySelector('#mc-version');
const logsList = document.querySelector('#logs-list');
const logCount = document.querySelector('#log-count');
const authHint = document.querySelector('#auth-hint');
const authOptions = [...document.querySelectorAll('.auth-option')];

let renderedLogIds = new Set();
let polling = false;

function selectedAuth() {
  return document.querySelector(
    'input[name="auth"]:checked'
  )?.value || 'offline';
}

function setMessage(text = '', type = '') {
  message.textContent = text;
  message.className = `form-message ${type}`.trim();
}

function setBusy(isBusy) {
  connectButton.disabled = isBusy;

  connectButton.querySelector('span:nth-child(2)').textContent =
    isBusy ? 'Connecting…' : 'Start bot';

  disconnectButton.disabled = !isBusy;
}

function formatUptime(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(seconds / 3600)
    .toString().padStart(2, '0');
  const minutes = Math.floor((seconds % 3600) / 60)
    .toString().padStart(2, '0');
  const remaining = Math.floor(seconds % 60)
    .toString().padStart(2, '0');

  return `${hours}:${minutes}:${remaining}`;
}

function safeText(element, value) {
  element.textContent =
    value == null || value === '' ? '—' : String(value);
}

function renderLogs(logs) {
  const entries = Array.isArray(logs) ? logs : [];

  logCount.textContent =
    `${entries.length} EVENT${entries.length === 1 ? '' : 'S'}`;

  if (entries.length === 0) {
    logsList.innerHTML = `
      <div class="empty-logs">
        <span class="empty-log-mark">⌁</span>
        <span>No events yet. Start the bot to see activity here.</span>
      </div>
    `;

    renderedLogIds = new Set();
    return;
  }

  // Use textContent for log messages rather than inserting user-provided HTML.
  const fragment = document.createDocumentFragment();

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = `log-row ${entry.type || 'info'}`;

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = entry.time || '--:--:--';

    const marker = document.createElement('span');
    marker.className = 'log-marker';

    marker.textContent =
      entry.type === 'error' ? '×' :
      entry.type === 'success' ? '✓' :
      entry.type === 'warn' ? '!' : '›';

    const text = document.createElement('span');
    text.className = 'log-message';
    text.textContent = entry.message || '';

    row.append(time, marker, text);
    fragment.append(row);
  }

  logsList.replaceChildren(fragment);
  logsList.scrollTop = logsList.scrollHeight;

  renderedLogIds = new Set(entries.map(entry => entry.id));
}

function renderStatus(data) {
  const state = data.status || 'disconnected';

  statusIndicator.className = 'status-indicator';

  if (state === 'connected') {
    statusIndicator.classList.add('status-on');
    statusLabel.textContent = 'CONNECTED';
  } else if (state === 'connecting') {
    statusIndicator.classList.add('status-wait');
    statusLabel.textContent = 'CONNECTING';
  } else if (state === 'error') {
    statusIndicator.classList.add('status-error');
    statusLabel.textContent = 'ERROR';
  } else {
    statusIndicator.classList.add('status-off');
    statusLabel.textContent = 'OFFLINE';
  }

  const config = data.config;

  if (config) {
    safeText(
      document.querySelector('#overview-username'),
      config.username
    );

    safeText(
      document.querySelector('#overview-server'),
      `${config.host}:${config.port}`
    );

    safeText(
      document.querySelector('#overview-version'),
      `VERSION · ${config.version === 'auto' ? 'AUTO-DETECT' : config.version}`
    );
  } else {
    safeText(
      document.querySelector('#overview-username'),
      usernameInput.value.trim() || 'AFK_Bot'
    );

    safeText(
      document.querySelector('#overview-server'),
      'Not connected to a server'
    );

    safeText(
      document.querySelector('#overview-version'),
      `VERSION · ${
        versionSelect.value === 'auto' ? 'AUTO' : versionSelect.value
      }`
    );
  }

  safeText(
    document.querySelector('#uptime-value'),
    formatUptime(data.uptime)
  );

  if (data.position) {
    safeText(
      document.querySelector('#position-value'),
      `${data.position.x}, ${data.position.y}, ${data.position.z}`
    );
  } else {
    safeText(
      document.querySelector('#position-value'),
      '--, --, --'
    );
  }

  const note = document.querySelector('#status-note-text');
  const noteContainer = note.parentElement;

  noteContainer.classList.toggle('active', state === 'connected');

  const notes = {
    disconnected:
      'Waiting for configuration. Your bot is currently not in-game.',
    connecting:
      'Attempting to join the server. Authentication or world loading may take a moment.',
    connected:
      'The bot is in-game and standing idle. Session is running.',
    error:
      'A connection error occurred. Check the logs below for details.'
  };

  note.textContent = notes[state] || notes.disconnected;

  setBusy(
    state === 'connecting' ||
    state === 'connected' ||
    state === 'error'
  );

  if (state === 'connected') {
    connectButton.querySelector('span:nth-child(2)').textContent =
      'Bot connected';

    connectButton.disabled = true;
  } else if (state === 'error') {
    connectButton.querySelector('span:nth-child(2)').textContent =
      'Connection error';

    connectButton.disabled = true;
    disconnectButton.disabled = false;
  } else if (state === 'disconnected') {
    connectButton.querySelector('span:nth-child(2)').textContent =
      'Start bot';

    connectButton.disabled = false;
    disconnectButton.disabled = true;
  }
}

async function refreshStatus() {
  if (polling) return;

  polling = true;

  try {
    const response = await fetch('/api/status', {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error('Status request failed.');
    }

    const data = await response.json();

    renderStatus(data);

    if (
      !data.logs?.length ||
      data.logs.some(entry => !renderedLogIds.has(entry.id))
    ) {
      renderLogs(data.logs || []);
    }
  } catch (error) {
    setMessage(
      'Cannot reach the dashboard server. Check the terminal.',
      'error'
    );
  } finally {
    polling = false;
  }
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }

  return data;
}

// Start the bot when the form is submitted.
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('');

  connectButton.disabled = true;
  connectButton.querySelector('span:nth-child(2)').textContent =
    'Starting…';

  const payload = {
    serverAddress: serverInput.value.trim(),
    username: usernameInput.value.trim(),
    version: versionSelect.value,
    auth: selectedAuth()
  };

  try {
    const result = await postJson('/api/connect', payload);

    setMessage(
      result.message || 'Connection attempt started.',
      'success'
    );

    await refreshStatus();
  } catch (error) {
    setMessage(error.message, 'error');
    await refreshStatus();
  }
});

// Stop the bot.
disconnectButton.addEventListener('click', async () => {
  disconnectButton.disabled = true;
  setMessage('Sending stop request…');

  try {
    const result = await postJson('/api/disconnect');

    setMessage(result.message || 'Disconnect requested.');
    await refreshStatus();
  } catch (error) {
    setMessage(error.message, 'error');
  }
});

// Clear the dashboard logs.
document.querySelector('#clear-logs-button')
  .addEventListener('click', async () => {
    try {
      await postJson('/api/clear-logs');
      await refreshStatus();
    } catch (error) {
      setMessage(error.message, 'error');
    }
  });

// Update the selected login method and explanatory text.
for (const option of authOptions) {
  const radio = option.querySelector('input');

  radio.addEventListener('change', () => {
    authOptions.forEach(item => {
      item.classList.toggle(
        'selected',
        item.querySelector('input').checked
      );
    });

    authHint.textContent = radio.value === 'microsoft'
      ? 'Use your Microsoft account email. Complete the sign-in prompt in the terminal. Never enter your password here.'
      : 'Offline login only works when the server permits offline-mode players.';
  });
}

// Preview the selected username and version before connecting.
usernameInput.addEventListener('input', () => {
  if (
    !document.querySelector('#overview-server')
      .textContent.includes(':')
  ) {
    safeText(
      document.querySelector('#overview-username'),
      usernameInput.value.trim() || 'AFK_Bot'
    );
  }
});

versionSelect.addEventListener('change', () => {
  if (
    !document.querySelector('#overview-server')
      .textContent.includes(':')
  ) {
    safeText(
      document.querySelector('#overview-version'),
      `VERSION · ${
        versionSelect.value === 'auto'
          ? 'AUTO'
          : versionSelect.value
      }`
    );
  }
});

// Load status immediately, then poll once per second.
refreshStatus();
setInterval(refreshStatus, 1000);