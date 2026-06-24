const net = require('net');
const { WebSocket, WebSocketServer } = require('ws');
const config = require('./config');
const { resolveStreamTarget } = require('./container-resolver');

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, containerId, target) => {
  const tcp = net.createConnection(target.port, target.host, () => {
    console.log(`[audio] ${containerId} bridge open → :${target.port}`);
  });

  tcp.on('data', (chunk) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
  });

  ws.on('message', (data) => {
    if (!tcp.destroyed) tcp.write(data);
  });

  const cleanup = (source) => {
    console.log(`[audio] ${containerId} bridge closed (${source})`);
    if (!tcp.destroyed) tcp.destroy();
    if (ws.readyState === WebSocket.OPEN) ws.close();
  };

  tcp.on('close', () => cleanup('tcp'));
  tcp.on('error', (err) => { console.error(`[audio] tcp error: ${err.message}`); cleanup('tcp-error'); });
  ws.on('close', () => cleanup('ws'));
  ws.on('error', (err) => { console.error(`[audio] ws error: ${err.message}`); cleanup('ws-error'); });
});

async function handleAudioUpgrade(req, socket, head, containerId) {
  try {
    const target = await resolveStreamTarget(containerId, 'audio');
    if (!target) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, containerId, target);
    });
  } catch (err) {
    console.error(`[audio] resolve error: ${err.message}`);
    socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    socket.destroy();
  }
}

module.exports = { handleAudioUpgrade };
