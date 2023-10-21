const debug = require('debug')('market')
const trace = require('debug')('trace')
const markets = require('../markets')
const settings = require('../settings')
const request = require('postman-request')
const base_url = 'https://www.bitxonex.com/api/v2/trade/public/markets/'
const api_error_msg = 'api did not return any data'
const market_url_template = 'https://www.bitxonex.com/market/{coin}{base}'

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
                  summary['high'] = body['ticker']['high'];
                  summary['low'] = body['ticker']['low'];
                  summary['volume'] = body['ticker']['amount'];
                  summary['volume_pair'] = body['ticker']['volume'];
                  summary['last'] = body['ticker']['last'];
                  summary['initial'] = body['ticker']['open'];
                  summary['avg'] = body['ticker']['price_avg'];
                  summary['change'] = parseFloat(body['ticker']['price_change_percent'].replace('%', ''));
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

        if (body.length > 0 && body != "404 Not Found") {
          for (var i = 0; i < body.length; i++) {
            var trade = {
              ordertype: body[i]['taker_type'].toUpperCase(),
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

        if (orders && orders['bids'] && orders['bids'].length > 0) {
          for (var i = 0; i < orders['bids'].length; i++) {
            var order = {
              price: orders.bids[i][0],
              quantity: orders.bids[i][1]
            };

            buys.push(order);
          }
        }

        if (orders && orders['asks'] && orders['asks'].length > 0) {
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
  market_name: 'Bitxonex',
  market_logo: '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',
  ext_market_url: 'https://www.bitxonex.com/market/',
  referal: 'refid=ID1906858745',
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