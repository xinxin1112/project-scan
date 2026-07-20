const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { computeHitRate, computeMRR, computeGraphRecall, checkProvenance, detectStaleQueries } = require('../eval/eval-runner');

describe('computeHitRate', () => {
  it('returns 1 when all expected hits are found', () => {
    const expected = ['a.md', 'b.md'];
    const actual = [{ file_path: 'a.md' }, { file_path: 'b.md' }, { file_path: 'c.md' }];
    assert.equal(computeHitRate(expected, actual), 1);
  });

  it('returns 0.5 when half of expected hits are found', () => {
    const expected = ['a.md', 'b.md'];
    const actual = [{ file_path: 'a.md' }, { file_path: 'c.md' }];
    assert.equal(computeHitRate(expected, actual), 0.5);
  });

  it('returns 0 when no expected hits are found', () => {
    const expected = ['a.md'];
    const actual = [{ file_path: 'x.md' }];
    assert.equal(computeHitRate(expected, actual), 0);
  });

  it('returns 1 for empty expected hits', () => {
    assert.equal(computeHitRate([], [{ file_path: 'x.md' }]), 1);
    assert.equal(computeHitRate(null, []), 1);
  });
});

describe('computeMRR', () => {
  it('returns 1 when first expected hit is at rank 1', () => {
    const expected = ['a.md'];
    const actual = [{ file_path: 'a.md' }, { file_path: 'b.md' }];
    assert.equal(computeMRR(expected, actual), 1);
  });

  it('returns 0.5 when single expected hit is at rank 2', () => {
    const expected = ['b.md'];
    const actual = [{ file_path: 'a.md' }, { file_path: 'b.md' }];
    assert.equal(computeMRR(expected, actual), 0.5);
  });

  it('averages reciprocal ranks across expected hits', () => {
    const expected = ['a.md', 'c.md'];
    const actual = [{ file_path: 'a.md' }, { file_path: 'b.md' }, { file_path: 'c.md' }];
    // (1/1 + 1/3) / 2 = (1 + 0.333) / 2 ≈ 0.667
    const result = computeMRR(expected, actual);
    assert.ok(Math.abs(result - 2/3) < 0.001);
  });

  it('returns 0 for hits not in results', () => {
    const expected = ['missing.md'];
    const actual = [{ file_path: 'a.md' }];
    assert.equal(computeMRR(expected, actual), 0);
  });

  it('returns 1 for empty expected', () => {
    assert.equal(computeMRR([], []), 1);
  });
});

describe('computeGraphRecall', () => {
  it('returns 1 when all expected symbols found', () => {
    const expected = [{ symbol: 'Foo' }, { symbol: 'Bar' }];
    const graphContext = [
      { from_hit: 'X', from_file: 'x.md', expansions: [{ symbol: 'Foo' }, { symbol: 'Bar' }, { symbol: 'Baz' }] }
    ];
    assert.equal(computeGraphRecall(expected, graphContext), 1);
  });

  it('returns 0.5 when one of two expected symbols found', () => {
    const expected = [{ symbol: 'Foo' }, { symbol: 'Missing' }];
    const graphContext = [
      { from_hit: 'X', from_file: 'x.md', expansions: [{ symbol: 'Foo' }] }
    ];
    assert.equal(computeGraphRecall(expected, graphContext), 0.5);
  });

  it('returns 1 for empty expected symbols', () => {
    assert.equal(computeGraphRecall([], []), 1);
    assert.equal(computeGraphRecall(null, []), 1);
  });

  it('searches across multiple graph_context groups', () => {
    const expected = [{ symbol: 'A' }, { symbol: 'B' }];
    const graphContext = [
      { from_hit: 'X', from_file: 'x.md', expansions: [{ symbol: 'A' }] },
      { from_hit: 'Y', from_file: 'y.md', expansions: [{ symbol: 'B' }] }
    ];
    assert.equal(computeGraphRecall(expected, graphContext), 1);
  });
});

describe('checkProvenance', () => {
  it('passes when symbol found under correct from_file', () => {
    const expected = [{ symbol: 'save', from_file: 'a.md' }];
    const graphContext = [
      { from_hit: 'AController', from_file: 'a.md', expansions: [{ symbol: 'save' }] }
    ];
    const result = checkProvenance(expected, graphContext);
    assert.equal(result.pass, true);
    assert.equal(result.details[0].correct, true);
  });

  it('fails when symbol found under wrong from_file', () => {
    const expected = [{ symbol: 'save', from_file: 'a.md' }];
    const graphContext = [
      { from_hit: 'BController', from_file: 'b.md', expansions: [{ symbol: 'save' }] }
    ];
    const result = checkProvenance(expected, graphContext);
    assert.equal(result.pass, false);
    assert.equal(result.details[0].correct, false);
  });

  it('fails when symbol not found at all', () => {
    const expected = [{ symbol: 'missing', from_file: 'a.md' }];
    const graphContext = [
      { from_hit: 'A', from_file: 'a.md', expansions: [{ symbol: 'other' }] }
    ];
    const result = checkProvenance(expected, graphContext);
    assert.equal(result.pass, false);
  });

  it('passes for empty expected', () => {
    const result = checkProvenance([], []);
    assert.equal(result.pass, true);
  });

  it('skips entries without from_file', () => {
    const expected = [{ symbol: 'X' }];
    const result = checkProvenance(expected, []);
    assert.equal(result.pass, true);
    assert.equal(result.details.length, 0);
  });
});

describe('detectStaleQueries', () => {
  it('detects missing expected files', () => {
    const queries = [
      { query: 'test', expected_hits: ['/nonexistent/path/file.md'] }
    ];
    const result = detectStaleQueries(queries, '/tmp');
    assert.equal(result.length, 1);
    assert.equal(result[0].query, 'test');
  });

  it('returns empty for existing files', () => {
    const queries = [
      { query: 'test', expected_hits: ['eval-runner.js'] }
    ];
    const result = detectStaleQueries(queries, __dirname + '/../eval');
    assert.equal(result.length, 0);
  });
});
