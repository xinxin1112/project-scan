#!/usr/bin/env node
const path = require('path');

const JAVA_SPRING_RULES = [
  { pattern: /[/\\](entity|po|model)[/\\]/i, layer: 'domain', subtype: 'entities' },
  { pattern: /[/\\](enums?|constant)[/\\]/i, layer: 'domain', subtype: 'enums' },
  { pattern: /[/\\]migration[/\\]|\.sql$/i, layer: 'domain', subtype: 'state-machines' },
  { pattern: /[/\\](controller|web|rest)[/\\]/i, layer: 'contracts', subtype: 'internal' },
  { pattern: /Callback|Webhook/i, layer: 'contracts', subtype: 'external' },
  { pattern: /Client\.(java|kt)$/i, layer: 'contracts', subtype: 'external' },
  { pattern: /[/\\](mapper|repository|dao)[/\\]/i, layer: 'code', subtype: 'method-index' },
  { pattern: /[/\\]service[/\\]/i, layer: null, subtype: null },
];

const SKIP_PATTERNS = [
  /[/\\](test|tests|__tests__|spec)[/\\]/i,
  /[/\\](target|build|dist|node_modules)[/\\]/i,
  /\.(class|jar|war)$/i,
];

const INDEX_ONLY_PATTERNS = [
  /Constants?\.(java|kt)$/i,
  /Utils?\.(java|kt)$/i,
  /Config(uration)?\.(java|kt)$/i,
  /application\.(yml|yaml|properties)$/i,
];

function routeFile(filePath) {
  const normalized = filePath.replace(/\\/g, '/');

  for (const skip of SKIP_PATTERNS) {
    if (skip.test(normalized)) return { action: 'skip' };
  }

  for (const indexOnly of INDEX_ONLY_PATTERNS) {
    if (indexOnly.test(normalized)) return { action: 'index-only' };
  }

  for (const rule of JAVA_SPRING_RULES) {
    if (rule.pattern.test(normalized)) {
      if (rule.layer === null) {
        return { action: 'lm-judge', hint: 'service' };
      }
      return { action: 'generate', layer: rule.layer, subtype: rule.subtype };
    }
  }

  return { action: 'index-only' };
}

function routeFiles(filePaths) {
  const result = {
    generate: [],
    lmJudge: [],
    indexOnly: [],
    skip: []
  };

  for (const fp of filePaths) {
    const route = routeFile(fp);
    switch (route.action) {
      case 'generate':
        result.generate.push({ path: fp, layer: route.layer, subtype: route.subtype });
        break;
      case 'lm-judge':
        result.lmJudge.push({ path: fp, hint: route.hint });
        break;
      case 'index-only':
        result.indexOnly.push(fp);
        break;
      case 'skip':
        result.skip.push(fp);
        break;
    }
  }

  return result;
}

module.exports = { routeFile, routeFiles, JAVA_SPRING_RULES, SKIP_PATTERNS, INDEX_ONLY_PATTERNS };

if (require.main === module) {
  const testPaths = [
    'app/pur-reconcile/src/main/java/com/bilibili/purchase/reconcile/entity/BillReconcile.java',
    'app/pur-reconcile/src/main/java/com/bilibili/purchase/reconcile/controller/ReconcileController.java',
    'app/pur-reconcile/src/main/java/com/bilibili/purchase/reconcile/service/BillReconcileService.java',
    'app/pur-reconcile/src/main/java/com/bilibili/purchase/reconcile/mapper/BillReconcileMapper.java',
    'app/pur-reconcile/src/main/java/com/bilibili/purchase/reconcile/enums/ReconcileStatus.java',
    'app/pur-reconcile/src/main/java/com/bilibili/purchase/common/constant/PurchaseConstant.java',
    'app/pur-reconcile/src/test/java/com/bilibili/purchase/reconcile/BillReconcileTest.java',
    'app/pur-reconcile/src/main/java/com/bilibili/purchase/reconcile/client/SysApiClient.java',
  ];

  console.log('=== Java/Spring 路由测试 ===\n');
  for (const p of testPaths) {
    const r = routeFile(p);
    const name = path.basename(p);
    console.log(`${name.padEnd(35)} → ${r.action}${r.layer ? ` [${r.layer}/${r.subtype}]` : ''}${r.hint ? ` (hint: ${r.hint})` : ''}`);
  }
}
