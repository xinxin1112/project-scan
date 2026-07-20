const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { resolve } = require('../scripts/doc-to-symbol-resolver');

describe('DocToSymbolResolver', () => {
  let tmpDir;

  function setupKbFile(relativePath, content) {
    const fullPath = path.join(tmpDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }

  // Setup temp dir before each test
  function setup() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dts-test-'));
  }

  function teardown() {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  describe('extracts class name from frontmatter sources', () => {
    it('extracts from a Java controller source path', () => {
      setup();
      try {
        setupKbFile('contracts/internal/reconcile.md', `---
kb_layer: contracts
summary: "对账单确认"
stale: false
sources:
  - /Users/a6667/bilibili/pur-center/app/src/main/java/com/bilibili/pur/controller/ReconcileController.java
last_scan_commits:
  - {file: "x.java", commit: "abc", body_hash: "def"}
---
# ReconcileController
`);
        const result = resolve('contracts/internal/reconcile.md', tmpDir);
        assert.deepEqual(result, {
          filePath: 'contracts/internal/reconcile.md',
          symbols: ['ReconcileController']
        });
      } finally {
        teardown();
      }
    });

    it('extracts from a service impl source path', () => {
      setup();
      try {
        setupKbFile('code/method-index.md', `---
kb_layer: code
summary: "供应商注册服务"
stale: false
sources:
  - /Users/a6667/bilibili/supplier-portal/app/src/main/java/com/bilibili/supplier/service/impl/SupplierRegisterServiceImpl.java
last_scan_commits:
  - {file: "x.java", commit: "abc", body_hash: "def"}
---
# SupplierRegisterServiceImpl
`);
        const result = resolve('code/method-index.md', tmpDir);
        assert.deepEqual(result, {
          filePath: 'code/method-index.md',
          symbols: ['SupplierRegisterServiceImpl']
        });
      } finally {
        teardown();
      }
    });

    it('extracts multiple symbols from multiple sources', () => {
      setup();
      try {
        setupKbFile('flows/reconcile-confirm.md', `---
kb_layer: flows
summary: "确认流程"
stale: false
sources:
  - /path/to/ReconcileController.java
  - /path/to/ReconcileService.java
last_scan_commits:
  - {file: "x.java", commit: "abc", body_hash: "def"}
---
# Confirm flow
`);
        const result = resolve('flows/reconcile-confirm.md', tmpDir);
        assert.deepEqual(result, {
          filePath: 'flows/reconcile-confirm.md',
          symbols: ['ReconcileController', 'ReconcileService']
        });
      } finally {
        teardown();
      }
    });
  });

  describe('falls back to heading/text extraction', () => {
    it('extracts class name from heading when no sources', () => {
      setup();
      try {
        setupKbFile('domain/entities/supplier.md', `---
kb_layer: domain
summary: "供应商实体"
stale: false
sources: []
last_scan_commits: []
---
# SupplierEntity

供应商基础信息实体。
`);
        const result = resolve('domain/entities/supplier.md', tmpDir);
        assert.deepEqual(result, {
          filePath: 'domain/entities/supplier.md',
          symbols: ['SupplierEntity']
        });
      } finally {
        teardown();
      }
    });
  });

  describe('returns null when nothing extractable', () => {
    it('returns null for doc with no sources and no class-like heading', () => {
      setup();
      try {
        setupKbFile('domain/overview.md', `---
kb_layer: domain
summary: "概述"
stale: false
sources: []
last_scan_commits: []
---
# 业务概述

这是一个概述文档。
`);
        const result = resolve('domain/overview.md', tmpDir);
        assert.strictEqual(result, null);
      } finally {
        teardown();
      }
    });

    it('returns null when file does not exist', () => {
      setup();
      try {
        const result = resolve('nonexistent.md', tmpDir);
        assert.strictEqual(result, null);
      } finally {
        teardown();
      }
    });
  });
});
