const debug = require('debug')('market')
const trace = require('debug')('trace')
const markets = require('../markets')
const settings = require('../settings')
const max_orders = parseInt(settings.markets_page.exchanges.max_orders)
const max_history = parseInt(settings.markets_page.exchanges.max_history)
const max_chart = parseInt(settings.markets_page.exchanges.max_chart)
const request = require('postman-request')
const base_url = 'https://xeggex.com/api/v2/'
const api_error_msg = 'api did not return any data'
const market_url_template = 'https://xeggex.com/market/{coin}_{base}'

function get_summary(coin, exchange, trades, cb) {
  const req_url = base_url + 'market/getbysymbol/' + coin + '_' + exchange
  
  debug("Get market summary from %s.", req_url)
  request({uri: req_url, json: true}, function (error, response, body) {
    if (error)
      return cb(error, null)
    else {
      if (body != null) {
        if (body.errors)
          return cb(body.errors, null)
        else {
          const start = Date.now() - 86400000
          const summary = {}              
          const ticker = body

          if (!isNaN(ticker['bestBidNumber']))
            summary['bid'] = ticker['bestBidNumber']

          if (!isNaN(ticker['bestAskNumber']))
            summary['ask'] = ticker['bestAskNumber']

          if (!isNaN(ticker['highPriceNumber']))
            summary['high'] = ticker['highPriceNumber']
          else {
            const high = markets.high(coin, exchange, trades, start)
            if (high > 0) {
              trace("Add high %d.", high)
              summary['high'] = high
            }
          }
          
          if (!isNaN(ticker['lowPriceNumber']))
            summary['low'] = ticker['lowPriceNumber']
          else {
            const low = markets.low(coin, exchange, trades, start)
            if (low < Number.MAX_SAFE_INTEGER) {
              trace("Add low %d.", low)
              summary['low'] = low
            }
          }

          if (!isNaN(ticker['volumeNumber']))
            summary['volume'] = ticker['volumeNumber']

          if (!isNaN(ticker['volumeSecondaryNumber']))
            summary['volume_pair'] = ticker['volumeSecondaryNumber']
          else {
            const pair = markets.pair(coin, exchange, trades, start)
            if (pair >= 0) {
              trace("Add pair volume %d.", pair)
              summary['volume_pair'] = pair
            }
          }

          var last
          if (!isNaN(ticker['lastPriceNumber'])) {
            last = ticker['lastPriceNumber']
            summary['last'] = last
          } else {
            last = markets.last(coin, exchange, trades, start)
            if (!isNaN(last)) {
              summary['last'] = last
            }
          }

          var initial 
          if (!isNaN(ticker['yesterdayPriceNumber'])) {
            initial = ticker['yesterdayPriceNumber']
            summary['initial'] = initial
          } else {
            initial = markets.initial(coin, exchange, trades, start)
            if (!isNaN(initial))
              summary['initial'] = initial
          }

          if (ticker['changePercent'])
            summary['change'] = parseFloat(ticker['changePercent'])
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
      }
    }
  })
}

function get_trades(coin, exchange, cb) {
  const req_url = base_url + 'historical_trades?ticker_id=' + coin + '_' + exchange + '&limit=' + max_history

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
              if (body[i]['type'])
                trades.push({
                  ordertype: body[i]['type'].toUpperCase(),
                  price: !isNaN(body[i]['price']) ? body[i]['price'] : '',
                  quantity: !isNaN(body[i]['base_volume']) ? body[i]['base_volume'] : '',
                  quantity_pair: !isNaN(body[i]['target_volume']) ? body[i]['target_volume'] : '',
                  total: !isNaN(body[i]['total']) ? body[i]['total'] : '',
                  timestamp: !isNaN(body[i]['trade_timestamp']) ? body[i]['trade_timestamp'] : ''
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
  const req_url = base_url + 'orderbook?ticker_id=' + coin + '_' + exchange + '&depth=' + max_orders

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
          // orders.asks.reverse()
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
  const req_url = base_url + coin + exchange + '/k-line?time_from=' + parseInt(start) + '&time_to=' + parseInt(end) + '&period=15'
  
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
  market_name: 'xeggex',
  market_logo: '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',
  ext_market_url: 'https://xeggex.com/market/', // BTC_USDT
  referal: 'ref=64b189de12f3fc08fd6dccc2',
  market_url_template: market_url_template,
  market_url_case: 'l',  
  get_data: function(params, cb) {
    params.coin = params.coin.toUpperCase()
    params.exchange = params.exchange.toUpperCase()
    var error = null
    // get_chartdata(settings.coin, settings.exchange, function (err, chartdata) {
    //   if (err) { 
    //     chartdata = []
    //     error = err
    //   }
    chartdata = []
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
    // })
  }
}