var request = require('postman-request');
var base_url = 'https://www.exbitron.com/api/v2/peatio/public/markets/';
var api_error_msg = 'api did not return any data';
const market_url_template = 'https://www.exbitron.com';

function get_summary(coin, exchange, cb) {
  var req_url = base_url + coin.toLowerCase() + exchange.toLowerCase() + '/tickers';

  request({uri: req_url, json: true}, function (error, response, body) {
    if (error)
      return cb(error, null);
    else {
      // check for null body as the apis do not work all the time for some reason
      if (body != null) {
        if (body.errors)
          return cb(body.errors, null);
        else {
          req_url = base_url + coin.toLowerCase() + exchange.toLowerCase() + '/order-book?asks_limit=1&bids_limit=1';
          
          request({uri: req_url, json: true}, function (error, response, order_body) {
            if (error)
              return cb(error, null);
            else {
              // check for null body as the apis do not work all the time for some reason
              if (body != null) {
                if (body.errors)
                  return cb(body.errors, null);
                else {
                  var summary = {};
                  summary['bid'] = (order_body != null && order_body['bids'] != null && order_body['bids'].length > 0 ? order_body['bids'][0]['price'] : 0);
                  summary['ask'] = (order_body != null && order_body['asks'] != null && order_body['asks'].length > 0 ? order_body['asks'][0]['price'] : 0);
                  summary['volume'] = body['ticker'] ? body['ticker']['amount'] : '-';
                  summary['volume_pair'] = body['ticker'] ? body['ticker']['volume'] : '-';
                  summary['high'] = body['ticker'] ? body['ticker']['high'] : '-';
                  summary['low'] = body['ticker'] ? body['ticker']['low'] : '-';
                  summary['last'] = body['ticker'] ? body['ticker']['last'] : '-';
                  summary['change'] = body['ticker'] ? parseFloat(body['ticker']['price_change_percent'].replace('%', '')) : '-'; 
                  return cb(null, summary);
                }
              }
            }
          });
        }
      }
    }
  });
}

function get_trades(coin, exchange, cb) {
  var req_url = base_url + coin.toLowerCase() + exchange.toLowerCase() + '/trades?limit=50&order_by=desc';

  request({uri: req_url, json: true}, function (error, response, body) {
    // check for null body as the apis do not work all the time for some reason
    if (body != null) {
      if (body.errors != null)
        return cb(body.errors, null);
      else {
        var trades = [];

        if (body.length > 0) {
          for (var i = 0; i < body.length; i++) {
            var trade = {
              ordertype: body[i]['taker_type'] ? body[i]['taker_type'].toUpperCase() : body[i]['taker_type'],
              price: body[i]['price'],
              quantity: body[i]['amount'],
              total: body[i]['total'],
              timestamp: body[i]['created_at']
            };

            trades.push(trade);
          }
        }

        return cb(null, trades);
      }
    } else
      return cb(api_error_msg, null);
  });
}

function get_orders(coin, exchange, cb) {
  var req_url = base_url + coin.toLowerCase() + exchange.toLowerCase() + '/depth';

  request({uri: req_url, json: true}, function (error, response, body) {
    // check for null body as the apis do not work all the time for some reason
    if (body != null) {
      if (body.errors)
        return cb(body.errors, [], []);
      else {
        var orders = body;
        var buys = [];
        var sells = [];

        if (orders['bids'] && orders['bids'].length > 0) {
          for (var i = 0; i < orders['bids'].length; i++) {
            var order = {
              price: orders.bids[i][0],
              quantity: orders.bids[i][1]
            };

            buys.push(order);
          }
        }

        if (orders['asks'] && orders['asks'].length > 0) {
          for (var i = orders['asks'].length - 1; i >= 0; i--) {
            var order = {
              price: orders.asks[i][0],
              quantity: orders.asks[i][1]
            };

            sells.push(order);
          }
        }

        return cb(null, buys, sells.reverse());
      }
    } else
      return cb(api_error_msg, [], []);
  });
}

function get_chartdata(coin, exchange, cb) {
  var end = Date.now();

  end = end / 1000;
  start = end - 86400;

  var req_url = base_url + coin.toLowerCase() + exchange.toLowerCase() + '/k-line?time_from=' + parseInt(start) + '&time_to=' + parseInt(end) + '&period=15';

  request({uri: req_url, json: true}, function (error, response, chartdata) {
    if (error)
      return cb(error, []);
    else {
      // check for null chartdata as the apis do not work all the time for some reason
      if (chartdata != null) {
        if (chartdata.errors == null) {
          var processed = [];

          for (var i = 0; i < chartdata.length; i++)
            processed.push([chartdata[i][0] * 1000, chartdata[i][1], chartdata[i][2], chartdata[i][3], chartdata[i][4]]);

          return cb(null, processed);
        } else
          return cb(chartdata.errors, []);
      } else
        return cb(api_error_msg, []);
    }
  });
}

module.exports = {
  market_name: 'Exbitron',
  market_logo: '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',
  ext_market_url: 'https://www.exbitron.com/market/',
  referal: 'refid=ID5FE45E2B3D',
  market_url_template: market_url_template,
  market_url_case: 'l',  
  get_data: function(settings, cb) {
    var error = null;
    get_chartdata(settings.coin, settings.exchange, function (err, chartdata) {
      if (err) { chartdata = []; error = err; }
      get_orders(settings.coin, settings.exchange, function(err, buys, sells) {
        if (err) { error = err; }
        get_trades(settings.coin, settings.exchange, function(err, trades) {
          if (err) { error = err; }
          get_summary(settings.coin, settings.exchange, function(err, stats) {
            if (err) { error = err; }
            return cb(error, {buys: buys, sells: sells, chartdata: chartdata, trades: trades, stats: stats});
          });
        });
      });
    });
  }
};