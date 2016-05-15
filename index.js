const dgram = require('dgram');
const express = require('express');
const bodyParser = require('body-parser');
const app = express();

exports.startServer = function(options) {
  function tags(options) {
    var tags = options.tags || process.env.TAGS;
    if(Array.isArray(tags)) {
      return tags;
    } else if(typeof(tags) === 'string') {
      return tags.split(',').map(t => t.trim());
    } else {
      return [];
    }
  }

  const config = {
    port: options.port || process.env.PORT || 80,
    sinkHost: options.ddagent_host || process.env.DDAGENT_HOST || 'dd-agent',
    sinkPort: options.ddagent_port || process.env.DDAGENT_PORT || 8125,
    appPath: options.app_path || process.env.APP_PATH || '/v1/send',
    allowOrigin: options.allow_origin || process.env.ALLOW_ORIGIN || '*',
    tags: tags(options)
  }

  function healthCheckPath(appPath) {
    const paths = appPath.split('/');
    const basePath = paths.slice(0, paths.length - 1);
    basePath.push('health-check');
    return basePath.join('/');
  }

  function cors(req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', config.allowOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET');
    res.setHeader('Access-Control-Max-Age', '604800');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    next();
  }

  app.use(require("connect-datadog")({
    dogstatsd: new(require('node-dogstatsd')).StatsD(config.sinkHost, config.sinkPort),
    tags: config.tags,
    stat: 'http-to-datadog'
  }));
  app.use(bodyParser.text());
  app.use(cors);

  app.get('/', function(req, res) {
    res.send('http-to-datadog');
  });

  app.get(healthCheckPath(config.appPath), function(req, res) {
    res.send('OK');
  });

  app.post(config.appPath, function(req, res) {
    const sender = dgram.createSocket('udp4');

    sender.send(req.body, config.sinkPort, config.sinkHost, (err) => {
      sender.close();
    });
    res.sendStatus(204);
  });

  app.listen(config.port, function() {
    console.log(`bucky-forwarder app ${config.port} => ${config.sinkHost}:${config.sinkPort}`);
  });
};
