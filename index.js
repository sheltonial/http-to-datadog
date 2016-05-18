const dgram = require('dgram');
const restify = require('restify');
const connectDatadog = require('connect-datadog');
const nodeDogstatsd = require('node-dogstatsd');
const bunyan = require('bunyan');
const restifyBunyanLogger = require('restify-bunyan-logger');

exports.startServer = (options, onstart) => {
  const APP_NAME = 'http-to-datadog';
  const server = restify.createServer({
    name: APP_NAME
  });

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
    forwarder: options.forwarder || udpForward, // for testing purpose, could be injected through testing code
    logger: options.logger // same as forwarder
  }

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

  const statsd = nodeDogstatsd.StatsD(config.sinkHost, config.sinkPort);
  const metrics = connectDatadog({
    dogstatsd: statsd,
    tags: config.tags,
    stat: APP_NAME
  });

  function udpForward(text, config) {
    const sender = dgram.createSocket('udp4');

    sender.send(text, config.sinkPort, config.sinkHost, (err) => {
      log.error(err); // record not interrupt
      sender.close();
    });
  }

  function cors(req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', config.allowOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET');
    res.setHeader('Access-Control-Max-Age', '604800');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    return next();
  }

  server.use(metrics);
  server.use(restify.bodyParser());
  server.use(cors);

  function index(req, res, next) {
    res.send(APP_NAME);
    return next();
  }

  function metricsReceived(req, res, next) {
    config.forwarder(req.body, config);
    res.send(204);
    return next;
  }

  server.get('/', index);
  server.post(config.appPath, metricsReceived);
  server.get(healthCheckPath(config.appPath), (req, res, next) => {
    res.send('OK');
    return next();
  });

  server.listen(config.port, function() {
    console.log(`http-to-datadog forwarding ${config.port} => ${config.sinkHost}:${config.sinkPort}`);
    onstart();
  });
};
