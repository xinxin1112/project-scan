const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { merge } = require('../scripts/result-merger');

describe('ResultMerger', () => {
  describe('merge', () => {
    it('returns hits unchanged and groups graph_context by from_hit', () => {
      const hits = [
        { score: 0.62, file_path: 'contracts/internal/reconcile.md', heading: 'ReconcileController', snippet: '...' },
        { score: 0.55, file_path: 'flows/reconcile-confirm.md', heading: 'Confirm flow', snippet: '...' }
      ];

      const expansionsMap = [
        {
          fromHit: { file_path: 'contracts/internal/reconcile.md', symbol: 'ReconcileController' },
          expansion: {
            symbol: 'ReconcileController',
            kind: 'Class',
            outgoing: [
              { name: 'confirmStatement', kind: 'Method', edge_type: 'has_method', filePath: '/r.java' },
              { name: 'ReconcileService', kind: 'Interface', edge_type: 'implements', filePath: '/s.java' }
            ],
            incoming: []
          }
        }
      ];

      const result = merge(hits, expansionsMap);

      // hits 原样保留
      assert.equal(result.hits.length, 2);
      assert.equal(result.hits[0].score, 0.62);

      // graph_context 按 from_hit 分组
      assert.equal(result.graph_context.length, 1);
      assert.equal(result.graph_context[0].from_hit, 'ReconcileController');
      assert.equal(result.graph_context[0].from_file, 'contracts/internal/reconcile.md');
      assert.equal(result.graph_context[0].expansions.length, 2);
      assert.deepEqual(result.graph_context[0].expansions[0], {
        symbol: 'confirmStatement', kind: 'Method', edge_type: 'has_method', filePath: '/r.java'
      });
    });

    it('returns empty graph_context when no expansions', () => {
      const hits = [{ score: 0.5, file_path: 'x.md', heading: 'X', snippet: '...' }];
      const result = merge(hits, []);
      assert.deepEqual(result.graph_context, []);
      assert.equal(result.hits.length, 1);
    });

    it('handles multiple from_hits', () => {
      const hits = [
        { score: 0.6, file_path: 'a.md', heading: 'A', snippet: '...' },
        { score: 0.5, file_path: 'b.md', heading: 'B', snippet: '...' }
      ];

      const expansionsMap = [
        {
          fromHit: { file_path: 'a.md', symbol: 'AController' },
          expansion: { symbol: 'AController', kind: 'Class', outgoing: [{ name: 'm1', kind: 'Method', edge_type: 'has_method', filePath: '/a.java' }], incoming: [] }
        },
        {
          fromHit: { file_path: 'b.md', symbol: 'BService' },
          expansion: { symbol: 'BService', kind: 'Class', outgoing: [{ name: 'm2', kind: 'Method', edge_type: 'has_method', filePath: '/b.java' }], incoming: [] }
        }
      ];

      const result = merge(hits, expansionsMap);
      assert.equal(result.graph_context.length, 2);
      assert.equal(result.graph_context[0].from_hit, 'AController');
      assert.equal(result.graph_context[1].from_hit, 'BService');
    });

    it('skips expansions with empty outgoing and incoming', () => {
      const hits = [{ score: 0.5, file_path: 'x.md', heading: 'X', snippet: '...' }];
      const expansionsMap = [
        {
          fromHit: { file_path: 'x.md', symbol: 'EmptyClass' },
          expansion: { symbol: 'EmptyClass', kind: 'Class', outgoing: [], incoming: [] }
        }
      ];

      const result = merge(hits, expansionsMap);
      assert.equal(result.graph_context.length, 0);
    });

    it('handles null/undefined inputs gracefully', () => {
      assert.deepEqual(merge([], null), { hits: [], graph_context: [] });
      assert.deepEqual(merge(null, []), { hits: [], graph_context: [] });
    });
  });
});
