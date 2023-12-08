const debug = require('debug')('market')
const trace = require('debug')('trace')
const markets = require('../markets')
const settings = require('../settings')
const request = require('postman-request')
const base_url = 'https://xapi.finexbox.com/v1/market'
const api_error_msg = 'api did not return any data'
const market_url_template = 'https://www.finexbox.com/market/pair/{coin}-{base}.html'

function get_summary(coin, exchange, cb) {
  const req_url = 'https://xapi.finexbox.com/v1/ticker?market=btrm_usdt'
  debug("Get market summery from %s.", req_url)

  request({uri: req_url, json: true}, function (error, response, body) {
    if (error)
      return cb(error, null)
    else {
      if (body != null) {
        if (body.errors)
          return cb(body.errors, null)
        else {
          debug('Got ' + body + ' from ...')
          const summary = {}

          if (body['result']) {
            summary['high'] = body['result']['high']
            summary['low'] = body['result']['low']
            summary['volume'] = body['result']['volume']
            // summary['volume_pair'] = body['ticker']['volume']
            summary['last'] = body['result']['last']
            summary['initial'] = body['result']['open']
            summary['avg'] = body['result']['average']
            summary['change'] = parseFloat(body['result']['percent'] ? body['result']['percent'].replace('%', '') : '0')
          }

          return cb(null, summary)
        }
      }
    }
  })
}

function get_trades(coin, exchange, cb) {
  // var req_url = base_url + coin.toLowerCase() + exchange.toLowerCase() + '/trades?limit=50&order_by=desc'
  const req_url = 'https://xapi.finexbox.com/v1/history?market=btrm_usdt&count=100'

  request({uri: req_url, json: true}, function (error, response, body) {
    if (body != null) {
      if (body.errors != null)
        return cb(body.errors, null)
      else {
        const trades = []
        if (body.length > 0) {
          for (var i = 0; i < body.length; i++) {
            var trade = {
              ordertype: body[i]['taker_type'] ? body[i]['taker_type'].toUpperCase() : '',
              price: body[i]['price'],
              quantity: body[i]['amount'],
              total: body[i]['total'],
              timestamp: body[i]['created_at']
            }
            trades.push(trade)
          }
        }
        return cb(null, trades)
      }
    } else
      return cb(api_error_msg, null)
  })
}

function get_orders(coin, exchange, cb) {
  // var req_url = base_url + coin.toLowerCase() + exchange.toLowerCase() + '/depth'
  const req_url = 'https://xapi.finexbox.com/v1/orders?market=btrm_usdt&count=20'

  request({uri: req_url, json: true}, function (error, response, body) {
    if (body != null) {
      if (body.errors)
        return cb(body.errors, [], [])
      else {
        var orders = body
        const buys = []
        const sells = []
        if (orders['bids'] && orders['bids'].length > 0) {
          for (var i = 0; i < orders['bids'].length; i++) {
            var order = {
              price: orders.bids[i][0],
              quantity: orders.bids[i][1]
            }
            buys.push(order)
          }
        }

        if (orders['asks'] && orders['asks'].length > 0) {
          for (var i = orders['asks'].length - 1; i >= 0; i--) {
            var order = {
              price: orders.asks[i][0],
              quantity: orders.asks[i][1]
            }
            sells.push(order)
          }
        }
        return cb(null, buys, sells.reverse())
      }
    } else
      return cb(api_error_msg, [], [])
  })
}

function get_chartdata(coin, exchange, cb) {
  const end = Date.now() / 1000
  const start = end - 86400
  const req_url = base_url + coin.toLowerCase() + exchange.toLowerCase() + '/k-line?time_from=' + parseInt(start) + '&time_to=' + parseInt(end) + '&period=15'

  request({uri: req_url, json: true}, function (error, response, chartdata) {
    if (error)
      return cb(error, [])
    else {
      if (chartdata != null) {
        if (chartdata.errors == null) {
          var processed = []

          for (var i = 0; i < chartdata.length; i++)
            processed.push([chartdata[i][0] * 1000, chartdata[i][1], chartdata[i][2], chartdata[i][3], chartdata[i][4]])

          return cb(null, processed)
        } else
          return cb(chartdata.errors, [])
      } else
        return cb(api_error_msg, [])
    }
  })
}

module.exports = {
  market_name: 'Finexbox',
  market_logo: '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',
  ext_market_url: 'https://www.finexbox.com//Reg/register/referrer/652223.html',
  referal: 'refid=abc',
  market_url_template: market_url_template,
  market_url_case: 'l',  
  get_data: function(settings, cb) {
    var error = null
    get_chartdata(settings.coin, settings.exchange, function (err, chartdata) {
      if (err) { chartdata = [] }
      get_orders(settings.coin, settings.exchange, function(err, buys, sells) {
        get_trades(settings.coin, settings.exchange, function(err, trades) {
          get_summary(settings.coin, settings.exchange, function(err, stats) {
            if (err) { error = err }
            return cb(error, {buys: buys, sells: sells, chartdata: chartdata, trades: trades, stats: stats})
          })
        })
      })
    })
  }
}