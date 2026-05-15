#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

/**
 * 从 JSON 配置生成 scan-config.yaml
 *
 * 用法：node generate-config.js --output-dir=/path/to/output --config='{ ... }'
 * 或：  node generate-config.js --output-dir=/path/to/output --interactive-json=/tmp/config.json
 */

function generateConfig(outputDir, config) {
  const scanConfig = {
    output_dir: outputDir,
    embedding: {
      model: 'bge-m3',
      provider: 'ollama'
    },
    projects: [],
    relations: [],
    external_systems: config.external_systems || []
  };

  // 后端项目
  for (const backend of (config.backends || [])) {
    const project = {
      name: backend.name,
      type: 'java-spring',
      source: backend.source,
      branch: backend.branch
    };

    if (backend.role === 'gateway') {
      project.role = 'gateway';
      project.modules = [{
        name: backend.name,
        path: backend.modules?.[0]?.path || `app/${backend.name}/src/main/java`,
        controller_path: backend.modules?.[0]?.controller_path,
        retrofit_api_path: backend.modules?.[0]?.retrofit_api_path
      }];
    } else {
      project.modules = (backend.modules || []).map(mod => ({
        name: mod.name,
        path: mod.path || `app/${mod.name}/src/main/java`,
        entity_path: mod.entity_path,
        controller_path: mod.controller_path,
        enum_path: mod.enum_path,
        error_enum_path: mod.error_enum_path,
        status_enums: mod.status_enums
      }));

      if (backend.shared_enum_path) {
        project.shared_enum_path = backend.shared_enum_path;
      }

      if (backend.db) {
        project.db = {
          host: backend.db.host,
          port: backend.db.port,
          database: backend.db.database,
          username: backend.db.username,
          password_env: backend.db.password_env
        };
      }
    }

    scanConfig.projects.push(project);
  }

  // 前端项目
  for (const frontend of (config.frontends || [])) {
    const project = {
      name: frontend.name,
      type: 'react',
      source: frontend.source,
      branch: frontend.branch,
      apps: (frontend.apps || []).map(app => ({
        name: app.name,
        path: app.path,
        role: app.role || 'buyer'
      }))
    };

    if (frontend.shared) {
      project.shared = {
        dict_file: frontend.shared.dict_file,
        api_generated_dir: frontend.shared.api_generated_dir,
        api_files: frontend.shared.api_files
      };
    }

    scanConfig.projects.push(project);
  }

  // 项目间关系
  scanConfig.relations = config.relations || [];

  // 写入文件
  const configPath = path.join(outputDir, 'scan-config.yaml');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(configPath, yaml.dump(scanConfig, { lineWidth: 120, noRefs: true }), 'utf-8');

  return configPath;
}

module.exports = { generateConfig };

if (require.main === module) {
  const args = process.argv.slice(2);
  const outputDirArg = args.find(a => a.startsWith('--output-dir='));
  const configArg = args.find(a => a.startsWith('--config='));
  const jsonFileArg = args.find(a => a.startsWith('--interactive-json='));

  if (!outputDirArg) {
    console.error('用法: node generate-config.js --output-dir=/path --config=\'{ ... }\'');
    process.exit(1);
  }

  const outputDir = outputDirArg.split('=')[1];
  let config;

  if (jsonFileArg) {
    config = JSON.parse(fs.readFileSync(jsonFileArg.split('=')[1], 'utf-8'));
  } else if (configArg) {
    config = JSON.parse(configArg.split('=').slice(1).join('='));
  } else {
    console.error('需要 --config 或 --interactive-json 参数');
    process.exit(1);
  }

  const configPath = generateConfig(outputDir, config);
  console.log(`✓ 配置文件已生成：${configPath}`);
}
