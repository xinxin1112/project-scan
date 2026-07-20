const { execSync } = require('child_process');
const path = require('path');

function runCypher(sourcePath, query, repo) {
  const args = ['cypher', JSON.stringify(query)];
  if (repo) args.push('--repo=' + repo);
  const cmd = `gitnexus ${args.join(' ')} 2>/dev/null`;
  try {
    const stdout = execSync(cmd, { cwd: sourcePath, timeout: 30000, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout.trim());
  } catch (e) {
    return null;
  }
}

function parseRouteNodes(rows) {
  if (!rows || !Array.isArray(rows)) return [];
  return rows.map(row => {
    const r = typeof row === 'string' ? JSON.parse(row) : (row.r || row);
    return {
      id: r.id || '',
      name: r.name || '',
      method: r.method || 'GET',
      filePath: r.filePath || '',
      handlerSymbolId: r.handlerSymbolId || ''
    };
  });
}

function groupRoutesByController(routes) {
  const groups = new Map();
  for (const route of routes) {
    const key = route.filePath;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(route);
  }
  return groups;
}

function extractClassNameFromPath(filePath) {
  const match = filePath.match(/([A-Z]\w+)\.java$/);
  return match ? match[1] : null;
}

function extractMethodName(handlerSymbolId) {
  const match = handlerSymbolId.match(/\.(\w+)#\d+$/);
  return match ? match[1] : '';
}

function extractBasePath(routes) {
  if (routes.length === 0) return '';
  const paths = routes.map(r => r.name).filter(Boolean);
  if (paths.length === 0) return '';
  const segments = paths[0].split('/').filter(Boolean);
  let common = '';
  for (let i = 0; i < segments.length - 1; i++) {
    const candidate = '/' + segments.slice(0, i + 1).join('/');
    if (paths.every(p => p.startsWith(candidate + '/'))) {
      common = candidate;
    } else {
      break;
    }
  }
  return common;
}

function routesToControllerFormat(filePath, routes) {
  const className = extractClassNameFromPath(filePath);
  if (!className) return null;

  const basePath = extractBasePath(routes);

  const endpoints = routes.map(route => {
    const endpointPath = route.name;
    const methodName = extractMethodName(route.handlerSymbolId);
    return {
      httpMethod: route.method.toUpperCase(),
      path: endpointPath,
      methodName,
      returnType: '',
      params: '',
      comment: '',
      line: 0
    };
  });

  return {
    className,
    basePath,
    comment: null,
    endpoints,
    sourcePath: filePath
  };
}

function extractFromGraph(sourcePath, options = {}) {
  const { repo } = options;
  const BATCH_SIZE = 50;

  const countResult = runCypher(sourcePath, 'MATCH (r:Route) RETURN count(r) as count', repo);
  if (!countResult || countResult.row_count === 0) return null;

  const countRow = countResult.markdown?.match(/\| (\d+) \|/);
  if (!countRow || parseInt(countRow[1]) === 0) return null;

  const totalRoutes = parseInt(countRow[1]);
  const allRoutes = [];

  for (let skip = 0; skip < totalRoutes; skip += BATCH_SIZE) {
    const query = `MATCH (r:Route) RETURN r.name, r.method, r.filePath, r.handlerSymbolId SKIP ${skip} LIMIT ${BATCH_SIZE}`;
    const batchResult = runCypher(sourcePath, query, repo);
    if (!batchResult || !batchResult.markdown) {
      if (skip === 0) return null;
      break;
    }

    const rawRows = batchResult.markdown
      .split('\n')
      .slice(2)
      .map(line => line.replace(/^\| /, '').replace(/ \|$/, '').trim())
      .filter(Boolean);

    // Detect possible 64KB truncation
    const rawOutput = batchResult.markdown;
    if (rawOutput.length >= 65000 && rawRows.length < BATCH_SIZE) {
      console.error(`[WARN] gitnexus output may be truncated at ${rawOutput.length} bytes (SKIP ${skip}), reducing batch`);
    }

    for (const row of rawRows) {
      const cols = row.split(' | ').map(c => c.trim());
      if (cols.length >= 4) {
        allRoutes.push({
          name: cols[0],
          method: cols[1] || 'GET',
          filePath: cols[2],
          handlerSymbolId: cols[3] || '',
          id: `Route:${cols[1]} ${cols[0]}`
        });
      }
    }
  }

  if (allRoutes.length === 0) return null;

  const grouped = groupRoutesByController(allRoutes);
  const controllers = [];

  for (const [filePath, fileRoutes] of grouped) {
    const controller = routesToControllerFormat(filePath, fileRoutes);
    if (controller && controller.endpoints.length > 0) {
      controllers.push(controller);
    }
  }

  return controllers;
}

module.exports = {
  extractFromGraph,
  parseRouteNodes,
  groupRoutesByController,
  extractClassNameFromPath,
  extractMethodName,
  extractBasePath,
  routesToControllerFormat
};
