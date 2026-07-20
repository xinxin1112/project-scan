const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { parseContextResult, capMethods } = require('../scripts/graph-expander');

describe('GraphExpander pure functions', () => {
  describe('parseContextResult', () => {
    it('parses a valid context response with has_method and implements', () => {
      const raw = {
        symbol: { uid: 'cls-1', name: 'ReconcileController', kind: 'Class', filePath: '/path/to/Reconcile.java', line: 27 },
        outgoing: {
          has_method: [
            { uid: 'm-1', name: 'confirmStatement', kind: 'Method', filePath: '/path/to/Reconcile.java', line: 45 },
            { uid: 'm-2', name: 'getList', kind: 'Method', filePath: '/path/to/Reconcile.java', line: 60 }
          ],
          implements: [
            { uid: 'i-1', name: 'ReconcileService', kind: 'Interface', filePath: '/path/to/Service.java', line: 5 }
          ]
        },
        incoming: {}
      };

      const result = parseContextResult(raw);
      assert.equal(result.symbol, 'ReconcileController');
      assert.equal(result.kind, 'Class');
      assert.equal(result.outgoing.length, 3);
      assert.deepEqual(result.outgoing[0], {
        name: 'confirmStatement', kind: 'Method', edge_type: 'has_method', filePath: '/path/to/Reconcile.java'
      });
      assert.deepEqual(result.outgoing[2], {
        name: 'ReconcileService', kind: 'Interface', edge_type: 'implements', filePath: '/path/to/Service.java'
      });
      assert.deepEqual(result.incoming, []);
    });

    it('parses incoming edges', () => {
      const raw = {
        symbol: { uid: 's-1', name: 'PaymentService', kind: 'Class', filePath: '/p.java', line: 10 },
        outgoing: {},
        incoming: {
          calls: [
            { uid: 'c-1', name: 'OrderController', kind: 'Class', filePath: '/o.java', line: 20 }
          ]
        }
      };

      const result = parseContextResult(raw);
      assert.equal(result.incoming.length, 1);
      assert.deepEqual(result.incoming[0], {
        name: 'OrderController', kind: 'Class', edge_type: 'calls', filePath: '/o.java'
      });
    });

    it('returns empty structure for null/error responses', () => {
      assert.deepEqual(parseContextResult(null), { symbol: null, kind: null, outgoing: [], incoming: [] });
      assert.deepEqual(parseContextResult({ error: 'timeout' }), { symbol: null, kind: null, outgoing: [], incoming: [] });
      assert.deepEqual(parseContextResult(undefined), { symbol: null, kind: null, outgoing: [], incoming: [] });
    });

    it('handles missing outgoing/incoming gracefully', () => {
      const raw = {
        symbol: { uid: 'x', name: 'Foo', kind: 'Class', filePath: '/f.java', line: 1 }
      };
      const result = parseContextResult(raw);
      assert.equal(result.symbol, 'Foo');
      assert.deepEqual(result.outgoing, []);
      assert.deepEqual(result.incoming, []);
    });
  });

  describe('capMethods', () => {
    it('returns all items when under cap', () => {
      const list = [
        { name: 'a', kind: 'Method', edge_type: 'has_method', filePath: '/a.java' },
        { name: 'b', kind: 'Method', edge_type: 'has_method', filePath: '/b.java' }
      ];
      assert.deepEqual(capMethods(list, 8), list);
    });

    it('truncates to N items when over cap', () => {
      const list = Array.from({ length: 22 }, (_, i) => ({
        name: `method${i}`, kind: 'Method', edge_type: 'has_method', filePath: `/m${i}.java`
      }));
      const result = capMethods(list, 8);
      assert.equal(result.length, 8);
      assert.equal(result[0].name, 'method0');
      assert.equal(result[7].name, 'method7');
    });

    it('preserves non-has_method items regardless of cap', () => {
      const list = [
        ...Array.from({ length: 10 }, (_, i) => ({
          name: `m${i}`, kind: 'Method', edge_type: 'has_method', filePath: `/m${i}.java`
        })),
        { name: 'MyInterface', kind: 'Interface', edge_type: 'implements', filePath: '/i.java' }
      ];
      const result = capMethods(list, 5);
      // 5 has_method + 1 implements = 6
      assert.equal(result.length, 6);
      assert.ok(result.some(r => r.name === 'MyInterface'));
    });

    it('handles empty list', () => {
      assert.deepEqual(capMethods([], 8), []);
    });
  });
});
