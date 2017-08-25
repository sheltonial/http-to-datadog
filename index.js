const dgram = require('dgram');
const restify = require('restify');
const nodeDogstatsd = require('dogstatsd-node');
const bunyan = require('bunyan');
const restifyBunyanLogger = require('restify-bunyan-logger');

exports.startServer = (options, onstart) => {
  const APP_NAME = 'http_to_datadog';
  const server = restify.createServer({
    name: APP_NAME
  });
  const statsForwarder = dgram.createSocket('udp4');

  function tags(options) {
    const tags = options.tags || process.env.TAGS;
    if (Array.isArray(tags)) {
      return tags;
    } else if (typeof(tags) === 'string') {
      return tags.split(',').map(t => t.trim());
    } else {
      return [];
    }
  }

  function healthCheckPath(appPath) {
    const paths = appPath.split('/');
    const basePath = paths.slice(0, paths.length - 1);
    basePath.push('health-check');
    return basePath.join('/');
  }

  const config = {
    port: options.port || process.env.PORT || 80,
    sinkHost: options.ddagentHost || process.env.DDAGENT_HOST || 'dd-agent',
    sinkPort: options.ddagentPort || process.env.DDAGENT_PORT || 8125,
    appPath: options.appPath || process.env.APP_PATH || '/v1/send',
    allowOrigin: options.allowOrigin || process.env.ALLOW_ORIGIN || '*',
    tags: tags(options),
    logPath: options.logPath || process.env.LOG_PATH || '/var/log',
    forwarder: options.forwarder, // for testing purpose, could be injected through testing code
    logger: options.logger // same as forwarder
  }

  const statsd = new nodeDogstatsd.StatsD({
    host: config.sinkHost,
    port: config.sinkPort,
    prefix: `${APP_NAME}.`
  });

  function now() {
    return new Date().getTime();
  }

  function increment(name, tags) {
    statsd.increment(name).tags(tags).send();
  }

  function timeToNow(time) {
    return now() - time;
  }

  function timingFrom(timer, startTime, tags) {
    timing(timer, timeToNow(startTime), tags);
  }

  function timing(name, value, tags) {
    statsd.timing(name, value).tags(tags).send();
  }

  function cors(req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', config.allowOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET');
    res.setHeader('Access-Control-Max-Age', '604800');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    return next();
  }

  server.use(restify.queryParser());
  server.use(restify.bodyParser());
  server.use(cors);

  const log = config.logger || bunyan.createLogger({
    name: APP_NAME,
    streams: [{
      type: 'rotating-file',
      path: `${config.logPath}/${APP_NAME}.log`,
      period: '1d', // daily rotation
      count: 5 // keep 5 back copies
    }]
  });

  server.on('after', restifyBunyanLogger({
    skip: function(req, res) {
      return req.method === "GET";
    },
    logger: log
  }));

  function index(req, res, next) {
    res.send(APP_NAME);
    return next();
  }

  function getBatches(stats, maxBatchSize) {
    return stats.split('\n')
      .filter(stat => stat.trim().length > 0)
      .reduce((batches, currentStat, currentIndex, statsArray) => {
        const currentBatchIndex = batches.length - 1;
        const currentBatch = batches[currentBatchIndex];
        const newBatch = currentBatch + (currentBatch.length > 0 ? '\n' : '') + currentStat;

        if (newBatch.length < maxBatchSize) {
          batches[currentBatchIndex] = newBatch;
        } else {
          batches.push(currentStat);
        }
        return batches;
      }, ['']);
  }

  function metricsReceived(req, res, next) {
    const tags = config.tags.slice(0);
    const startTime = req.time();
    const maxBatchSize = 8196;
    const statsBatches = getBatches(req.body, maxBatchSize);

    statsBatches.forEach(statsBatch => {
      const statsBuffer = new Buffer(statsBatch);
      statsForwarder.send(statsBuffer, 0, statsBuffer.length, config.sinkPort, config.sinkHost, err => {
        if (err) {
          increment('forwarding_error', tags);
          log.error({err: err}); // record not interrupt
        }
      });
    });

    tags.push('status-code:204');
    tags.push(`request-path:${config.appPath}`);
    timingFrom('response_time', startTime, tags);
    increment('count', tags);
    res.send(204);
    return next();
  }

  server.get('/', index);
  server.post(config.appPath, metricsReceived);
  server.get(healthCheckPath(config.appPath), (req, res, next) => {
    const tags = config.tags.slice(0);
    const startTime = req.time();

    res.send('OK');
    tags.push('status-code:200');
    tags.push(`request-path:${healthCheckPath(config.appPath)}`)
    timingFrom('response_time', startTime, tags);
    increment('count', tags);
    return next();
  });

  server.listen(config.port, function() {
    console.log(`http-to-datadog forwarding ${config.port} => ${config.sinkHost}:${config.sinkPort}`);
    onstart();
  });
};
