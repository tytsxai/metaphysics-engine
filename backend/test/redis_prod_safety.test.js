import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { initRedis, resetRedisState } from '../config/redis.js';

describe('Redis Production Safety', () => {
  const originalEnv = { ...process.env };
  // Mock logger to suppress output during tests
  const mockLogger = { log: () => {}, warn: () => {}, error: () => {} };

  beforeEach(() => {
    resetRedisState();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    mock.restoreAll();
  });

  // This assertion is inverted from what it used to be, deliberately. It previously
  // required initRedis to THROW in production without REDIS_URL — a rule inherited from
  // the session layer, when Redis held state the service could not be correct without.
  // Redis is now a pure cache and both PRODUCTION.md and validateProductionConfig treat
  // it as optional, so the throw had become a green test guarding an outage: checkRedis
  // calls initRedis with no arguments, so the rejection surfaced as 500 on /health,
  // /api/ready and /metrics. See the deep-check regression below.
  it('returns null instead of throwing in production when REDIS_URL is missing', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CI = ''; // The old guard exempted CI, which is why the suite never saw this.
    delete process.env.REDIS_URL;

    const result = await initRedis({ env: process.env });
    assert.strictEqual(result, null);
  });

  it('still throws when a caller explicitly requires Redis', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.REDIS_URL;

    await assert.rejects(async () => initRedis({ env: process.env, require: true }), {
      message: 'REDIS_URL is required when Redis is requested explicitly.',
    });
  });

  it('should NOT throw error in development if REDIS_URL is missing', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.REDIS_URL;

    const result = await initRedis({ env: process.env });
    assert.strictEqual(result, null);
  });

  it('should NOT throw error in production if REDIS_URL is present', async () => {
    process.env.NODE_ENV = 'production';
    process.env.REDIS_URL = 'redis://localhost:6379';

    // Mock importRedis to avoid actual connection
    const mockConnect = mock.fn(async () => {});
    const mockOn = mock.fn();
    const mockImportRedis = async () => ({
      createClient: () => ({
        connect: mockConnect,
        on: mockOn,
      }),
    });

    const result = await initRedis({
      env: process.env,
      importRedis: mockImportRedis,
      logger: mockLogger,
    });

    assert.notStrictEqual(result, null);
    assert.strictEqual(mockConnect.mock.callCount(), 1);
  });
});
