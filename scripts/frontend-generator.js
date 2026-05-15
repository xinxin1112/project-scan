#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createFrontmatter, writeDocument } = require('./frontmatter');

function scanReactApp(appDir, outputDir, commit) {
  const srcDir = path.join(appDir, 'src');
  if (!fs.existsSync(srcDir)) {
    console.error(`src/ 目录不存在: ${srcDir}`);
    return;
  }

  const results = {
    routes: scanRoutes(srcDir),
    apis: scanApis(srcDir),
    pages: scanPages(srcDir),
    components: scanComponents(srcDir),
    stores: scanStores(srcDir)
  };

  // 生成路由文档
  if (results.routes.length > 0) {
    generateRoutesDoc(results.routes, outputDir, appDir, commit);
  }

  // 生成 API 调用文档
  if (results.apis.length > 0) {
    generateApisDoc(results.apis, outputDir, appDir, commit);
  }

  // 生成页面/组件索引
  generatePageIndex(results.pages, results.components, outputDir, appDir, commit);

  // 生成 store 文档
  if (results.stores.length > 0) {
    generateStoreDoc(results.stores, outputDir, appDir, commit);
  }

  console.log(`✓ 前端扫描完成`);
  console.log(`  路由: ${results.routes.length}`);
  console.log(`  API 调用: ${results.apis.length}`);
  console.log(`  页面: ${results.pages.length}`);
  console.log(`  组件: ${results.components.length}`);
  console.log(`  Store: ${results.stores.length}`);
}

