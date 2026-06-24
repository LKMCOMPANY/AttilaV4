const http = require('http');
const config = require('./config');

const STREAM_TYPES = {
  video: 'tcp_port',
  touch: 'tcp_control_port',
  audio: 'tcp_audio_port',
};

let cache = { containers: new Map(), updatedAt: 0 };
const CACHE_TTL_MS = 3000;

function fetchContainers() {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `http://${config.apiHost}:${config.apiPort}/container_api/v1/list_names`,
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (json.code !== 200 || !json.data?.list) {
              return reject(new Error(`API error: ${json.msg}`));
            }
            const map = new Map();
            for (const c of json.data.list) {
              map.set(c.db_id, c);
            }
            cache = { containers: map, updatedAt: Date.now() };
            resolve(map);
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('API timeout')); });
  });
}

async function getContainers() {
  if (Date.now() - cache.updatedAt < CACHE_TTL_MS && cache.containers.size > 0) {
    return cache.containers;
  }
  return fetchContainers();
}

async function resolveStreamTarget(containerId, streamType) {
  const portField = STREAM_TYPES[streamType];
  if (!portField) return null;

  const containers = await getContainers();
  const container = containers.get(containerId);
  if (!container) return null;

  const port = container[portField];
  if (!port) return null;

  return { host: config.streamHost, port };
}

module.exports = { resolveStreamTarget, getContainers, STREAM_TYPES };
