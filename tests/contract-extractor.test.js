const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parseRouteNodes, groupRoutesByController, extractClassNameFromPath, extractMethodName, extractBasePath, routesToControllerFormat } = require('../scripts/contract-extractor');

describe('ContractExtractor', () => {
  describe('extractClassNameFromPath', () => {
    it('extracts class name from Java file path', () => {
      assert.equal(extractClassNameFromPath('app/src/main/java/com/example/FooController.java'), 'FooController');
    });

    it('returns null for non-Java file', () => {
      assert.equal(extractClassNameFromPath('app/src/foo.ts'), null);
    });

    it('returns null for empty path', () => {
      assert.equal(extractClassNameFromPath(''), null);
    });
  });

  describe('extractMethodName', () => {
    it('extracts method name from handlerSymbolId', () => {
      assert.equal(
        extractMethodName('Method:app/src/ExportController.java:ExportController.exportFile#1'),
        'exportFile'
      );
    });

    it('returns empty for invalid id', () => {
      assert.equal(extractMethodName(''), '');
      assert.equal(extractMethodName('invalid'), '');
    });
  });

  describe('extractBasePath', () => {
    it('finds common prefix', () => {
      const routes = [
        { name: '/api/users/list' },
        { name: '/api/users/detail' },
        { name: '/api/users/create' }
      ];
      assert.equal(extractBasePath(routes), '/api/users');
    });

    it('returns empty for divergent paths', () => {
      const routes = [
        { name: '/a/foo' },
        { name: '/b/bar' }
      ];
      assert.equal(extractBasePath(routes), '');
    });

    it('returns empty for empty input', () => {
      assert.equal(extractBasePath([]), '');
    });
  });

  describe('parseRouteNodes', () => {
    it('parses route objects', () => {
      const raw = [
        { id: 'Route:POST /api/foo', name: '/api/foo', method: 'POST', filePath: 'a/B.java', handlerSymbolId: 'Method:B.doFoo#1' }
      ];
      const result = parseRouteNodes(raw);
      assert.equal(result.length, 1);
      assert.equal(result[0].name, '/api/foo');
      assert.equal(result[0].method, 'POST');
    });

    it('returns empty for null input', () => {
      assert.deepEqual(parseRouteNodes(null), []);
    });
  });

  describe('groupRoutesByController', () => {
    it('groups by filePath', () => {
      const routes = [
        { filePath: 'A.java', name: '/a' },
        { filePath: 'A.java', name: '/b' },
        { filePath: 'B.java', name: '/c' }
      ];
      const grouped = groupRoutesByController(routes);
      assert.equal(grouped.size, 2);
      assert.equal(grouped.get('A.java').length, 2);
      assert.equal(grouped.get('B.java').length, 1);
    });
  });

  describe('routesToControllerFormat', () => {
    it('converts routes to controller format', () => {
      const routes = [
        { name: '/api/users/list', method: 'GET', handlerSymbolId: 'Method:UserController.list#1', filePath: 'UserController.java' },
        { name: '/api/users/create', method: 'POST', handlerSymbolId: 'Method:UserController.create#1', filePath: 'UserController.java' }
      ];
      const result = routesToControllerFormat('app/src/UserController.java', routes);
      assert.equal(result.className, 'UserController');
      assert.equal(result.basePath, '/api/users');
      assert.equal(result.endpoints.length, 2);
      assert.equal(result.endpoints[0].httpMethod, 'GET');
      assert.equal(result.endpoints[0].methodName, 'list');
      assert.equal(result.endpoints[1].httpMethod, 'POST');
    });

    it('returns null for non-Java file', () => {
      assert.equal(routesToControllerFormat('foo.txt', []), null);
    });
  });
});
