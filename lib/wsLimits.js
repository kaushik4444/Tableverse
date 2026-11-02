'use strict';

// Small, testable guards around the three WebSocket resource limits.
function enqueueSocketMessage(ws, task, maxQueuedMessages) {
  if (ws.queueDepth >= maxQueuedMessages) {
    ws.close(1013, 'server busy');
    return false;
  }
  ws.queueDepth++;
  const run = (ws.queue || Promise.resolve()).catch(() => {}).then(task)
    .finally(() => { ws.queueDepth = Math.max(0, ws.queueDepth - 1); });
  ws.queue = run.catch(() => {});
  return true;
}

function createBoundedSerialQueue(maxPending) {
  let queue = Promise.resolve();
  let depth = 0;
  return {
    get depth() { return depth; },
    enqueue(task, onFull) {
      if (depth >= maxPending) {
        if (onFull) onFull();
        return Promise.resolve(false);
      }
      depth++;
      const run = queue.catch(() => {}).then(task).finally(() => { depth = Math.max(0, depth - 1); });
      queue = run.catch(() => {});
      return run;
    },
  };
}

function sendBounded(ws, value, maxBufferedBytes) {
  return sendBoundedText(ws, () => JSON.stringify(value), maxBufferedBytes);
}

/** Like sendBounded for text that is already JSON (the same room info goes to every player at a table, serialised once). */
function sendBoundedRaw(ws, text, maxBufferedBytes) {
  return sendBoundedText(ws, () => text, maxBufferedBytes);
}

function sendBoundedText(ws, toText, maxBufferedBytes) {
  if (!ws || ws.readyState !== 1) return false;
  if (ws.bufferedAmount > maxBufferedBytes) {
    ws.terminate();
    return false;
  }
  try {
    ws.send(toText(), (err) => { if (err) ws.terminate(); });
    return true;
  } catch {
    ws.terminate();
    return false;
  }
}

module.exports = { enqueueSocketMessage, createBoundedSerialQueue, sendBounded, sendBoundedRaw };
