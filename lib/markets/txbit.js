const debug = require('debug')('market')
const trace = require('debug')('trace')
const markets = require('../markets')
const settings = require('../settings')
const max_orders = parseInt(settings.markets_page.exchanges.max_orders)
const max_history = parseInt(settings.markets_page.exchanges.max_history)
const max_chart = parseInt(settings.markets_page.exchanges.max_chart)
const request = require('postman-request')
const base_url = 'https://api.txbit.io/api/public/'
const market_url_template = 'https://txbit.io/Trade/{coin}/{base}'

function get_summary(coin, exchange, cb) {
  const req_url = base_url + 'getmarketsummary?market=' + coin + '/' + exchange
  debug("Get market summery from %s.", req_url)

  request({ uri: req_url, json: true}, function (error, response, body) {
    if (error)
      return cb(error, null)
    else if (body.success == null || body.success == false)
      return cb(body.message, null)
    else {
      const ticker = body.result
      const initial = Number(ticker.PrevDay)
      const last = Number(ticker.Last)
      const summary = {}

      summary['description'] = body.result.DisplayMarketName
      summary['bid'] = body.result.Bid
      summary['ask'] = body.result.Ask
      summary['high'] = body.result.High
      summary['low'] = body.result.Low
      summary['volume'] = body.result.Volume
      summary['volume_pair'] = body.result.BaseVolume
      summary['last'] = last
      summary['initial'] = initial
      summary['buys'] = body.result.OpenBuyOrders
      summary['sells'] = body.result.OpenSellOrders
      
      if (initial != 0) {
        const change = 100 * last / initial - 100
        trace("Add 24h variation %d. Initial %d, last %d.", change, initial, last)
        summary['change'] = change
      } else {
        summary['change'] = '-'
      }

      return cb(null, summary)
    }
  }).on('error', function(err) {
    return cb(error, null)
  })
}

function get_trades(coin, exchange, cb) {
  const req_url = base_url + 'getmarkethistory?market=' + coin + '/' + exchange
  debug("Get trade history from %s.", req_url)

  request({ uri: req_url, json: true}, function (error, response, body) {
    if (error)
      return cb(error, null)
    else if (body.success == null || body.success == false)
      return cb(body.message, null)
    else {
      var trade_body = body.result
      var trades = []
      debug("Got %d trade history items.", trade_body.length)
      for (var i = 0; i < trade_body.length; i++) {
        if (i < max_history) {
          trades.push({
            ordertype: trade_body[i].OrderType,
            price: trade_body[i].Price,
            quantity: trade_body[i].Quantity,
            timestamp: parseInt(new Date(trade_body[i].TimeStamp).getTime() / 1000)
          })
        } else
          break
      }

      return cb(null, trades)
    }
  }).on('error', function(err) {
    return cb(error, null)
  })
}

function get_orders(coin, exchange, cb) {
  const req_url = base_url + 'getorderbook?market=' + coin + '/' + exchange + '&type=both'
  debug("Get orders from %s.", req_url)

  request({ uri: req_url, json: true}, function (error, response, body) {
    if (error)
      return cb(error, [], [])
    else if (body.success == null || body.success == false)
      return cb(body.message, null)
    else {
      var orders = body.result
      var buys = []
      var sells = []
      const buyLength = orders['buy'].length
      const sellLength = orders['sell'].length
      debug("Got %d buy order(s), %d sell order(s).", buyLength, sellLength)

      for (var i = 0; i < buyLength; i++) {
        if (i < max_orders) {
          buys.push({
            price: orders['buy'][i].Rate,
            quantity: orders['buy'][i].Quantity
          })
        } else
          break
      }
      
      orders['sell'].reverse()
      for (var i = 0; i < sellLength - 1; i++) {
        if (i < max_orders) {
          sells.push({
            price: orders['sell'][i].Rate,
            quantity: orders['sell'][i].Quantity
          })
        } else
          break
      }
      
      return cb(null, buys, sells)
    }
  }).on('error', function(err) {
    return cb(error, null, null)
  })
}

module.exports = {
  market_name: 'Txbit',
  market_logo: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAABF1BMVEUAAAD/rwD/swD/sAD/pwD/sQA2fuH/tAD/sgA5gOH/swAteN//tAD/swD/pwA4f+E5f+H/8r3/vTP///84f+H/swC81vv/qQDz9/3/swA4f+H/swD/+bb/tABCheL+swA4f+E5gOH///83f+H/swA5gOH/pwA8geIbbN0UaNz/sAAjcd4LYtv/qgAweuD/9tn/uBzm8v/c6fqkxPF4qexQj+ZFiOMpdd//3Ir/zlT/vyb/sgD/pAD/owD/mgDN4v/I4P++2v////vW5fnJ3Pe0zvOSuvKKtvJypOproOn/+eb/+OZUkOVNjOQRZtsAWNj/88//4qz/4p7/5Iz/4on/3n//3Hr/0W//x1L/yUv/wkH/sxP/tQC42zL+AAAAInRSTlMAGOLOzsW+rZqUfHdu9/Xs6Ofny8mhmpCOjoaBdjYzJyEVZSx5kAAAANRJREFUGNMtylViAkEQRdEaNATi7slrm+5R3Im7u7H/ddAwnL+69WjMKeXTmXzJoandedOPf013bja519EZ/OBOdjlfI6uoyi+vwF/ALbs5Ct1zoBUMpDS2OFTUF8C9/P/8aBs55DuUa17e1BDBimLJs7SovCddwWm9cYUoMClaYEzoB1R8/XyNtkzRKrPFrVUboSfw3kvT9jgIVzPl1/HV26JDNqFC3ztGJzggKiQT97aMlpwhKyeU5z+e4OxbZmmi0BRV4C3u239if3NlaTmzsUfWCENmIl5ka+2dAAAAAElFTkSuQmCC',
  ext_market_url: 'https://txbit.io/?r=7eb62',
  referal: 'r=7eb62',
  market_url_template: market_url_template,
  market_url_case: 'u',
  get_data: function(settings, cb) {
    var error = null
    get_orders(settings.coin.toUpperCase(), settings.exchange.toUpperCase(), function(err, buys, sells) {
      if (err) { error = err }
      get_trades(settings.coin.toUpperCase(), settings.exchange.toUpperCase(), function(err, trades) {
        if (err) { error = err }
        get_summary(settings.coin.toUpperCase(), settings.exchange.toUpperCase(), function(err, stats) {
          if (err) { error = err }
          return cb(error, {buys: buys, sells: sells, trades: trades, stats: stats})
        })
      })
    })
  }
}