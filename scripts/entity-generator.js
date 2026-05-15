#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { createFrontmatter, writeDocument } = require('./frontmatter');

function parseEntityFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const result = {
    className: null,
    tableName: null,
    comment: null,
    fields: [],
    sourcePath: filePath
  };

  const classMatch = content.match(/public\s+class\s+(\w+)/);
  if (classMatch) result.className = classMatch[1];

  const tableMatch = content.match(/@TableName\("([^"]+)"\)/);
  if (tableMatch) result.tableName = tableMatch[1];

  const classComment = content.match(/\/\*\*\s*\n\s*\*\s*<p>\s*\n\s*\*\s*(.+?)\s*\n/);
  if (classComment) result.comment = classComment[1];

  const classBodyMatch = content.match(/public\s+class\s+\w+[^{]*\{([\s\S]*)$/);
  const classBody = classBodyMatch ? classBodyMatch[1] : content;

  const fieldRegex = /\/\*\*\s*\n([\s\S]*?)\*\/\s*\n((?:\s*@\w+[^\n]*\n)*)?\s*private\s+(\w+(?:<[^>]+>)?)\s+(\w+)\s*;/g;
  let match;
  while ((match = fieldRegex.exec(classBody)) !== null) {
    const commentBlock = match[1];
    const annotationBlock = match[2] || '';
    const type = match[3];
    const name = match[4];

    let fieldComment = '';
    const lines = commentBlock.split('\n')
      .map(l => l.replace(/^\s*\*\s?/, '').trim())
      .filter(l => l && !l.startsWith('@see') && !l.startsWith('<p>') && !l.startsWith('</p>'));
    fieldComment = lines.join(' ');

    let columnName = null;
    const tableFieldMatch = annotationBlock.match(/@TableField\("([^"]+)"\)/);
    const tableIdMatch = annotationBlock.match(/@TableId\(value\s*=\s*"([^"]+)"/);
    const isPrimaryKey = /@TableId/.test(annotationBlock);

    if (tableFieldMatch) {
      columnName = tableFieldMatch[1];
    } else if (tableIdMatch) {
      columnName = tableIdMatch[1];
    } else {
      columnName = camelToSnake(name);
    }

    result.fields.push({
      name,
      columnName,
      type,
      comment: fieldComment,
      isPrimaryKey
    });
  }

  return result;
}

function parseDDL(ddl) {
  const columns = {};
  const indexes = [];

  for (const line of ddl.split('\n')) {
    const trimmed = line.trim();

    const colMatch = trimmed.match(/^`(\w+)`\s+([\w()]+(?:\s+unsigned)?)\s*(.*?)(?:,\s*)?$/);
    if (colMatch) {
      const colName = colMatch[1];
      const colType = colMatch[2];
      const rest = colMatch[3];
      const notNull = /NOT NULL/i.test(rest);
      const defaultMatch = rest.match(/DEFAULT\s+('([^']*)'|(\w+\([^)]*\))|(\S+))/i);
      let defaultVal = null;
      if (defaultMatch) {
        defaultVal = defaultMatch[2] !== undefined ? defaultMatch[2]
          : defaultMatch[3] !== undefined ? defaultMatch[3]
          : defaultMatch[4];
      }
      const commentMatch = rest.match(/COMMENT\s+'([^']*)'/i);
      const comment = commentMatch ? commentMatch[1] : '';
      columns[colName] = { colType, notNull, defaultVal, comment };
      continue;
    }

    const pkMatch = trimmed.match(/PRIMARY KEY \(`([^`]+)`\)/);
    if (pkMatch) { indexes.push({ name: 'PRIMARY', columns: [pkMatch[1]], type: 'PRIMARY' }); continue; }

    const keyMatch = trimmed.match(/KEY `(\w+)` \(([^)]+)\)/);
    if (keyMatch) {
      const idxCols = keyMatch[2].replace(/`/g, '').split(',').map(s => s.trim());
      indexes.push({ name: keyMatch[1], columns: idxCols, type: 'INDEX' });
      continue;
    }

    const uniqueMatch = trimmed.match(/UNIQUE KEY `(\w+)` \(([^)]+)\)/);
    if (uniqueMatch) {
      const idxCols = uniqueMatch[2].replace(/`/g, '').split(',').map(s => s.trim());
      indexes.push({ name: uniqueMatch[1], columns: idxCols, type: 'UNIQUE' });
    }
  }

  const tableCommentMatch = ddl.match(/COMMENT='([^']*)'/);
  const tableComment = tableCommentMatch ? tableCommentMatch[1] : '';

  return { columns, indexes, tableComment };
}

function camelToSnake(str) {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

function generateMarkdown(entity, ddlInfo) {
  const lines = [];
  lines.push(`# ${entity.className}`);
  lines.push('');
  const desc = (ddlInfo && ddlInfo.tableComment) || entity.comment || '';
  if (desc) {
    lines.push(desc);
    lines.push('');
  }
  lines.push(`**表名：** \`${entity.tableName || '未知'}\``);
  lines.push(`**字段数：** ${entity.fields.length}`);
  if (ddlInfo && ddlInfo.indexes.length > 0) {
    lines.push(`**索引数：** ${ddlInfo.indexes.length}`);
  }
  lines.push('');
  lines.push('## 字段');
  lines.push('');

  if (ddlInfo) {
    lines.push('| 列名 | Java 字段 | 数据库类型 | Java 类型 | 非空 | 默认值 | 说明 | 主键 |');
    lines.push('|------|----------|-----------|----------|------|--------|------|------|');

    const ddlColumns = Object.keys(ddlInfo.columns);
    const matched = new Set();

    for (const f of entity.fields) {
      const col = ddlInfo.columns[f.columnName];
      if (col) {
        matched.add(f.columnName);
        const dbType = col.colType;
        const notNull = col.notNull ? '✓' : '';
        const defaultVal = col.defaultVal !== null ? `\`${col.defaultVal}\`` : '-';
        const comment = col.comment.replace(/\|/g, '\\|').replace(/\n/g, ' ');
        const pk = f.isPrimaryKey ? '✓' : '';
        lines.push(`| ${f.columnName} | ${f.name} | ${dbType} | ${f.type} | ${notNull} | ${defaultVal} | ${comment} | ${pk} |`);
      } else {
        const pk = f.isPrimaryKey ? '✓' : '';
        lines.push(`| ${f.columnName} | ${f.name} | - | ${f.type} | - | - | ${f.comment.replace(/\|/g, '\\|')} | ${pk} |`);
      }
    }

    const unmatchedCols = ddlColumns.filter(c => !matched.has(c));
    if (unmatchedCols.length > 0) {
      lines.push('');
      lines.push('### 仅存在于数据库（Java 未映射）');
      lines.push('');
      lines.push('| 列名 | 数据库类型 | 非空 | 默认值 | 说明 |');
      lines.push('|------|-----------|------|--------|------|');
      for (const colName of unmatchedCols) {
        const col = ddlInfo.columns[colName];
        const notNull = col.notNull ? '✓' : '';
        const defaultVal = col.defaultVal !== null ? `\`${col.defaultVal}\`` : '-';
        const comment = col.comment.replace(/\|/g, '\\|').replace(/\n/g, ' ');
        lines.push(`| ${colName} | ${col.colType} | ${notNull} | ${defaultVal} | ${comment} |`);
      }
    }
  } else {
    lines.push('| 列名 | Java 字段 | 类型 | 说明 | 主键 |');
    lines.push('|------|----------|------|------|------|');
    for (const f of entity.fields) {
      const pk = f.isPrimaryKey ? '✓' : '';
      const comment = f.comment.replace(/\|/g, '\\|');
      lines.push(`| ${f.columnName} | ${f.name} | ${f.type} | ${comment} | ${pk} |`);
    }
  }

  if (ddlInfo && ddlInfo.indexes.length > 0) {
    lines.push('');
    lines.push('## 索引');
    lines.push('');
    lines.push('| 索引名 | 类型 | 列 |');
    lines.push('|--------|------|-----|');
    for (const idx of ddlInfo.indexes) {
      lines.push(`| ${idx.name} | ${idx.type} | ${idx.columns.join(', ')} |`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

async function fetchDDL(tableName, dbConfig) {
  if (!dbConfig) return null;
  try {
    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.execute(`SHOW CREATE TABLE \`${tableName}\``);
    await conn.end();
    if (rows.length > 0) return rows[0]['Create Table'];
  } catch (e) {
    console.error(`DDL 获取失败 (${tableName}): ${e.message}`);
  }
  return null;
}

async function generateEntityDoc(entityFilePath, outputDir, commit, dbConfig) {
  const entity = parseEntityFile(entityFilePath);
  if (!entity.className) {
    console.error(`无法解析类名: ${entityFilePath}`);
    return null;
  }

  let ddlInfo = null;
  if (entity.tableName && dbConfig) {
    const ddl = await fetchDDL(entity.tableName, dbConfig);
    if (ddl) ddlInfo = parseDDL(ddl);
  }

  const body = generateMarkdown(entity, ddlInfo);
  const docName = camelToSnake(entity.className.replace(/Entity$/, '')) + '.md';
  const outputPath = path.join(outputDir, docName);

  const relativeSrc = path.relative(process.cwd(), entityFilePath);
  const frontmatter = createFrontmatter({
    kb_layer: 'domain',
    summary: `${ddlInfo?.tableComment || entity.comment || entity.className}，${entity.fields.length} 字段${ddlInfo ? `，${ddlInfo.indexes.length} 索引` : ''}，表 ${entity.tableName || '未知'}`,
    sources: [relativeSrc],
    commit,
    body
  });

  writeDocument(outputPath, frontmatter, body);
  return { outputPath, entity, ddlInfo };
}

module.exports = { parseEntityFile, parseDDL, generateMarkdown, generateEntityDoc, fetchDDL, camelToSnake };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('用法: entity-generator.js <entity.java> <output-dir> [commit] [--db]');
    console.log('  --db  连接数据库获取 DDL（需要项目 application.yml 中的配置）');
    process.exit(1);
  }
  const useDb = args.includes('--db');
  const filteredArgs = args.filter(a => a !== '--db');
  const [entityFile, outputDir, commit = 'unknown'] = filteredArgs;

  const dbConfig = useDb ? {
    host: process.env.PUR_DB_HOST || '10.150.18.39',
    port: parseInt(process.env.PUR_DB_PORT || '5517'),
    user: process.env.PUR_DB_USER || 'purchase',
    password: process.env.PUR_DB_PASSWORD,
    database: process.env.PUR_DB_NAME || 'purchase'
  } : null;

  if (useDb && !dbConfig.password) {
    console.error('错误：使用 --db 时需要设置环境变量 PUR_DB_PASSWORD');
    console.error('  export PUR_DB_PASSWORD=<密码>');
    process.exit(1);
  }

  generateEntityDoc(entityFile, outputDir, commit, dbConfig).then(result => {
    if (result) {
      console.log(`✓ 生成: ${result.outputPath}`);
      console.log(`  类名: ${result.entity.className}`);
      console.log(`  表名: ${result.entity.tableName}`);
      console.log(`  字段: ${result.entity.fields.length}`);
      console.log(`  DDL: ${result.ddlInfo ? '已获取' : '未获取'}`);
      if (result.ddlInfo) console.log(`  索引: ${result.ddlInfo.indexes.length}`);
    }
  });
}
