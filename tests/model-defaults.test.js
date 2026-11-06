const test = require('node:test');
const assert = require('node:assert/strict');
const { modelDefaults } = require('../model-defaults');

test('CLI default and helper models use advertised current family IDs', () => {
  assert.deepEqual(modelDefaults(['auto/claude-opus-5-5', 'auto/claude-haiku-5-5', 'auto/claude-sonnet-5-5']), {
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'auto/claude-opus-5-5',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'auto/claude-sonnet-5-5',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'auto/claude-haiku-5-5',
    ANTHROPIC_SMALL_FAST_MODEL: 'auto/claude-haiku-5-5',
  });
});

test('explicit models are preserved, ambiguous providers are not selected, and no IDs are invented', () => {
  assert.deepEqual(modelDefaults(['vendorA/claude-haiku-5-5', 'vendorB/claude-haiku-5-5']), {});
  assert.deepEqual(modelDefaults([]), {});
  const result = modelDefaults(['claude-opus-5-5', 'claude-haiku-5-5'], { ANTHROPIC_DEFAULT_OPUS_MODEL: 'custom-opus', ANTHROPIC_SMALL_FAST_MODEL: 'custom-fast' });
  assert.equal(result.ANTHROPIC_DEFAULT_OPUS_MODEL, undefined);
  assert.equal(result.ANTHROPIC_SMALL_FAST_MODEL, undefined);
  assert.equal(result.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'claude-haiku-5-5');
});
