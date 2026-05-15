#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const V2_SCHEMA_VERSION = 2;

function createState({ modules = {}, repos = {}, devRepoPath = '' }) {
  return {
    version: V2_SCHEMA_VERSION,
    modules,
    repos,
    dev_repo_path: devRepoPath,
    last_freshness_check: new Date().toISOString()
  };
}

function readState(stateFilePath) {
  if (!fs.existsSync(stateFilePath)) return null;
  const content = fs.readFileSync(stateFilePath, 'utf-8');
  return JSON.parse(content);
}

function writeState(stateFilePath, state) {
  const dir = path.dirname(stateFilePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf-8');
}

function isV1(state) {
  return state && (!state.version || state.version < V2_SCHEMA_VERSION);
}

function addModule(state, moduleName, { kbPath, sources = [], lastScan = null }) {
  state.modules[moduleName] = {
    kb_path: kbPath,
    sources,
    last_scan: lastScan || new Date().toISOString()
  };
  return state;
}

function updateFreshnessCheck(state) {
  state.last_freshness_check = new Date().toISOString();
  return state;
}

module.exports = {
  V2_SCHEMA_VERSION,
  createState,
  readState,
  writeState,
  isV1,
  addModule,
  updateFreshnessCheck
};
