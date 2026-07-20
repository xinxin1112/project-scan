/**
 * ContractMerger
 * Graph contract (mechanical facts, priority) + Regex contract (LM/comments, supplement) → merged output
 *
 * Merge rules:
 * - Graph wins on: endpoint paths, HTTP methods, method names (mechanical facts)
 * - Regex supplements: comments, params, return types (semantic info graph doesn't provide)
 * - Conflict: graph wins
 */

function normalizeEndpoints(endpoints) {
  return endpoints.map(ep => ({
    httpMethod: (ep.httpMethod || ep.method || 'GET').toUpperCase(),
    path: ep.path || '',
    methodName: ep.methodName || '',
    returnType: ep.returnType || '',
    params: ep.params || '',
    comment: ep.comment || '',
    line: ep.line || 0
  }));
}

function mergeControllers(graphController, regexController) {
  if (!graphController && !regexController) return null;
  if (!graphController) return regexController;
  if (!regexController) return graphController;

  const merged = {
    className: graphController.className || regexController.className,
    basePath: graphController.basePath || regexController.basePath,
    comment: regexController.comment || graphController.comment,
    endpoints: [],
    sourcePath: graphController.sourcePath || regexController.sourcePath
  };

  const graphEndpoints = normalizeEndpoints(graphController.endpoints || []);
  const regexEndpoints = normalizeEndpoints(regexController.endpoints || []);

  const regexByKey = new Map();
  for (const ep of regexEndpoints) {
    const key = `${ep.httpMethod}:${ep.path}`;
    regexByKey.set(key, ep);
  }

  for (const gep of graphEndpoints) {
    const key = `${gep.httpMethod}:${gep.path}`;
    const rep = regexByKey.get(key);
    regexByKey.delete(key);

    merged.endpoints.push({
      httpMethod: gep.httpMethod,
      path: gep.path,
      methodName: gep.methodName || (rep ? rep.methodName : ''),
      returnType: rep ? rep.returnType : gep.returnType,
      params: rep ? rep.params : gep.params,
      comment: rep ? rep.comment : gep.comment,
      line: rep ? rep.line : gep.line
    });
  }

  for (const rep of regexByKey.values()) {
    merged.endpoints.push(rep);
  }

  return merged;
}

function mergeAll(graphControllers, regexControllers) {
  const graphByClass = new Map();
  for (const gc of (graphControllers || [])) {
    if (gc.className) graphByClass.set(gc.className, gc);
  }

  const regexByClass = new Map();
  for (const rc of (regexControllers || [])) {
    if (rc.className) regexByClass.set(rc.className, rc);
  }

  const allClasses = new Set([...graphByClass.keys(), ...regexByClass.keys()]);
  const results = [];

  for (const cls of allClasses) {
    const merged = mergeControllers(graphByClass.get(cls) || null, regexByClass.get(cls) || null);
    if (merged) results.push(merged);
  }

  return results;
}

module.exports = { mergeControllers, mergeAll, normalizeEndpoints };