function scanRoutes(srcDir) {
  const routerDir = path.join(srcDir, 'router');
  if (!fs.existsSync(routerDir)) return [];

  const routes = [];
  walkTs(routerDir, (fp) => {
    const content = fs.readFileSync(fp, 'utf-8');
    const routeRegex = /path:\s*['"`]([^'"`]+)['"`]/g;
    const componentRegex = /component:\s*(?:lazy\(\(\)\s*=>\s*import\(['"`]([^'"`]+)['"`]\))|element:\s*<(\w+)/g;
    let match;
    while ((match = routeRegex.exec(content)) !== null) {
      routes.push({ path: match[1], file: path.relative(srcDir, fp) });
    }
  });
  return routes;
}

function scanApis(srcDir) {
  const apiDir = path.join(srcDir, 'api');
  const servicesDir = path.join(srcDir, 'services');
  const apis = [];

  const dirs = [apiDir, servicesDir].filter(fs.existsSync);
  for (const dir of dirs) {
    walkTs(dir, (fp) => {
      const content = fs.readFileSync(fp, 'utf-8');
      // 匹配 API 调用模式
      const patterns = [
        /(?:get|post|put|delete|patch)\s*[<(]\s*['"`]([^'"`]+)['"`]/gi,
        /url:\s*['"`]([^'"`]+)['"`]/g,
        /request\s*\(\s*['"`]([^'"`]+)['"`]/g,
        /fetch\s*\(\s*['"`]([^'"`]+)['"`]/g,
      ];
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          const url = match[1];
          if (url.startsWith('/') || url.startsWith('http')) {
            apis.push({ url, file: path.relative(srcDir, fp) });
          }
        }
      }

      // 匹配 export function/const 形式的 API 函数
      const fnRegex = /export\s+(?:const|function)\s+(\w+)/g;
      while ((match = fnRegex.exec(content)) !== null) {
        const fnName = match[1];
        if (/api|fetch|get|post|query|submit|save|delete|update/i.test(fnName)) {
          apis.push({ functionName: fnName, file: path.relative(srcDir, fp) });
        }
      }
    });
  }
  return apis;
}

function scanPages(srcDir) {
  const pagesDir = path.join(srcDir, 'pages');
  if (!fs.existsSync(pagesDir)) return [];

  const pages = [];
  const entries = fs.readdirSync(pagesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const pagePath = path.join(pagesDir, entry.name);
      const tsxFiles = findTsxFiles(pagePath);
      pages.push({
        name: entry.name,
        path: path.relative(srcDir, pagePath),
        fileCount: tsxFiles.length,
        files: tsxFiles.map(f => path.relative(srcDir, f))
      });
    }
  }
  return pages;
}

function scanComponents(srcDir) {
  const compDir = path.join(srcDir, 'components');
  if (!fs.existsSync(compDir)) return [];

  const components = [];
  const entries = fs.readdirSync(compDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      components.push({
        name: entry.name,
        path: path.relative(srcDir, path.join(compDir, entry.name))
      });
    }
  }
  return components;
}

function scanStores(srcDir) {
  const storeDir = path.join(srcDir, 'store');
  if (!fs.existsSync(storeDir)) return [];

  const stores = [];
  walkTs(storeDir, (fp) => {
    const content = fs.readFileSync(fp, 'utf-8');
    const name = path.basename(fp, path.extname(fp));
    const stateMatch = content.match(/create\s*[<(]|useStore|defineStore/);
    if (stateMatch) {
      stores.push({ name, file: path.relative(srcDir, fp) });
    }
  });
  return stores;
}

function generateRoutesDoc(routes, outputDir, appDir, commit) {
  const lines = ['# 路由表', '', `**路由数：** ${routes.length}`, '', '## 路由列表', '', '| 路径 | 来源文件 |', '|------|---------|'];
  for (const r of routes) {
    lines.push(`| \`${r.path}\` | ${r.file} |`);
  }
  lines.push('');

  const body = lines.join('\n');
  const outputPath = path.join(outputDir, 'routes.md');
  const frontmatter = createFrontmatter({
    kb_layer: 'contracts',
    summary: `前端路由表，${routes.length} 个路由`,
    sources: [...new Set(routes.map(r => path.join(path.relative(process.cwd(), appDir), 'src', r.file)))],
    commit, body
  });
  writeDocument(outputPath, frontmatter, body);
  console.log(`  ✓ routes.md — ${routes.length} 个路由`);
}

function generateApisDoc(apis, outputDir, appDir, commit) {
  const lines = ['# 前端 API 调用', '', `**API 调用数：** ${apis.length}`, ''];

  const urlApis = apis.filter(a => a.url);
  const fnApis = apis.filter(a => a.functionName);

  if (urlApis.length > 0) {
    lines.push('## 接口 URL', '', '| URL | 来源文件 |', '|-----|---------|');
    const seen = new Set();
    for (const a of urlApis) {
      if (seen.has(a.url)) continue;
      seen.add(a.url);
      lines.push(`| \`${a.url}\` | ${a.file} |`);
    }
    lines.push('');
  }

  if (fnApis.length > 0) {
    lines.push('## API 函数', '', '| 函数名 | 来源文件 |', '|--------|---------|');
    const seen = new Set();
    for (const a of fnApis) {
      if (seen.has(a.functionName)) continue;
      seen.add(a.functionName);
      lines.push(`| \`${a.functionName}\` | ${a.file} |`);
    }
    lines.push('');
  }

  const body = lines.join('\n');
  const outputPath = path.join(outputDir, 'api-calls.md');
  const sources = [...new Set(apis.map(a => path.join(path.relative(process.cwd(), appDir), 'src', a.file)))];
  const frontmatter = createFrontmatter({
    kb_layer: 'contracts',
    summary: `前端 API 调用，${urlApis.length} 个 URL + ${fnApis.length} 个函数`,
    sources: sources.slice(0, 20),
    commit, body
  });
  writeDocument(outputPath, frontmatter, body);
  console.log(`  ✓ api-calls.md — ${urlApis.length} URL + ${fnApis.length} 函数`);
}

function generatePageIndex(pages, components, outputDir, appDir, commit) {
  const lines = ['# 页面与组件索引', ''];
  lines.push(`**页面数：** ${pages.length}`);
  lines.push(`**共享组件数：** ${components.length}`);
  lines.push('');

  lines.push('## 页面', '', '| 页面 | 路径 | 文件数 |', '|------|------|--------|');
  for (const p of pages) {
    lines.push(`| ${p.name} | \`${p.path}\` | ${p.fileCount} |`);
  }
  lines.push('');

  lines.push('## 共享组件', '', '| 组件 | 路径 |', '|------|------|');
  for (const c of components) {
    lines.push(`| ${c.name} | \`${c.path}\` |`);
  }
  lines.push('');

  const body = lines.join('\n');
  const outputPath = path.join(outputDir, 'page-index.md');
  const frontmatter = createFrontmatter({
    kb_layer: 'code',
    summary: `前端页面与组件索引，${pages.length} 个页面，${components.length} 个共享组件`,
    sources: [],
    commit, body
  });
  writeDocument(outputPath, frontmatter, body);
  console.log(`  ✓ page-index.md — ${pages.length} 页面 + ${components.length} 组件`);
}

function generateStoreDoc(stores, outputDir, appDir, commit) {
  const lines = ['# 状态管理（Zustand Store）', '', `**Store 数：** ${stores.length}`, '', '## Store 列表', '', '| Store | 文件 |', '|-------|------|'];
  for (const s of stores) {
    lines.push(`| ${s.name} | \`${s.file}\` |`);
  }
  lines.push('');

  const body = lines.join('\n');
  const outputPath = path.join(outputDir, 'stores.md');
  const frontmatter = createFrontmatter({
    kb_layer: 'domain',
    summary: `Zustand 状态管理，${stores.length} 个 store`,
    sources: stores.map(s => path.join(path.relative(process.cwd(), appDir), 'src', s.file)),
    commit, body
  });
  writeDocument(outputPath, frontmatter, body);
  console.log(`  ✓ stores.md — ${stores.length} 个 store`);
}

function walkTs(dir, callback) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTs(full, callback);
    else if (/\.(ts|tsx)$/.test(entry.name)) callback(full);
  }
}

function findTsxFiles(dir) {
  const results = [];
  walkTs(dir, (fp) => results.push(fp));
  return results;
}

module.exports = { scanReactApp };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('用法: frontend-generator.js <app-dir> <output-dir> [commit]');
    process.exit(1);
  }
  const [appDir, outputDir, commit = 'unknown'] = args;
  scanReactApp(appDir, outputDir, commit);
}
