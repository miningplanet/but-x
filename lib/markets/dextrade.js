const debug = require('debug')('market')
const trace = require('debug')('trace')
const markets = require('../markets')
const settings = require('../settings')
const request = require('postman-request')
const base_url = 'https://api.dex-trade.com/v1/public/'
const base_chart_url = 'https://socket.dex-trade.com/graph/'
const api_error_msg = 'api did not return any data'
const market_url_template = 'https://dex-trade.com/spot/trading/{coin}{base}'

function get_summary(coin, exchange, bid, ask, trades, cb) {
  var summary = {}
  const req_url = base_url + 'ticker?pair=' + coin + exchange
  debug("Get market summery from %s.", req_url)

  request({ uri: req_url, json: true}, function (error, response, body) {
    if (error)
      return cb(error, null);
    else if (body.status == null || body.status == false)
      return cb(body.error, null);
    else {
      const start = Date.now() - 86400000
      const ticker = body.data
      var initial = Number(ticker['open'])
      const last = Number(ticker['last'])
      summary['initial'] = ticker['open'];
      summary['last'] = ticker['last'];
      summary['bid'] = bid;
      summary['ask'] = ask;
      summary['high'] = ticker['high'];
      summary['low'] = ticker['low'];
      summary['volume'] = ticker['volume_24H'];
      const now = Date.now()
      var n = Number(0)

      const pair = markets.pair(coin, exchange, trades, start)
      if (pair >= 0) {
        trace("Add pair volume %d.", pair)
        summary['volume_pair'] = pair
      }
      
      if (initial != 0) {
        const change = 100 * last / initial - 100
        trace("Add 24h variation %d. Initial %d, last %d.", change, initial, last)
        summary['change'] = change
      } else {
        // Try to find the previous day closing or today's opening
        const max_records = 1000
        const now = Date.now()
        trace("Get change by trade list opening.")
        for (var i = 0; i < trades.length; i++) {
          if (i < max_records) {
            if (Date.now() - now <= 86400000) {
              initial = Number(trades[i].price)
            } else
              break
          } else
            break
        }
        if (initial != 0) {
          const change = 100 * last / initial - 100
          trace("Add 24h variation %d. Initial %d, last %d.", change, initial, last)
          summary['change'] = change
        } else
          summary['change'] = '-'
      }
      return cb(null, summary);
    }
  }).on('error', function(err) {
    return cb(error, null);
  });
}

function get_trades(coin, exchange, cb) {
  const req_url = base_url + 'trades?pair=' + coin + exchange;
  debug("Get trade history from %s.", req_url)

  request({ uri: req_url, json: true}, function (error, response, body) {
    if (error)
      return cb(error, null);
    else if (body.status == null || body.status == false)
      return cb(body.error, null);
    else {
      const trade_body = body.data
      var trades = []
      const max_records = 1000
      debug("Got %d trade history items.", trade_body.length)
      for (var i = 0; i < trade_body.length; i++) {
        if (i < max_records) {
          trades.push({
            ordertype: trade_body[i].type,
            price: trade_body[i].rate,
            quantity: trade_body[i].volume,
            timestamp: trade_body[i].timestamp
          })
        } else
          break
      }

      return cb(null, trades);
    }
  }).on('error', function(err) {
    return cb(error, null);
  });
}

function get_orders(coin, exchange, cb) {
  const req_url = base_url + 'book?pair=' + coin + exchange
  debug("Get orders from %s.", req_url)

  request({ uri: req_url, json: true}, function (error, response, body) {
    if (error)
      return cb(error, [], []);
    else if (body.status == null || body.status == false)
      return cb(body.error, null);
    else {
      var buys = [];
      var sells = [];
      const orders = body.data;
      const buyLength = orders['buy'].length
      const sellLength = orders['sell'].length
      const max_records = 500;
      debug("Got %d buy order(s), %d sell orders(s).", buyLength, sellLength)

      for (var i = 0; i < buyLength; i++) {
        if (i < max_records) {
          buys.push({
            price: orders['buy'][i].rate,
            quantity: orders['buy'][i].volume
          })
        } else
          break
      }

      for (var i = 0; i < sellLength; i++) {
        if (i < max_records) {
          sells.push({
            price: orders['sell'][i].rate,
            quantity: orders['sell'][i].volume
          })
        } else
          break
      }
      
      return cb(null, buys, sells);
    }
  }).on('error', function(err) {
    return cb(error, null, null);
  });
}

