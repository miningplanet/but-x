const debug = require('debug')('market')
const trace = require('debug')('trace')
const markets = require('../markets')
const settings = require('../settings')
const request = require('postman-request')
const base_url = 'https://api.coinex.com/v1/'
const api_error_msg = 'api did not return any data'
const market_url_template = 'https://www.coinex.com/exchange/{coin}-{base}'

function get_summary(coin, exchange, trades, cb) {
  var req_url = base_url + 'market/ticker?market=' + coin.toUpperCase() + exchange.toUpperCase()
  debug("Get market summery from %s.", req_url)

  request({uri: req_url, json: true}, function (error, response, body) {
    if (error)
      return cb(error, null)
    else {
      if (body != null) {
        if (body.errors)
          return cb(body.errors, null)
        else {
          req_url = base_url + coin.toLowerCase() + exchange.toLowerCase() + '/order-book?asks_limit=1&bids_limit=1'
          debug("Get order book from %s.", req_url)

          request({uri: req_url, json: true}, function (error, response, order_body) {
            if (error)
              return cb(error, null)
            else {
              if (body != null) {
                if (body.errors)
                  return cb(body.errors, null)
                else {
                  var summary = {}

                  summary['bid'] = (order_body != null && order_body['bids'] != null && order_body['bids'].length > 0 ? order_body['bids'][0]['price'] : 0)
                  summary['ask'] = (order_body != null && order_body['asks'] != null && order_body['asks'].length > 0 ? order_body['asks'][0]['price'] : 0)

                  if (body['data'] && body['data'].ticker) {
                    const ticker = body['data'].ticker
                    const start = Date.now() - 86400000
                    summary['volume'] = ticker['vol']

                    const pair = markets.pair(coin, exchange, trades, start)
                    if (pair >= 0) {
                      trace("Add pair volume %d.", pair)
                      summary['volume_pair'] = pair
                    }

                    const initial = Number(ticker['open'])
                    const last = Number(ticker['last'])
                    summary['initial'] = initial
                    summary['last'] = last
                    summary['high'] = ticker['high']
                    summary['low'] = ticker['low']
                    summary['bid'] = ticker['buy']
                    summary['bid_amount'] = ticker['buy_amount']
                    summary['ask'] = ticker['sell']
                    summary['ask_amount'] = ticker['sell_amount']

                    if (initial != 0) {
                      const change = 100 * last / initial - 100
                      trace("Add 24h variation %d. Initial %d, last %d.", change, initial, last)
                      summary['change'] = change
                    } else {
                      summary['change'] = '-'
                    }
                  }
                  return cb(null, summary)
                }
              }
            }
          })
        }
      }
    }
  })
}

function get_trades(coin, exchange, cb) {
  const req_url = base_url + 'market/deals?market=' + coin.toLowerCase() + exchange.toLowerCase() + '&last_id=0&limit=1000';
  debug("Get trade history from %s.", req_url)

  request({uri: req_url, json: true}, function (error, response, body) {
    if (body != null) {
      if (body.errors != null)
        return cb(body.errors, null);
      else {
        var trades = [];
        const max_records = 1000
        debug("Got %d trade history items.", body.length)

        if (body && body.data && body.data.length > 0) {
          for (var i = 0; i < body.data.length; i++) {
            if (i < max_records) {
              trades.push({
                ordertype: body.data[i]['type'].toUpperCase(),
                price: body.data[i]['price'],
                quantity: body.data[i]['amount'],
                timestamp: body.data[i]['date']
              })
              // total: body[i]['total'],
            } else
              break
          }
        }

        return cb(null, trades);
      }
    } else
      return cb(api_error_msg, null);
  });
}

function get_orders(coin, exchange, cb) {
  const req_url = base_url + 'market/depth?market=' + coin.toLowerCase() + exchange.toLowerCase() + '&merge=0&limit=50';
  debug("Get orders from %s.", req_url)

  request({uri: req_url, json: true}, function (error, response, body) {
    if (body != null) {
      if (body.errors)
        return cb(body.errors, [], []);
      else {
        var orders = body.data;
        var buys = [];
        var sells = [];
        const buyLength = Array.isArray(orders['bids']) ? orders['bids'].length : 0
        const sellLength = Array.isArray(orders['asks']) ? orders['asks'].length : 0
        const max_records = 500
        debug("Got %d buy order(s), %d sell orders(s).", buyLength, sellLength)

        for (var i = 0; i < buyLength; i++) {
          if (i < max_records) {
            buys.push({
              price: orders.bids[i][0],
              quantity: orders.bids[i][1]
            })
          } else
            break
        }
        
        if (sellLength > 0) {
          orders.asks.reverse()
          for (var i = 0; i < sellLength; i++) {
            if (i < max_records) {
              sells.push({
                price: orders.asks[i][0],
                quantity: orders.asks[i][1]
              })
            } else
              break
          }
        }
        
        return cb(null, buys, sells);
      }
    } else
      return cb(api_error_msg, [], []);
  });
}

function get_chartdata(coin, exchange, cb) {
  var end = Date.now();
  end = end / 1000;
  start = end - 86400;
  const req_url = base_url + 'market/kline?market=' + coin.toUpperCase() + exchange.toUpperCase() + '&limit=250&type=5min'
  debug("Get chart data from %s.", req_url)

  request({uri: req_url, json: true}, function (error, response, data) {
    if (error)
      return cb(error, []);
    else {
      if (data != null) {
        if (data.errors == null) {
          var chartdata = data.data
          var processed = [];
          debug("Got %d chart data.", chartdata.length)

          for (var i = 0; i < chartdata.length; i++)
            processed.push([chartdata[i][0] * 1000, chartdata[i][1] * 1000, chartdata[i][2] * 1000, chartdata[i][3] * 1000, chartdata[i][4] * 1000]);

          return cb(null, processed);
        } else
          return cb(chartdata.errors, []);
      } else
        return cb(api_error_msg, []);
    }
  });
}

module.exports = {
  market_name: 'Coinex',
  market_logo: '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',
  ext_market_url: 'https://www.coinex.com/register?refer_code=cyanf',
  referal: '',
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
          get_summary(settings.coin, settings.exchange, trades, function(err, stats) {
            if (err) { error = err; }
            return cb(error, {buys: buys, sells: sells, chartdata: chartdata, trades: trades, stats: stats});
          });
        });
      });
    });
  }
};