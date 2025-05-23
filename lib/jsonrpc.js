const debug = require('debug')('debug');
var http = require('http'),
    https = require('https');

var Client = function(opts) {
  this.opts = opts || {};
  this.http = this.opts.ssl ? https : http;
};

Client.prototype.call = function(method, params, callback, errback, path) {
  var time = Date.now();
  var requestJSON;
  var net = this.opts.id;
  
  if (Array.isArray(method)) {
    // multiple rpc batch call
    requestJSON = [];

    method.forEach(function(batchCall, i) {

      if (batchCall.method.indexOf("/") > -1) {
        var orig = batchCall.method;
        batchCall.method = orig.substring(0, orig.indexOf("/"));
        batchCall.net = net;
        debug("Got net: %s", batchCall.net);
      }
      requestJSON.push({
        id: time + '-' + i,
        net: batchCall.net,
        method: batchCall.method,
        params: batchCall.params
      });
    });
  } else {
    // single rpc call
    if (method.indexOf("/") > -1) {
      method = method.substring(0, method.indexOf("/"));
    }
    requestJSON = {
      id: time,
      net: net,
      method: method,
      params: params
    };
  }

  // first we encode the request into JSON
  var requestJSON = JSON.stringify(requestJSON);

  // prepare request options
  var requestOptions = {
    host: this.opts.host,
    port: this.opts.port,
    method: 'POST',
    path: path || '/',
    headers: {
      'Host': this.opts.host,
      'Content-Length': requestJSON.length
    },
    agent: false,
    rejectUnauthorized: this.opts.ssl && this.opts.sslStrict !== false
  };

  if (this.opts.ssl && this.opts.sslCa) {
    requestOptions.ca = this.opts.sslCa;
  }

  // use HTTP auth if user and password set
  if (this.opts.username && this.opts.password)
    requestOptions.auth = this.opts.username + ':' + this.opts.password;

  debug("Request options '%o'.", requestOptions);

  // now make a request to the server
  var cbCalled = false
  var request = this.http.request(requestOptions);

  // start request timeout timer
  var reqTimeout = setTimeout(function() {
    if (cbCalled)
      return;

    cbCalled = true;
    request.end();
    
    var err = new Error('ETIMEDOUT');

    err.code = 'ETIMEDOUT';
    errback(err);
  }, this.opts.timeout || 30000);

  // set additional timeout on socket in case of remote freeze after sending headers
  request.setTimeout(this.opts.timeout || 30000, function() {
    if (cbCalled)
      return;

    cbCalled = true;
    request.end();

    var err = new Error('ESOCKETTIMEDOUT');

    err.code = 'ESOCKETTIMEDOUT';
    errback(err);
  });

  request.on('error', function(err) {
    if (cbCalled)
      return;

    cbCalled = true;
    clearTimeout(reqTimeout);
    errback(err);
  });

  request.on('response', function(response) {
    clearTimeout(reqTimeout);

    // we need to buffer the response chunks in a nonblocking way
    var buffer = '';

    response.on('data', function(chunk) {
      buffer = buffer + chunk;
    });

    // when all the responses are finished, we decode the JSON and
    // depending on whether it's got a result or an error, we call
    // emitSuccess or emitError on the promise.
    response.on('end', function() {
      var err;

      if (cbCalled)
        return;

      cbCalled = true;

      try {
        var decoded = JSON.parse(buffer);
        debug("Decoded response '%o'.", decoded);
      } catch (e) {
        if (response.statusCode !== 200) {
          err = new Error('Invalid params, response status code: ' + response.statusCode);
          err.code = -32602;
          errback(err);
        } else {
          err = new Error('Problem parsing JSON response from server');
          err.code = -32603;
          errback(err);
        }
        return;
      }

      if (!Array.isArray(decoded))
        decoded = [decoded];

      // iterate over each response, normally there will be just one
      // unless a batch rpc call response is being processed
      decoded.forEach(function(decodedResponse, i) {
        if (decodedResponse.hasOwnProperty('error') && decodedResponse.error != null) {
          if (errback) {
            err = new Error(decodedResponse.error.message || '');

            if (decodedResponse.error.code)
              err.code = decodedResponse.error.code;

            errback(err);
          }
        } else if (decodedResponse.hasOwnProperty('result')) {
          if (callback)
            callback(decodedResponse.result, response.headers);
        } else {
          if (errback) {
            err = new Error(decodedResponse.error.message || '');

            if (decodedResponse.error.code)
              err.code = decodedResponse.error.code;

            errback(err);
          }
        }
      });
    });
  });

  debug("Request JSON '%o'.", JSON.stringify(requestJSON));

  request.on('error', errback);
  request.end(requestJSON);
};

module.exports.Client = Client;