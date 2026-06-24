const config = require('./config');
const { getContainers } = require('./container-resolver');

async function handleHealth(req, res) {
  try {
    const containers = await getContainers();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      containers: containers.size,
    }));
  } catch {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'degraded', error: 'api_unreachable' }));
  }
}

function isHealthCheck(url) {
  return url === config.healthPath;
}

module.exports = { handleHealth, isHealthCheck };
