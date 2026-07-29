import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createRateLimitMiddleware,
  isRateLimitDegraded,
  rateLimitStore,
  resetRateLimitState,
} from '../middleware/rateLimit.middleware.js';
import { logger } from '../config/logger.js';

const createRes = () => ({
  statusCode: null,
  body: null,
  setHeader() {},
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

// Drives the middleware with Redis unavailable, which is the only way into the fallback.
const runWithRedisDown = async ({ resolveKey } = {}) => {
  const middleware = createRateLimitMiddleware({
    RATE_LIMIT_ENABLED: true,
    RATE_LIMIT_MAX: 100,
    RATE_LIMIT_WINDOW_MS: 60_000,
    initRedisClient: async () => null,
    resolveKey: resolveKey || (() => 'client-key'),
  });
  const res = createRes();
  let nextCalled = false;
  await middleware({ headers: {}, ip: '203.0.113.7' }, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
};

describe('rate limit degradation signal', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalRedisUrl = process.env.REDIS_URL;
  let errorLines;
  let warnLines;
  let originalError;
  let originalWarn;

  beforeEach(() => {
    resetRateLimitState();
    rateLimitStore.clear();
    // Degradation means "Redis was configured and did not answer", so these cases have to
    // configure one. `initRedisClient: async () => null` is what makes it unreachable.
    // The unconfigured case is a separate, non-degraded mode — see the end of this file.
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    errorLines = [];
    warnLines = [];
    originalError = logger.error;
    originalWarn = logger.warn;
    logger.error = (...args) => errorLines.push(args);
    logger.warn = (...args) => warnLines.push(args);
  });

  afterEach(() => {
    logger.error = originalError;
    logger.warn = originalWarn;
    process.env.NODE_ENV = originalEnv;
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
    resetRateLimitState();
    rateLimitStore.clear();
  });

  it('starts undegraded', () => {
    assert.equal(isRateLimitDegraded(), false);
  });

  // The regression this guards: production used to return early and log nothing at all,
  // so the one environment where a per-instance quota matters was also the only one that
  // never said it had fallen back.
  it('logs an error in production when it falls back to the in-memory store', async () => {
    process.env.NODE_ENV = 'production';

    const { nextCalled } = await runWithRedisDown();

    assert.equal(nextCalled, true, 'requests must still be served while degraded');
    assert.equal(errorLines.length, 1);
    const [context, message] = errorLines[0];
    assert.equal(context.degraded, 'rate-limit-store');
    assert.match(message, /per instance/);
  });

  it('throttles the production log rather than emitting one line per request', async () => {
    process.env.NODE_ENV = 'production';

    for (let i = 0; i < 25; i += 1) {
      await runWithRedisDown();
    }

    assert.equal(errorLines.length, 1);
  });

  it('still warns outside production', async () => {
    process.env.NODE_ENV = 'development';

    await runWithRedisDown();

    assert.equal(errorLines.length, 0);
    assert.equal(warnLines.length >= 1, true);
  });

  it('flags degradation for the metrics endpoint once it has fallen back', async () => {
    process.env.NODE_ENV = 'production';

    assert.equal(isRateLimitDegraded(), false);
    await runWithRedisDown();
    assert.equal(isRateLimitDegraded(), true);
  });

  // Time-windowed rather than latched: a signal that stays red until the next restart is
  // one nobody keeps an alert on.
  it('clears the flag once the fallback window has elapsed', async () => {
    process.env.NODE_ENV = 'production';

    await runWithRedisDown();
    const now = Date.now();

    assert.equal(isRateLimitDegraded(now + 59_000), true);
    assert.equal(isRateLimitDegraded(now + 61_000), false);
  });

  // The other half of the distinction. Running without Redis is a supported single-instance
  // mode, warned about once at startup by validateProductionConfig. Treating it as a
  // degradation pinned bazi_rate_limit_degraded at 1 for the life of the process and logged
  // an error every 60s about a Redis that was never configured, so the BaziRateLimitDegraded
  // alert in PRODUCTION.md fired on day one and never cleared.
  it('does not report degradation when Redis was never configured', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.REDIS_URL;

    const { nextCalled } = await runWithRedisDown();

    assert.equal(nextCalled, true, 'the in-memory limiter still enforces the quota');
    assert.equal(errorLines.length, 0, 'an unconfigured cache is not an incident');
    assert.equal(isRateLimitDegraded(), false);
  });

  // Deliberately still enforced: dropping the signal must not drop the limit itself.
  it('still enforces the quota from the in-memory store with no Redis configured', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.REDIS_URL;

    const middleware = createRateLimitMiddleware({
      RATE_LIMIT_ENABLED: true,
      RATE_LIMIT_MAX: 2,
      RATE_LIMIT_WINDOW_MS: 60_000,
      initRedisClient: async () => null,
      resolveKey: () => 'quota-key',
    });

    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      const res = createRes();
      await middleware({ headers: {}, ip: '203.0.113.7' }, res, () => {
        statuses.push(200);
      });
      if (res.statusCode) statuses.push(res.statusCode);
    }

    assert.deepEqual(statuses, [200, 200, 429, 429]);
  });
});
