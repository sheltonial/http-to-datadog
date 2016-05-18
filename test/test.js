"use strict";

var restify = require('restify');
var assert = require('assert');
var service = require('..');

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
      console.log('testLogger::err');
      internalBuffer.length = 0;
      internalBuffer.push(err);
      console.log('internalBuffer:' + internalBuffer.length);
    }
  }
}

describe('Basic endpoints check', () => {
  let client = null;
  let internalForwardBuffer = [];
  let internalLoggingBuffer = [];

  before(done => {
    service.startServer({
      port: 8000,
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
    const metrics = `rusty.bucky.analytics:1|c|#analytics-name:locationChanged,environment:localtesting\n
rusty.bucky.actions:1|c|#action-name:location_changed,environment:localtesting\n
rusty.bucky.api:192|ms|#request-path:seek-au-apitoken-grant,http-method:GET,status-code:200,environment:localtesting`
    it('should get a 204 response without any error', done => {
      client.post('/v1/send', metrics, function(err, req, res, data) {
        assert.equal(err, null, 'no error from server side');
        assert.equal(204, res.statusCode, 'status code === 204');
        assert.equal(internalForwardBuffer.pop(), metrics, 'metrics sent should be identical to what has been sent');
        done();
      });
    });
  });
});
