const debug = require('debug')('market')
const trace = require('debug')('trace')
const markets = require('../markets')
const settings = require('../settings')
const max_orders = parseInt(settings.markets_page.exchanges.max_orders)
const max_history = parseInt(settings.markets_page.exchanges.max_history)
const max_chart = parseInt(settings.markets_page.exchanges.max_chart)
const request = require('postman-request')
const base_url = 'https://www.bitoreum.exchange/api/v2/peatio/public/markets/'
const api_error_msg = 'api did not return any data'
const market_url_template = 'https://www.bitoreum.exchange/market/{coin}{base}'

function get_summary(coin, exchange, trades, cb) {
  var req_url = base_url + coin + exchange + '/tickers'
  
  debug("Get market summary from %s.", req_url)
  request({uri: req_url, json: true}, function (error, response, body) {
    if (error)
      return cb(error, null)
    else {
      if (body != null) {
        if (body.errors)
          return cb(body.errors, null)
        else {
          req_url = base_url + coin + exchange + '/order-book?asks_limit=1&bids_limit=1'

          debug("Get order book from %s.", req_url)
          request({uri: req_url, json: true}, function (error, response, order_body) {
            if (error)
              return cb(error, null)
            else {
              const start = Date.now() - 86400000
              const summary = {}

              if (order_body != null && order_body['bids'] != null && order_body['bids'].length > 0 && !isNaN(order_body['bids'][0]['price']))
                summary['bid'] = order_body['bids'][0]['price']

              if (order_body != null && order_body['asks'] != null && order_body['asks'].length > 0 && !isNaN(order_body['asks'][0]['price']))
                summary['ask'] = order_body['asks'][0]['price']

              const ticker = body['ticker']

              if (!isNaN(ticker['high']))
                summary['high'] = ticker['high']
              else {
                const high = markets.high(coin, exchange, trades, start)
                if (high > 0) {
                  trace("Add high %d.", high)
                  summary['high'] = high
                }
              }
              
              if (!isNaN(ticker['low']))
                summary['low'] = ticker['low']
              else {
                const low = markets.low(coin, exchange, trades, start)
                if (low < Number.MAX_SAFE_INTEGER) {
                  trace("Add low %d.", low)
                  summary['low'] = low
                }
              }

              if (!isNaN(ticker['amount']))
                summary['volume'] = ticker['amount']

              if (!isNaN(ticker['volume']))
                summary['volume_pair'] = ticker['volume']
              else {
                const pair = markets.pair(coin, exchange, trades, start)
                if (pair >= 0) {
                  trace("Add pair volume %d.", pair)
                  summary['volume_pair'] = pair
                }
              }

              var last
              if (!isNaN(ticker['last'])) {
                last = ticker['last']
                summary['last'] = ticker['last']
              } else {
                last = markets.last(coin, exchange, trades, start)
                if (!isNaN(last)) {
                  summary['last'] = last
                }
              }

              var initial 
              if (!isNaN(ticker['open'])) {
                initial = ticker['open']
                summary['initial'] = initial
              } else {
                initial = markets.initial(coin, exchange, trades, start)
                if (!isNaN(initial))
                  summary['initial'] = initial
              }

              if (!isNaN(ticker['avg_price']))
                summary['avg'] = ticker['avg_price']

              if (ticker['price_change_percent'])
                summary['change'] = parseFloat(ticker['price_change_percent'].replace('%', ''))
              else {
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
          })
        }
      }
    }
  })
}

function get_trades(coin, exchange, cb) {
  const req_url = base_url + coin + exchange + '/trades?limit=' + max_history + '&order_by=desc'

  debug("Get trade history from %s. Max %d items.", req_url, max_history)
  request({uri: req_url, json: true}, function (error, response, body) {
    if (body != null) {
      if (body.errors != null)
        return cb(body.errors, null)
      else {
        const trades = []
        debug("Got %d trade history items.", body.length)

        if (body.length > 0) {
          for (var i = 0; i < body.length; i++) {
            if (i < max_history) {
              if (body[i]['taker_type'])
                trades.push({
                  ordertype: body[i]['taker_type'].toUpperCase(),
                  price: !isNaN(body[i]['price']) ? body[i]['price'] : '',
                  quantity: !isNaN(body[i]['amount']) ? body[i]['amount'] : '',
                  total: !isNaN(body[i]['total']) ? body[i]['total'] : '',
                  timestamp: !isNaN(body[i]['created_at']) ? body[i]['created_at'] : ''
                })
              else
                trace("WARN: Trade history order type is null.")
            } else
              break
          }
        }

        return cb(null, trades)
      }
    } else
      return cb(api_error_msg, null)
  })
}

function get_orders(coin, exchange, cb) {
  const req_url = base_url + coin + exchange + '/depth'

  debug("Get orders from %s. Max %d items.", req_url, max_orders)
  request({uri: req_url, json: true}, function (error, response, body) {
    if (body != null) {
      if (body.errors)
        return cb(body.errors, [], [])
      else {
        const orders = body
        const buys = []
        const sells = []
        const buyLength = Array.isArray(orders['bids']) ? orders['bids'].length : 0
        const sellLength = Array.isArray(orders['asks']) ? orders['asks'].length : 0

        for (var i = 0; i < buyLength; i++) {
          if (i < max_orders) {
            if (Array.isArray(orders.bids[i]) && orders.bids[i].length > 1 && !isNaN(orders.bids[i][0]) && !isNaN(orders.bids[i][1])) {
              buys.push({
                price: orders.bids[i][0],
                quantity: orders.bids[i][1]
              })
            } else
              trace("WARN: Invalid bid detected '%s'.", orders.bids[i])
          } else
            break
        }

        if (sellLength > 0) {
          orders.asks.reverse()
          for (var i = 0; i < sellLength; i++) {
            if (i < max_orders) {
              if (Array.isArray(orders.asks[i]) && orders.asks[i].length > 1 && !isNaN(orders.asks[i][0]) && !isNaN(orders.asks[i][1])) {
                sells.push({
                  price: orders.asks[i][0],
                  quantity: orders.asks[i][1]
                })
              } else
                trace("WARN: Invalid ask detected '%s'.", orders.asks[i])
            } else
              break
          }
        }

        return cb(null, buys, sells)
      }
    } else
      return cb(api_error_msg, [], [])
  })
}

function get_chartdata(coin, exchange, cb) {
  const end = Date.now() / 1000
  const start = end - 86400
  const req_url = base_url + coin.toLowerCase() + exchange.toLowerCase() + '/k-line?time_from=' + parseInt(start) + '&time_to=' + parseInt(end) + '&period=15'
  
  debug("Get chart data from %s. Max %d items.", req_url, max_chart)
  request({uri: req_url, json: true}, function (error, response, chartdata) {
    if (error)
      return cb(error, [])
    else {
      if (chartdata != null) {
        if (chartdata.errors == null) {
          const processed = []
          debug("Got %d chart data.", chartdata.length)

          for (var i = 0; i < chartdata.length; i++) {
            if (i < max_chart) {
              const c = chartdata[i]
              if (Array.isArray(c) && c.length > 4 && !isNaN(c[0]) && !isNaN(c[1]) && !isNaN(c[2]) && !isNaN(c[3]) && !isNaN(c[4])) {
                processed.push([c[0] * 1000, c[1], c[2], c[3], c[4]])
              } else {
                trace("WARN: Invalid chart data detected '%s'.", c)
              }
            } else
              break
          }

          return cb(null, processed)
        } else
          return cb(chartdata.errors, [])
      } else
        return cb(api_error_msg, [])
    }
  })
}

module.exports = {
  market_name: 'Btrmex',
  market_logo: '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',
  ext_market_url: 'https://www.bitoreum.exchange/market/',
  referal: 'refid=ID19CBFFCE97',
  market_url_template: market_url_template,
  market_url_case: 'l',  
  get_data: function(params, cb) {
    params.coin = params.coin.toLowerCase()
    params.exchange = params.exchange.toLowerCase()
    var error = null
    get_chartdata(params.coin, params.exchange, function (err, chartdata) {
      if (err) { 
        chartdata = []
        error = err
      }
      get_orders(params.coin, params.exchange, function(err, buys, sells) {
        if (err) { error = err }
        get_trades(params.coin, params.exchange, function(err, trades) {
          if (err) { error = err }
          get_summary(params.coin, params.exchange, trades, function(err, stats) {
            if (err) { error = err }
            return cb(error, {buys: buys, sells: sells, chartdata: chartdata, trades: trades, stats: stats})
          })
        })
      })
    })
  }
}