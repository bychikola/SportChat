/* REST + WebSocket транспорт */

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch { /* пустой ответ */ }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/** WS с автопереподключением; onMessage(msg), onState(connected:boolean) */
export function connectWs({ onMessage, onState }) {
  let ws = null;
  let closedByUser = false;
  let retry = 0;
  let wasConnected = false;

  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      const first = !wasConnected;
      wasConnected = true;
      retry = 0;
      onState(true, first);
    };
    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data));
      } catch { /* мусорный кадр */ }
    };
    ws.onclose = () => {
      onState(false);
      if (closedByUser) return;
      retry += 1;
      setTimeout(open, Math.min(800 * retry, 5000));
    };
    ws.onerror = () => ws.close();
  };

  open();

  return {
    send(obj) {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
    },
    close() {
      closedByUser = true;
      ws?.close();
    },
  };
}