function get_chartdata(coin, exchange, cb) {
  const end = Date.now();
  const start = end - 86400000;
  const req_url = base_chart_url + 'hist?t=' + coin + exchange + '&r=15&limit=100';
  debug("Get chart data from %s.", req_url)

  request({ uri: req_url, json: true}, function (error, response, chartdata) {
    if (error)
      return cb(error, []);
    else if (chartdata == null)
      return cb(api_error_msg, null);
    else {
      var processed = [];
      debug("Got %d chart data.", chartdata.length)

      for (var i = 0; i < chartdata.length; i++) {
        // only take values more recent than the last 24 hours
        if (chartdata[i].time * 1000 > start)
          processed.push([chartdata[i].time * 1000, chartdata[i].open, chartdata[i].high, chartdata[i].low, chartdata[i].close]);
        else
          break
      }

      return cb(null, processed);
    }
  });
}

module.exports = {
  market_name: 'DexTrade',
  market_logo: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAGTGlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNi4wLWMwMDIgNzkuMTY0NDYwLCAyMDIwLzA1LzEyLTE2OjA0OjE3ICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtbG5zOnhtcE1NPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvbW0vIiB4bWxuczpzdEV2dD0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL3NUeXBlL1Jlc291cmNlRXZlbnQjIiB4bWxuczpwaG90b3Nob3A9Imh0dHA6Ly9ucy5hZG9iZS5jb20vcGhvdG9zaG9wLzEuMC8iIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgMjEuMiAoV2luZG93cykiIHhtcDpDcmVhdGVEYXRlPSIyMDIyLTA2LTI2VDIxOjEwOjEwLTA2OjAwIiB4bXA6TWV0YWRhdGFEYXRlPSIyMDIyLTA2LTI2VDIxOjEwOjEwLTA2OjAwIiB4bXA6TW9kaWZ5RGF0ZT0iMjAyMi0wNi0yNlQyMToxMDoxMC0wNjowMCIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDozNDk5ZmMyYy02YjE0LWNhNDItOWNkYS05ODI4YTQ5MTBiNWMiIHhtcE1NOkRvY3VtZW50SUQ9ImFkb2JlOmRvY2lkOnBob3Rvc2hvcDpjMzIwOGQ5Yy05M2MyLTNkNDEtYTI0OC0yMjhkMjJkNjhmMmEiIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDoxYmVhYmUxYS1hY2FlLTQ1NGEtYThjMy1mMjlkMWNjOTBhZjkiIHBob3Rvc2hvcDpDb2xvck1vZGU9IjMiIGRjOmZvcm1hdD0iaW1hZ2UvcG5nIj4gPHhtcE1NOkhpc3Rvcnk+IDxyZGY6U2VxPiA8cmRmOmxpIHN0RXZ0OmFjdGlvbj0iY3JlYXRlZCIgc3RFdnQ6aW5zdGFuY2VJRD0ieG1wLmlpZDoxYmVhYmUxYS1hY2FlLTQ1NGEtYThjMy1mMjlkMWNjOTBhZjkiIHN0RXZ0OndoZW49IjIwMjItMDYtMjZUMjE6MTA6MTAtMDY6MDAiIHN0RXZ0OnNvZnR3YXJlQWdlbnQ9IkFkb2JlIFBob3Rvc2hvcCAyMS4yIChXaW5kb3dzKSIvPiA8cmRmOmxpIHN0RXZ0OmFjdGlvbj0ic2F2ZWQiIHN0RXZ0Omluc3RhbmNlSUQ9InhtcC5paWQ6MzQ5OWZjMmMtNmIxNC1jYTQyLTljZGEtOTgyOGE0OTEwYjVjIiBzdEV2dDp3aGVuPSIyMDIyLTA2LTI2VDIxOjEwOjEwLTA2OjAwIiBzdEV2dDpzb2Z0d2FyZUFnZW50PSJBZG9iZSBQaG90b3Nob3AgMjEuMiAoV2luZG93cykiIHN0RXZ0OmNoYW5nZWQ9Ii8iLz4gPC9yZGY6U2VxPiA8L3htcE1NOkhpc3Rvcnk+IDxwaG90b3Nob3A6RG9jdW1lbnRBbmNlc3RvcnM+IDxyZGY6QmFnPiA8cmRmOmxpPjMyOTEwNDQzQzdFMjhCQTc2QTlCNTRFQkNFMjczMDkwPC9yZGY6bGk+IDwvcmRmOkJhZz4gPC9waG90b3Nob3A6RG9jdW1lbnRBbmNlc3RvcnM+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8+3wqdeQAAA4xJREFUOI1NU2tMG1QUPrzpBlRs0U4efTAcK6UMQcu2zsdiZkZndKMjCyoUSCbskel8xB9zw2abmEDiwEQIREVd3TRubqL82SYT1gkUSmlpxyhtN1oeIzCpFST8+Ly96uJNvuSec/J955x7zqVx9x2a8EzSQL+Vhqw2amn7XLVHX96oVGlsaVJlUJKaFVRv0jpe2l3WZKw7XXjlSi/dHBimEecdGhrxEN0e91Hwj2Vyu31kqK41iiWZIEpgIFz9pRsXLlzm9zDWJKxD2StVjdYRJ03PLZFleILI5wvQ/MIilejLu4jiERUvRnyiBIaqWvx3tmp34HsmdLzuFBd6QVfS4/PPkcs9RTQzt0BHjr5nJIrGWmEqFI/n4zVDDTwe7wOBu34/Fu7fx++Li6DIRCYSAUN1zae+ST/RxUtdiqSH0yEUy1hQiJOnGljZlzixu/sGNm/RYnb2Hvr6+3BvbhbllbVMIAoxAhG+MX1bSIaqg00UIeTOQ0fehWPUha/PmtDS2obo+BResiq3COabfQgEAvjhcifzrQVFJGJvacV5Ktr6vJsoEhtVGsywTMM2G/YfeIMTk1PkWJ/9JH/UvCe0aGg4A7P5N+zeW8F8Aqjzt/hJ/KhiRbJOynsMBoP4sfNnaJ8tRlyCBPKsPEgz1UhX5CKW2U3NLTh3/jscOPwWkkUZSJfn/MUSJa7WHHqH92yxWNB9vYdNIgVpshxODiNNpgJFPQS7YxST/gB27ipBZnYBHnlswwrlFWi9QqYmX78JoVAInT918fIj40ScLM/KR6pMyX11H3zIE7V/9iW3c9Sbp6miuqYlbJTuq+TBcBums+dQrNNDkCTh/QtFMjyl2YZr164/GG1axgZoirZfpK86TMrY2CQ4nE78/9jtdpQb9kO3aw+am1vhdI3B4/PC6/Xh1q3bKC2rxPETp7fR0vIyvfn2+x/LMnOhe1GPg4ePwniyHq2t7VxkaelPhhACU/+MUCiS8vJfNbxuWlldZavsnyLvZICU6qLecCAiJhmFRdv5Kh87ZkRbeweustK9vrtsmQY4OTunwOp2eykwPUvUZxmhwMw8ucYnqLTM8EnsGjFfKqK4fz+VgCGGE6MFKXhZv69jcMgWOb8QIuuwk2jI5iSbY4wGbaP0a6+Z6usbnynWlXzBlmRMqlAHMxS5wY25GvfTz+00nTB+tKPHfIP6+gfJ5ZogO+P9DaehK5oI+uoTAAAAAElFTkSuQmCC',
  ext_market_url: 'https://dex-trade.com/refcode/3hgz4y',
  referal: '',
  market_url_template: market_url_template,
  market_url_case: 'u',
  get_data: function(settings, cb) {
    var error = null;
    get_chartdata(settings.coin.toUpperCase(), settings.exchange.toUpperCase(), function (err, chartdata) {
      if (err) { chartdata = []; error = err; }
      get_orders(settings.coin.toUpperCase(), settings.exchange.toUpperCase(), function(err, buys, sells) {
        if (err) { error = err; }
        get_trades(settings.coin.toUpperCase(), settings.exchange.toUpperCase(), function(err, trades) {
          if (err) { error = err; }
          get_summary(settings.coin.toUpperCase(), settings.exchange.toUpperCase(), (buys == null || buys.length == 0 ? null : buys[0].price), (sells == null || sells.length == 0 ? null : sells[0].price), trades, function(err, stats) {
            if (err) { error = err; }
            return cb(error, {buys: buys, sells: sells, chartdata: chartdata, trades: trades, stats: stats});
          });
        });
      });
    });
  }
};