import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { getHealthSnapshot, resetHealthSnapshotCache } from '../services/health.service.js';
import { collectMetrics } from '../services/metrics.service.js';
import { resetRedisState } from '../config/redis.js';

// Regression guard for a production-only outage.
//
// Redis is optional: PRODUCTION.md documents running without it, validateProductionConfig
// downgrades a missing REDIS_URL to a warning, and docker-compose.prod.yml calls the redis
// service deletable. But config/redis.js kept throwing whenever NODE_ENV was production
// and REDIS_URL was unset — a rule left over from the session layer. checkRedis calls
// initRedis with no arguments, so that rejection travelled all the way out through
// getHealthSnapshot into the /health, /api/ready and /metrics handlers, which answered
// 500. A load balancer reading /api/ready never routes to such an instance, so a
// Redis-less production deployment served nothing at all.
//
// Every other health test injects checkRedisFn, so none of them touched the real chain.
// These deliberately do not inject anything below getHealthSnapshot: the point is to
// exercise health.service -> config/redis.js exactly as the probe handlers do.
describe('deep health probes in production without Redis', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetRedisState();
    resetHealthSnapshotCache();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'production';
    // The old guard exempted CI, which is precisely why the CI suite never caught this.
    process.env.CI = '';
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetRedisState();
    resetHealthSnapshotCache();
  });

  it('reports healthy rather than rejecting, so /health and /api/ready stay 200', async () => {
    const snapshot = await getHealthSnapshot({ env: process.env });

    assert.equal(snapshot.ok, true, 'an unconfigured optional cache must not fail readiness');
    assert.equal(snapshot.checks.redis.status, 'disabled');
    assert.equal(snapshot.checks.redis.ok, true);
  });

  it('still lets /metrics render, since the collector reuses the same snapshot', async () => {
    const body = await collectMetrics();

    assert.match(body, /^bazi_up 1$/m);
    // `disabled` counts as up: the dependency is absent by choice, not broken.
    assert.match(body, /^bazi_dependency_up\{dependency="redis"\} 1$/m);
  });

  it('reports unhealthy when Redis IS configured but unreachable', async () => {
    // The mirror image of the case above, and the reason the check cannot simply be
    // dropped: a configured-but-broken Redis must still show up as degraded.
    const snapshot = await getHealthSnapshot({
      env: { ...process.env, REDIS_URL: 'redis://127.0.0.1:1' },
      checkRedisFn: async () => ({ ok: false, status: 'unavailable' }),
    });

    assert.equal(snapshot.ok, false);
  });
});
