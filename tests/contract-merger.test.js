const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { mergeControllers, mergeAll, normalizeEndpoints } = require('../scripts/contract-merger');

describe('ContractMerger', () => {
  describe('normalizeEndpoints', () => {
    it('normalizes endpoint fields', () => {
      const result = normalizeEndpoints([{ method: 'post', path: '/a' }]);
      assert.equal(result[0].httpMethod, 'POST');
      assert.equal(result[0].path, '/a');
      assert.equal(result[0].methodName, '');
    });

    it('preserves existing httpMethod', () => {
      const result = normalizeEndpoints([{ httpMethod: 'GET', path: '/b' }]);
      assert.equal(result[0].httpMethod, 'GET');
    });
  });

  describe('mergeControllers', () => {
    it('graph wins on endpoint identity, regex supplements comments', () => {
      const graph = {
        className: 'FooController',
        basePath: '/api/foo',
        comment: null,
        endpoints: [
          { httpMethod: 'POST', path: '/api/foo/create', methodName: 'create' }
        ],
        sourcePath: 'Foo.java'
      };
      const regex = {
        className: 'FooController',
        basePath: '/api/foo',
        comment: '创建 Foo',
        endpoints: [
          { httpMethod: 'POST', path: '/api/foo/create', methodName: 'create', returnType: 'Result', params: 'FooDTO dto', comment: '创建资源', line: 42 }
        ],
        sourcePath: 'Foo.java'
      };

      const merged = mergeControllers(graph, regex);
      assert.equal(merged.className, 'FooController');
      assert.equal(merged.comment, '创建 Foo');
      assert.equal(merged.endpoints.length, 1);
      assert.equal(merged.endpoints[0].httpMethod, 'POST');
      assert.equal(merged.endpoints[0].returnType, 'Result');
      assert.equal(merged.endpoints[0].comment, '创建资源');
      assert.equal(merged.endpoints[0].line, 42);
    });

    it('returns regex-only controller when graph is null', () => {
      const regex = { className: 'Bar', basePath: '/bar', endpoints: [], sourcePath: 'b.java' };
      assert.equal(mergeControllers(null, regex), regex);
    });

    it('returns graph-only controller when regex is null', () => {
      const graph = { className: 'Bar', basePath: '/bar', endpoints: [], sourcePath: 'b.java' };
      assert.equal(mergeControllers(graph, null), graph);
    });

    it('returns null when both are null', () => {
      assert.equal(mergeControllers(null, null), null);
    });

    it('includes graph endpoints not in regex', () => {
      const graph = {
        className: 'X',
        basePath: '/x',
        endpoints: [
          { httpMethod: 'GET', path: '/x/new', methodName: 'newEndpoint' }
        ],
        sourcePath: 'X.java'
      };
      const regex = {
        className: 'X',
        basePath: '/x',
        endpoints: [],
        sourcePath: 'X.java'
      };

      const merged = mergeControllers(graph, regex);
      assert.equal(merged.endpoints.length, 1);
      assert.equal(merged.endpoints[0].path, '/x/new');
    });

    it('includes regex endpoints not in graph', () => {
      const graph = {
        className: 'X',
        basePath: '/x',
        endpoints: [],
        sourcePath: 'X.java'
      };
      const regex = {
        className: 'X',
        basePath: '/x',
        endpoints: [
          { httpMethod: 'GET', path: '/x/legacy', methodName: 'old', returnType: 'void', params: '', comment: 'legacy', line: 10 }
        ],
        sourcePath: 'X.java'
      };

      const merged = mergeControllers(graph, regex);
      assert.equal(merged.endpoints.length, 1);
      assert.equal(merged.endpoints[0].path, '/x/legacy');
    });
  });

  describe('mergeAll', () => {
    it('merges controllers by className', () => {
      const graph = [
        { className: 'A', basePath: '/a', endpoints: [{ httpMethod: 'GET', path: '/a/1', methodName: 'get' }], sourcePath: 'A.java' }
      ];
      const regex = [
        { className: 'A', basePath: '/a', comment: 'A controller', endpoints: [{ httpMethod: 'GET', path: '/a/1', methodName: 'get', returnType: 'R', params: '', comment: 'get one', line: 5 }], sourcePath: 'A.java' },
        { className: 'B', basePath: '/b', comment: 'B controller', endpoints: [{ httpMethod: 'POST', path: '/b/new', methodName: 'create' }], sourcePath: 'B.java' }
      ];

      const result = mergeAll(graph, regex);
      assert.equal(result.length, 2);
      const a = result.find(r => r.className === 'A');
      const b = result.find(r => r.className === 'B');
      assert.equal(a.comment, 'A controller');
      assert.equal(a.endpoints[0].returnType, 'R');
      assert.equal(b.comment, 'B controller');
    });

    it('handles null inputs', () => {
      const result = mergeAll(null, [{ className: 'X', basePath: '/', endpoints: [], sourcePath: 'x.java' }]);
      assert.equal(result.length, 1);
    });
  });
});
