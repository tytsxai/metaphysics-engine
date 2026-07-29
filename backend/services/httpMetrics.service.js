// Request-level counters for /metrics.
//
// Everything the engine exposed before this file described the *process*: it is up, it has
// this much memory, its dependency answered a ping. None of it describes the work. That
// left one failure mode completely unobservable: a process that is alive and whose only
// dependency is a healthy optional cache, but which answers 500 to every request, reports
// perfectly healthy through every signal in the stack — `/live` and `/health` both 200,
// `bazi_up 1`, `bazi_dependency_up 1`, so the container healthcheck is green, autoheal
// leaves it alone and the load balancer keeps routing to it. Nothing can fire, because
// nothing is measuring the requests. PRODUCTION.md already told operators to alert on
// error rate and p95 without the engine emitting either.
//
// Hand-rolled for the same reason metrics.service.js is: a client library plus a registry
// to keep in sync is a lot of machinery for four families.

// Deliberately low cardinality. The obvious next label is the route, and it is exactly the
// wrong thing to add here: this API is public and unauthenticated, so the steady background
// of internet scanners probing /wp-login.php and /.env would mint a new time series per
// path they invent, and a Prometheus instance dies of cardinality long before it dies of
// volume. Status class answers "is it broken", the histogram answers "is it slow", and
// "which endpoint" is a question for the logs, which carry the full URL and a request id.
const STATUS_CLASSES = ['2xx', '3xx', '4xx', '5xx'];

// Tuned to this workload rather than copied from a default: chart calculation is a few
// milliseconds of CPU, so the interesting resolution is all under 100ms, while the AI
// endpoints inherit AI_TIMEOUT_MS (15s default) and need the tail to stay meaningful.
const DURATION_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

const createState = () => ({
  requestsByClass: new Map(STATUS_CLASSES.map((cls) => [cls, 0])),
  // Counted separately as well as inside 4xx. A deployment shedding load because
  // RATE_LIMIT_MAX is set too low looks identical to one being probed by a broken client
  // if all you can see is the 4xx rate, and the two have opposite responses.
  rateLimited: 0,
  bucketCounts: DURATION_BUCKETS_SECONDS.map(() => 0),
  durationSumSeconds: 0,
  durationCount: 0,
  inFlight: 0,
});

let state = createState();

export const resetHttpMetrics = () => {
  state = createState();
};

const classifyStatus = (statusCode) => {
  if (statusCode >= 500) return '5xx';
  if (statusCode >= 400) return '4xx';
  if (statusCode >= 300) return '3xx';
  if (statusCode >= 200) return '2xx';
  return null;
};

export const recordHttpRequest = ({ statusCode, durationSeconds }) => {
  const statusClass = classifyStatus(statusCode);
  // 1xx is informational and never a final response; counting it would inflate the
  // denominator of every error-rate expression.
  if (statusClass) {
    state.requestsByClass.set(statusClass, (state.requestsByClass.get(statusClass) ?? 0) + 1);
    if (statusCode === 429) state.rateLimited += 1;
  }

  if (Number.isFinite(durationSeconds) && durationSeconds >= 0) {
    state.durationSumSeconds += durationSeconds;
    state.durationCount += 1;
    for (let i = 0; i < DURATION_BUCKETS_SECONDS.length; i += 1) {
      if (durationSeconds <= DURATION_BUCKETS_SECONDS[i]) state.bucketCounts[i] += 1;
    }
  }
};

/**
 * Records every response that reaches it.
 *
 * `ignore` exists for the probe paths. An orchestrator, a load balancer and a Prometheus
 * scraper together hit `/live`, `/health`, `/api/ready` and `/metrics` every few seconds,
 * which in a quiet hour is most of the traffic. Letting them in would pull the latency
 * histogram down toward "trivially fast" and dilute the error rate with requests no user
 * made — the same reason server.js already keeps them out of the access log.
 */
export const createHttpMetricsMiddleware = ({ ignore = () => false } = {}) => {
  return (req, res, next) => {
    if (ignore(req)) return next();

    const startedAt = process.hrtime.bigint();
    state.inFlight += 1;

    // 'finish' fires on a completed response, 'close' when the client hangs up first.
    // Exactly one of them has to win, or an aborted request is counted twice — and an
    // in-flight gauge that never comes back down is worse than no gauge at all.
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      state.inFlight -= 1;
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      recordHttpRequest({ statusCode: res.statusCode, durationSeconds });
    };

    res.once('finish', settle);
    res.once('close', settle);

    return next();
  };
};

export const collectHttpMetrics = () => {
  const lines = [];

  // Every class is emitted, including the ones at zero. An absent series makes
  // `rate(bazi_http_requests_total{status_class="5xx"}[5m])` return no data rather than 0,
  // which turns an error-rate alert into one that cannot fire until after the first error.
  lines.push(
    '# HELP bazi_http_requests_total Responses served, by status class. Excludes health and metrics probes.',
    '# TYPE bazi_http_requests_total counter',
    ...STATUS_CLASSES.map(
      (cls) => `bazi_http_requests_total{status_class="${cls}"} ${state.requestsByClass.get(cls)}`
    )
  );

  lines.push(
    '# HELP bazi_http_rate_limited_total Responses rejected with 429 by the rate limiter.',
    '# TYPE bazi_http_rate_limited_total counter',
    `bazi_http_rate_limited_total ${state.rateLimited}`
  );

  lines.push(
    '# HELP bazi_http_requests_in_flight Requests currently being served.',
    '# TYPE bazi_http_requests_in_flight gauge',
    `bazi_http_requests_in_flight ${state.inFlight}`
  );

  // Prometheus histograms are cumulative: each bucket counts every observation <= le, and
  // the +Inf bucket must equal _count. histogram_quantile() reads exactly this shape.
  lines.push(
    '# HELP bazi_http_request_duration_seconds Request duration. Excludes health and metrics probes.',
    '# TYPE bazi_http_request_duration_seconds histogram',
    ...DURATION_BUCKETS_SECONDS.map(
      (bucket, i) =>
        `bazi_http_request_duration_seconds_bucket{le="${bucket}"} ${state.bucketCounts[i]}`
    ),
    `bazi_http_request_duration_seconds_bucket{le="+Inf"} ${state.durationCount}`,
    `bazi_http_request_duration_seconds_sum ${state.durationSumSeconds}`,
    `bazi_http_request_duration_seconds_count ${state.durationCount}`
  );

  return lines.join('\n');
};

export const __testing = { DURATION_BUCKETS_SECONDS, STATUS_CLASSES };
