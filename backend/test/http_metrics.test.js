import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';

import {
  collectHttpMetrics,
  createHttpMetricsMiddleware,
  recordHttpRequest,
  resetHttpMetrics,
} from '../services/httpMetrics.service.js';
import { collectMetrics } from '../services/metrics.service.js';
import { app } from '../server.js';

// Parses a single `name{labels} value` series out of the exposition text.
const readSeries = (text, name) => {
  const match = text.split('\n').find((line) => line.startsWith(`${name} `));
  return match ? Number(match.slice(name.length + 1)) : undefined;
};

const readLabelled = (text, name, labels) => {
  const needle = `${name}{${labels}} `;
  const match = text.split('\n').find((line) => line.startsWith(needle));
  return match ? Number(match.slice(needle.length)) : undefined;
};

describe('HTTP request metrics', () => {
  beforeEach(() => {
    resetHttpMetrics();
  });

  it('starts every status class at zero so error-rate alerts can fire on the first error', () => {
    const text = collectHttpMetrics();
    for (const cls of ['2xx', '3xx', '4xx', '5xx']) {
      assert.equal(
        readLabelled(text, 'bazi_http_requests_total', `status_class="${cls}"`),
        0,
        `${cls} must be present at zero, not absent`
      );
    }
  });

  it('counts responses by status class', () => {
    recordHttpRequest({ statusCode: 200, durationSeconds: 0.01 });
    recordHttpRequest({ statusCode: 204, durationSeconds: 0.01 });
    recordHttpRequest({ statusCode: 301, durationSeconds: 0.01 });
    recordHttpRequest({ statusCode: 404, durationSeconds: 0.01 });
    recordHttpRequest({ statusCode: 500, durationSeconds: 0.01 });

    const text = collectHttpMetrics();
    assert.equal(readLabelled(text, 'bazi_http_requests_total', 'status_class="2xx"'), 2);
    assert.equal(readLabelled(text, 'bazi_http_requests_total', 'status_class="3xx"'), 1);
    assert.equal(readLabelled(text, 'bazi_http_requests_total', 'status_class="4xx"'), 1);
    assert.equal(readLabelled(text, 'bazi_http_requests_total', 'status_class="5xx"'), 1);
  });

  // 1xx is not a final response; counting it would inflate the denominator of every
  // error-rate expression built on this counter.
  it('ignores informational responses', () => {
    recordHttpRequest({ statusCode: 100, durationSeconds: 0.01 });
    const text = collectHttpMetrics();
    const total = ['2xx', '3xx', '4xx', '5xx'].reduce(
      (sum, cls) => sum + readLabelled(text, 'bazi_http_requests_total', `status_class="${cls}"`),
      0
    );
    assert.equal(total, 0);
  });

  // 429 is a 4xx, but "shedding load because RATE_LIMIT_MAX is too low" and "a broken
  // client sending garbage" need opposite responses and must be separable.
  it('counts 429 separately as well as inside 4xx', () => {
    recordHttpRequest({ statusCode: 429, durationSeconds: 0.001 });
    recordHttpRequest({ statusCode: 400, durationSeconds: 0.001 });

    const text = collectHttpMetrics();
    assert.equal(readSeries(text, 'bazi_http_rate_limited_total'), 1);
    assert.equal(readLabelled(text, 'bazi_http_requests_total', 'status_class="4xx"'), 2);
  });

  it('accumulates a cumulative duration histogram whose +Inf bucket equals the count', () => {
    recordHttpRequest({ statusCode: 200, durationSeconds: 0.003 });
    recordHttpRequest({ statusCode: 200, durationSeconds: 0.03 });
    recordHttpRequest({ statusCode: 200, durationSeconds: 30 });

    const text = collectHttpMetrics();
    // Cumulative: each bucket counts everything at or below its bound.
    assert.equal(readLabelled(text, 'bazi_http_request_duration_seconds_bucket', 'le="0.005"'), 1);
    assert.equal(readLabelled(text, 'bazi_http_request_duration_seconds_bucket', 'le="0.05"'), 2);
    assert.equal(readLabelled(text, 'bazi_http_request_duration_seconds_bucket', 'le="10"'), 2);
    // The 30s observation only lands in +Inf, which histogram_quantile requires to equal
    // _count — otherwise every quantile it computes is wrong.
    assert.equal(readLabelled(text, 'bazi_http_request_duration_seconds_bucket', 'le="+Inf"'), 3);
    assert.equal(readSeries(text, 'bazi_http_request_duration_seconds_count'), 3);
    assert.ok(Math.abs(readSeries(text, 'bazi_http_request_duration_seconds_sum') - 30.033) < 1e-6);
  });

  it('exposes the request metrics through /metrics alongside the process gauges', async () => {
    recordHttpRequest({ statusCode: 500, durationSeconds: 0.02 });

    const text = await collectMetrics({
      healthSnapshotFn: async () => ({ checks: { redis: { ok: true } }, ok: true }),
      shuttingDownFn: () => false,
      rateLimitDegradedFn: () => false,
    });

    assert.match(text, /# TYPE bazi_http_requests_total counter/);
    assert.match(text, /# TYPE bazi_http_request_duration_seconds histogram/);
    assert.equal(readLabelled(text, 'bazi_http_requests_total', 'status_class="5xx"'), 1);
    // The process gauges must survive the addition.
    assert.equal(readSeries(text, 'bazi_up'), 1);
  });
});

describe('HTTP metrics middleware', () => {
  beforeEach(() => {
    resetHttpMetrics();
  });

  const runMiddleware = (middleware, req, { statusCode = 200, event = 'finish' } = {}) => {
    const listeners = new Map();
    const res = {
      statusCode,
      once(name, fn) {
        listeners.set(name, fn);
      },
    };
    let nextCalled = false;
    middleware(req, res, () => {
      nextCalled = true;
    });
    return {
      nextCalled,
      finish: () => listeners.get(event)?.(),
      emit: (name) => listeners.get(name)?.(),
    };
  };

  it('records a request that completes', () => {
    const mw = createHttpMetricsMiddleware();
    const run = runMiddleware(mw, { url: '/api/bazi/calculate' }, { statusCode: 201 });
    assert.equal(run.nextCalled, true);
    run.finish();

    const text = collectHttpMetrics();
    assert.equal(readLabelled(text, 'bazi_http_requests_total', 'status_class="2xx"'), 1);
    assert.equal(readSeries(text, 'bazi_http_requests_in_flight'), 0);
  });

  // Both events fire when a client hangs up mid-response. Counting twice would double the
  // request rate, and decrementing twice would drive the in-flight gauge negative and keep
  // it there for the life of the process.
  it('counts a request exactly once when both finish and close fire', () => {
    const mw = createHttpMetricsMiddleware();
    const run = runMiddleware(mw, { url: '/api/bazi/calculate' });
    run.emit('finish');
    run.emit('close');

    const text = collectHttpMetrics();
    assert.equal(readLabelled(text, 'bazi_http_requests_total', 'status_class="2xx"'), 1);
    assert.equal(readSeries(text, 'bazi_http_requests_in_flight'), 0);
  });

  it('tracks in-flight requests while they are open', () => {
    const mw = createHttpMetricsMiddleware();
    const run = runMiddleware(mw, { url: '/api/bazi/calculate' });
    assert.equal(readSeries(collectHttpMetrics(), 'bazi_http_requests_in_flight'), 1);
    run.finish();
    assert.equal(readSeries(collectHttpMetrics(), 'bazi_http_requests_in_flight'), 0);
  });

  it('skips ignored requests entirely', () => {
    const mw = createHttpMetricsMiddleware({ ignore: (req) => req.url === '/health' });
    const run = runMiddleware(mw, { url: '/health' });
    assert.equal(run.nextCalled, true);
    run.finish();

    const text = collectHttpMetrics();
    assert.equal(readLabelled(text, 'bazi_http_requests_total', 'status_class="2xx"'), 0);
    assert.equal(readSeries(text, 'bazi_http_requests_in_flight'), 0);
  });
});

// The wiring, through the real app: the point of this whole file is that a failing
// instance is visible, and that only holds if the middleware is actually mounted and the
// probes are actually excluded.
describe('HTTP metrics wiring in the app', () => {
  beforeEach(() => {
    resetHttpMetrics();
  });

  it('counts real business traffic', async () => {
    await request(app)
      .post('/api/bazi/calculate')
      .send({ birthYear: 1993, birthMonth: 6, birthDay: 18, birthHour: 12, gender: 'male' })
      .expect(200);

    const text = collectHttpMetrics();
    assert.equal(readLabelled(text, 'bazi_http_requests_total', 'status_class="2xx"'), 1);
    assert.equal(readSeries(text, 'bazi_http_request_duration_seconds_count'), 1);
  });

  it('counts a 404 from an unmatched route', async () => {
    await request(app).get('/api/definitely-not-a-route').expect(404);
    const text = collectHttpMetrics();
    assert.equal(readLabelled(text, 'bazi_http_requests_total', 'status_class="4xx"'), 1);
  });

  // Registered before express.json, so a body the parser rejects is still counted.
  it('counts a request rejected by the body parser', async () => {
    await request(app)
      .post('/api/bazi/calculate')
      .set('Content-Type', 'application/json')
      .send('{not json')
      .expect(400);

    const text = collectHttpMetrics();
    assert.equal(readLabelled(text, 'bazi_http_requests_total', 'status_class="4xx"'), 1);
  });

  it('does not count the probe endpoints', async () => {
    await request(app).get('/live').expect(200);
    await request(app).get('/health');
    await request(app).get('/api/ready');

    const text = collectHttpMetrics();
    assert.equal(readSeries(text, 'bazi_http_request_duration_seconds_count'), 0);
    assert.equal(readLabelled(text, 'bazi_http_requests_total', 'status_class="2xx"'), 0);
  });
});
