const config = require('./config');
const { getContainers } = require('./container-resolver');
const { version } = require('../package.json');

// Deployed proxy version, stamped from package.json. Exposed on /healthz so the
// fleet drift-checker (infra/boxes/scripts/check-drift.mjs) can verify every box
// runs the version currently in git — bump package.json on each proxy change.
async function handleHealth(req, res) {
  try {
    const containers = await getContainers();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      version,
      uptime: process.uptime(),
      containers: containers.size,
    }));
  } catch {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'degraded', version, error: 'api_unreachable' }));
  }
}

function isHealthCheck(url) {
  return url === config.healthPath;
}

module.exports = { handleHealth, isHealthCheck };
