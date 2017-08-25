"use strict";

var dgram = require('dgram');
var restify = require('restify');
var assert = require('assert');
var service = require('..');
let statsServer = null;
const statsReceived = [];
const statsServerReceiveDelay = 50;

function testForwarder(internalBuffer) {
  return text => {
    internalBuffer.length = 0;
    internalBuffer.push(text);
    return text;
  };
}

function testLogger(internalBuffer) {
  return {
    error: err => {
      internalBuffer.length = 0;
      internalBuffer.push(err);
    }
  }
}

function startStatsServer(callback) {
  statsServer = dgram.createSocket('udp4');
  statsServer.on('message', (msg) => {
    statsReceived.push(new Buffer(msg).toString());
  });
  statsServer.on('listening', () => { callback() });
  statsServer.bind({ address: '127.0.0.1', port: 8001, exclusive: true });
}

function getStatsReceived(prefix) {
  return statsReceived.filter(stat => stat.startsWith(prefix));
}

function stopStatsServer() {
  if (statsServer) {
    statsServer.close();
  }
}

function resetStatsReceived() {
  statsReceived.splice(0,statsReceived.length);
}

describe('Basic endpoints check', () => {
  let client = null;
  let internalForwardBuffer = [];
  let internalLoggingBuffer = [];

  before(done => {
    service.startServer({
      port: 8000,
      ddagentHost: '127.0.0.1',
      ddagentPort: 8001,
      forwarder: testForwarder(internalForwardBuffer),
      logPath: './',
      logger: testLogger(internalLoggingBuffer)
    }, done);
  });

  before(done => {
    client = restify.createStringClient({
      url: 'http://127.0.0.1:8000'
    });
    done();
  });

  beforeEach(done => {
    startStatsServer(done);
  });

  afterEach(() => {
    stopStatsServer();
    resetStatsReceived();
  });

  describe('Get request to "/"', () => {
    it('should get a 200 response without any error', function(done) {
      client.get('/', function(err, req, res, data) {
        assert.equal(err, null, 'no error from server side');
        assert.equal(200, res.statusCode, 'status code === 200');
        done();
      });
    });
  });

  describe('Get request to health check', () => {
    it('should get a 200 response without any error', function(done) {
      client.get('/v1/health-check', function(err, req, res, data) {
        assert.equal(err, null, 'no error from server side');
        assert.equal(200, res.statusCode, 'status code === 200');
        done();
      });
    });
  });

  describe('Post metrics for forwarding', () => {
    const statsToForwardPrefix = 'metric.to.forward';
    const stats = `${statsToForwardPrefix}.analytics:1|c|#analytics-name:locationChanged,environment:localtesting
${statsToForwardPrefix}.actions:1|c|#action-name:location_changed,environment:localtesting
${statsToForwardPrefix}.api:192|ms|#request-path:seek-au-apitoken-grant,http-method:GET,status-code:200,environment:localtesting`

    it('should get a 204 response without any error', done => {
      client.post('/v1/send', stats, function(err, req, res, data) {
        assert.equal(err, null, 'no error from server side');
        assert.equal(204, res.statusCode, 'status code === 204');
        done();
      });
    });

    it('should forward metrics upstream', done => {
      client.post('/v1/send', stats, () => {
        setTimeout(() => { // wait for metrics to be received by stats server
          const forwardedStatsReceived = getStatsReceived(statsToForwardPrefix);

          assert.deepEqual([stats], forwardedStatsReceived);
          done();
        }, statsServerReceiveDelay);
      });
    });

    it('should handle stat payloads with extra blank lines', (done) => {
      const payload = stats.split('\n').join('\n\n\n');
      client.post('/v1/send', payload,  () => {
        setTimeout(() => { // wait for metrics to be received by stats server
          const forwardedStatsReceived = getStatsReceived(statsToForwardPrefix);

          assert.deepEqual([stats], forwardedStatsReceived);
          done();
        }, statsServerReceiveDelay);
      });
    })

    it('should break large stat payloads over batches', (done) => {
      const maxBatchSize = 8196;
      const largeStat = statsToForwardPrefix + new Array(maxBatchSize - statsToForwardPrefix.length).fill('a').join('');
      const payload = stats + '\n' + largeStat;

      client.post('/v1/send', payload,  () => {
        setTimeout(() => { // wait for metrics to be received by stats server
          const forwardedStatsReceived = getStatsReceived(statsToForwardPrefix);

          assert.equal(2, forwardedStatsReceived.length, 'should have received 2 batches of forwarded metrics');
          assert.deepEqual(forwardedStatsReceived[0], stats, 'first batch');
          assert.deepEqual(forwardedStatsReceived[1], largeStat, 'second batch');
          done();
        }, statsServerReceiveDelay);
      });
    })
  });
});
