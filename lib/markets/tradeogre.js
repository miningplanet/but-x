const debug = require('debug')('market')
const trace = require('debug')('trace')
const markets = require('../markets')
const settings = require('../settings')
const request = require('postman-request')
const base_url = 'https://tradeogre.com/api/v1/'
const api_error_msg = 'api did not return any data'
const market_url_template = 'https://tradeogre.com/exchange/{coin}-{base}'

function get_summary(coin, exchange, trades, cb) {
  const req_url = base_url + 'ticker/' + coin.toUpperCase() + '-' + exchange.toUpperCase()
  debug("Get market summery from %s.", req_url)

  request({uri: req_url, json: true}, function (error, response, body) {
    if (error)
      return cb(error, null);
    else {
      const start = Date.now() - 86400000
      var summary = {};
      summary['bid'] = body['bid'];
      summary['ask'] = body['ask'];
      summary['high'] = body['high'];
      summary['low'] = body['low'];
      const now = Date.now()
      // For some reason summary and trade history do no correlate well...
      var pair = Number(0);
      var coin = Number(0);
      if (trades && trades.length > 0) {
        trace("Aggregate 24h pair volume.")
        for (var i = 0; i < trades.length; i++) {
          if (Date.now() - now <= 86400000) {
            const price = Number(trades[i]['price'])
            const quantity = Number(trades[i]['quantity'])
            pair += (price * quantity)
            coin += quantity
            trace("Added quantity %d with price %d -> %d, added %d.", quantity, price, pair, (price * quantity))
          } else {
            break
          }
        }
      }
      if (coin > 0) {
        trace("Add volume %d.", coin)
        summary['volume'] = coin
      }
      if (pair > 0) {
        trace("Add pair volume %d.", pair)
        summary['volume_pair'] = pair
      }
      // summary['volume_pair'] = body['volume'];

      const initial = Number(body['initialprice'])
      const last = Number(body['price'])
      summary['initial'] = initial
      summary['last'] = last

      if (initial != 0) {
        const change = 100 * last / initial - 100
        trace("Add 24h variation %d. Initial %d, last %d.", change, initial, last)
        summary['change'] = change
      } else {
        summary['change'] = '-'
      }

      return cb(null, summary);
      // // check for null body as the apis do not work all the time for some reason
      // if (body != null) {
      //   if (body.errors)
      //     return cb(body.errors, null);
      //   else {
      //     const req_url = base_url + 'orders/' + exchange.toUpperCase() + '-' + coin.toUpperCase()
      //     request({uri: req_url, json: true}, function (error, response, order_body) {
      //       if (error)
      //         return cb(error, null);
      //       else {
      //         // check for null body as the apis do not work all the time for some reason
      //         if (body != null) {
      //           if (body.errors)
      //             return cb(body.errors, null);
      //           else {
      //             var summary = {};
      //             summary['bid'] = body['bid'];
      //             summary['ask'] = body['ask'];
      //             summary['high'] = body['high'];
      //             summary['low'] = body['low'];
      //             // summary['volume'] = body['volume'];
      //             summary['volume_pair'] = body['volume'];
      //             summary['last'] = body['price']
      //             summary['initial'] = body['initialprice']
      //             // summary['change'] = parseFloat(body['ticker']['price_change_percent'].replace('%', ''));
      //             return cb(null, summary);
      //           }
      //         }
      //       }
      //     });
      //   }
      // }
    }
  });
}

function get_trades(coin, exchange, cb) {
  const req_url = base_url + 'history/' + coin.toUpperCase() + '-' + exchange.toUpperCase()
  debug("Get trade history from %s.", req_url)

  request({uri: req_url, json: true}, function (error, response, body) {
    if (body != null) {
      if (body.errors != null)
        return cb(body.errors, null);
      else {
        var trades = [];
        const max_records = 1000
        debug("Got %d trade history items.", body.length)
        
        body.reverse()
        for (var i = 0; i < body.length; i++) {
          if (i < max_records) {
            trades.push({
              ordertype: body[i]['type'].toUpperCase(),
              price: body[i]['price'],
              quantity: body[i]['quantity'],
              total: body[i]['total'],
              timestamp: body[i]['date']
            })
          } else
            break
        }
        
        return cb(null, trades);
      }
    } else
      return cb(api_error_msg, null);
  });
}

function get_orders(coin, exchange, cb) {
  const req_url = base_url + 'orders/' + coin.toUpperCase()  + '-' + exchange.toUpperCase() 
  debug("Get orders from %s.", req_url)

  request({uri: req_url, json: true}, function (error, response, body) {
    if (body != null) {
      if (body.errors)
        return cb(body.errors, [], []);
      else {
        var orders = body;
        var buys = [];
        var sells = [];
        const buyLength = Object.keys(orders['buy']).length
        const sellLength = Object.keys(orders['sell']).length
        const max_records = 500;
        debug("Got %d buy order(s), %d sell orders(s).", buyLength, sellLength)

        // if (buyLength > 0) {
        //   orders['buy'] = orders['buy'].reverse()
        //   for (var i = 0; i < buyLength; i++) {
        //     if (i < max_records) {
        //       const r = orders['buy'];
        //       buys.push({
        //         price: r.bids[i][0],
        //         quantity: r.bids[i][1]
        //       })
        //     } else
        //       break
        //   }
        // }

        // TODO: Markets: Set max records
        if (orders['buy']) {
          Object.keys(orders['buy']).reverse().forEach(function(key, index, map) {
            const order = {
              price: key,
              quantity: orders['buy'][key]
            };
            buys.push(order);
          });
        }

        if (orders['sell']) {
          Object.keys(orders['sell']).reverse().forEach(function(key, index, map) {
            const order = {
              price: key,
              quantity: orders['sell'][key]
            };
            sells.push(order);
          });
        }
        return cb(null, buys, sells.reverse());
      }
    } else
      return cb(api_error_msg, [], []);
  });
}

function get_chartdata(coin, exchange, cb) {
  return cb(null, [])
  // var end = Date.now();

  // end = end / 1000;
  // start = end - 86400;

  // TODO: Markets: Create chart data by history and orders.
  // const req_url = base_url + coin.toUpperCase() + '-' + exchange.toUpperCase() + '/k-line?time_from=' + parseInt(start) + '&time_to=' + parseInt(end) + '&period=15';
  // request({uri: req_url, json: true}, function (error, response, chartdata) {
  //   if (error)
  //     return cb(error, []);
  //   else {
  //     // check for null chartdata as the apis do not work all the time for some reason
  //     if (chartdata != null) {
  //       if (chartdata.errors == null) {
  //         var processed = [];

  //         for (var i = 0; i < chartdata.length; i++)
  //           processed.push([chartdata[i][0] * 1000, chartdata[i][1], chartdata[i][2], chartdata[i][3], chartdata[i][4]]);

  //         return cb(null, processed);
  //       } else
  //         return cb(chartdata.errors, []);
  //     } else
  //       return cb(api_error_msg, []);
  //   }
  // });
}

module.exports = {
  market_name: 'Tradeogre',
  market_logo: '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',
  ext_market_url: 'https://tradeogre.com/markets',
  referal: 'refid=abc',
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