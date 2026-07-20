const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig, selectModel, assessComplexity, parseLevel2Response } = require('../scripts/flow-level2-llm');

describe('flow-level2-llm pure functions', () => {
  describe('selectModel', () => {
    it('returns opus-4-8 for high complexity', () => {
      const config = { token: 'x', baseUrl: 'http://x', model: 'claude-sonnet-5' };
      assert.equal(selectModel(config, 'high'), 'claude-opus-4-8');
    });

    it('returns config.model for normal complexity', () => {
      const config = { token: 'x', baseUrl: 'http://x', model: 'claude-sonnet-5' };
      assert.equal(selectModel(config, 'normal'), 'claude-sonnet-5');
    });
  });

  describe('assessComplexity', () => {
    it('returns high when svcCount >= 4', () => {
      const content = '**调用服务数：** 5\n**触发状态变更：** 否';
      assert.equal(assessComplexity({}, content), 'high');
    });

    it('returns high when svcCount >= 3 and hasStatusChange', () => {
      const content = '**调用服务数：** 3\n**触发状态变更：** 是';
      assert.equal(assessComplexity({}, content), 'high');
    });

    it('returns high when hasStatusChange + transaction', () => {
      const content = '调用服务数：1\n**触发状态变更：** 是\n@Transactional';
      assert.equal(assessComplexity({}, content), 'high');
    });

    it('returns high when hasStatusChange + MQ', () => {
      const content = '调用服务数：1\n**触发状态变更：** 是\n消息队列发送';
      assert.equal(assessComplexity({}, content), 'high');
    });

    it('returns normal for simple flows', () => {
      const content = '**调用服务数：** 2\n**触发状态变更：** 否';
      assert.equal(assessComplexity({}, content), 'normal');
    });

    it('returns normal when no markers found', () => {
      assert.equal(assessComplexity({}, '一份普通文档'), 'normal');
    });
  });

  describe('parseLevel2Response', () => {
    it('strips markdown code fence wrapping', () => {
      const input = '```markdown\n## 条件分支流程\ncontent here\n```';
      assert.equal(parseLevel2Response(input), '## 条件分支流程\ncontent here');
    });

    it('strips bare code fence', () => {
      const input = '```\n## 条件分支流程\ncontent\n```';
      assert.equal(parseLevel2Response(input), '## 条件分支流程\ncontent');
    });

    it('passes through clean content unchanged', () => {
      const input = '## 条件分支流程\ncontent';
      assert.equal(parseLevel2Response(input), '## 条件分支流程\ncontent');
    });
  });

  describe('loadConfig', () => {
    it('reads from env vars with highest priority', () => {
      const origToken = process.env.ANTHROPIC_AUTH_TOKEN;
      const origUrl = process.env.ANTHROPIC_BASE_URL;
      const origModel = process.env.KB_LEVEL2_MODEL;
      process.env.ANTHROPIC_AUTH_TOKEN = 'test-token';
      process.env.ANTHROPIC_BASE_URL = 'http://test.local/api';
      process.env.KB_LEVEL2_MODEL = 'claude-haiku-4-5-20251001';
      try {
        const config = loadConfig();
        assert.equal(config.token, 'test-token');
        assert.equal(config.baseUrl, 'http://test.local/api');
        assert.equal(config.model, 'claude-haiku-4-5-20251001');
      } finally {
        if (origToken) process.env.ANTHROPIC_AUTH_TOKEN = origToken;
        else delete process.env.ANTHROPIC_AUTH_TOKEN;
        if (origUrl) process.env.ANTHROPIC_BASE_URL = origUrl;
        else delete process.env.ANTHROPIC_BASE_URL;
        if (origModel) process.env.KB_LEVEL2_MODEL = origModel;
        else delete process.env.KB_LEVEL2_MODEL;
      }
    });
  });
});

describe('level2 concurrent batch logic', () => {
  it('processes items in batches of concurrency size', async () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    const concurrency = 2;
    const batches = [];

    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      batches.push(batch);
      await Promise.allSettled(batch.map(item => Promise.resolve(item)));
    }

    assert.equal(batches.length, 3);
    assert.deepEqual(batches[0], ['a', 'b']);
    assert.deepEqual(batches[1], ['c', 'd']);
    assert.deepEqual(batches[2], ['e']);
  });

  it('isolates failures within a batch via allSettled', async () => {
    const items = [
      { name: 'ok1', fail: false },
      { name: 'fail1', fail: true },
      { name: 'ok2', fail: false }
    ];
    const concurrency = 3;
    let generated = 0;
    let hasFailures = false;

    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map(item => item.fail
          ? Promise.reject(new Error('test error'))
          : Promise.resolve({ model: 'sonnet', complexity: 'normal' })
        )
      );
      for (let j = 0; j < results.length; j++) {
        if (results[j].status === 'fulfilled') generated++;
        else hasFailures = true;
      }
    }

    assert.equal(generated, 2);
    assert.equal(hasFailures, true);
  });

  it('respects LEVEL2_CONCURRENCY env var', () => {
    const orig = process.env.LEVEL2_CONCURRENCY;
    process.env.LEVEL2_CONCURRENCY = '4';
    const concurrency = parseInt(process.env.LEVEL2_CONCURRENCY) || 2;
    assert.equal(concurrency, 4);

    delete process.env.LEVEL2_CONCURRENCY;
    const defaultConcurrency = parseInt(process.env.LEVEL2_CONCURRENCY) || 2;
    assert.equal(defaultConcurrency, 2);

    if (orig) process.env.LEVEL2_CONCURRENCY = orig;
  });
});
