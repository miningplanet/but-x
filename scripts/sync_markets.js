const debug = require('debug')('sync')
const settings = require('../lib/settings')
const db = require('../lib/database')
const { MarketsDb, MarketOrderDb, MarketTradeDb, StatsDb } = require('../lib/database')
const util = require('./syncutil')
const fs = require('fs')

util.check_net_missing(process.argv)

const net = process.argv[2]

util.check_net_unknown(net)

const coin = settings.getCoin(net)
const lock = 'markets'
var stopSync = false

util.gracefully_shut_down(process, stopSync)

util.log_start(lock, net, coin)

if (!db.lib.is_locked([lock], net)) {
  db.lib.create_lock(lock, net)
  lockCreated = true

  util.init_db(net, function(status) {
    const markets_page = settings.get(net, 'markets_page')

    if (markets_page.enabled == true) {
      var complete = 0
      var total_pairs = 0
      var exchanges = Object.keys(markets_page.exchanges)

      // loop through exchanges and update trading pairs
      exchanges.forEach(function(key, index, map) {
        if (markets_page.exchanges[key].enabled == true) {
          if (db.fs.existsSync('./lib/markets/' + key + '.js')) {
            total_pairs += markets_page.exchanges[key].trading_pairs.length
            for (var i = 0; i < markets_page.exchanges[key].trading_pairs.length; i++) {
              // ensure trading pair setting is always uppercase
              markets_page.exchanges[key].trading_pairs[i] = markets_page.exchanges[key].trading_pairs[i].toUpperCase()
            }
          }
        }
      })

      // update trading pairs
      if (total_pairs > 0) {
        var rateLimitLib = require('../lib/ratelimit')
        var rateLimit = new rateLimitLib.RateLimit(1, 2000, false)
        // loop through and test all exchanges defined in the settings.json file
        exchanges.forEach(function(key, index, map) {
          // check if market is enabled via settings
          if (markets_page.exchanges[key].enabled == true) {
            if (db.fs.existsSync('./lib/markets/' + key + '.js')) {
              const exMarket = require('../lib/markets/' + key + '.js')
              // loop through all trading pairs
              markets_page.exchanges[key].trading_pairs.forEach(function(pair_key, pair_index, pair_map) {
                const split_pair = pair_key.split('/')
                const reverse = coin.symbol != split_pair[0]

                if (split_pair.length == 2) {
                  // lookup the exchange in the market collection
                  check_market(key, split_pair[0], split_pair[1], reverse, function(mkt, exists) {
                    if (!exists) {
                      // exchange doesn't exist in the market collection so add a default definition now
                      console.log('No %s: %s (reverse=%s) entry found. Creating new entry now..', exMarket.market_name, pair_key, reverse)
                      create_market(split_pair[0], split_pair[1], reverse, exMarket.market_name.toLowerCase(), exMarket.ext_market_url, exMarket.referal, exMarket.market_logo, function() {
                        // !!! automatically pause for 2 seconds in between requests
                        rateLimit.schedule(function() {
                          update_markets_db(key, split_pair[0], split_pair[1], reverse, function(err) {
                            if (!err) {
                              console.log('%s[%s]: Market data updated successfully.', key, pair_key)
                              complete++
                              if (complete == total_pairs || stopSync)
                                util.get_last_usd_price(stopSync, net)
                            } else {
                              console.log('%s[%s] Error: %s', key, pair_key, err)
                              complete++
                              if (complete == total_pairs || stopSync)
                                util.get_last_usd_price(stopSync, net)
                            }
                          }, net)
                        })
                      }, net)
                    } else {
                      rateLimit.schedule(function() {
                        update_markets_db(key, split_pair[0], split_pair[1], reverse, function(err) {
                          if (!err) {
                            console.log('%s[%s]: Market data updated successfully.', key, pair_key)
                            complete++
                            if (complete == total_pairs || stopSync)
                              util.get_last_usd_price(stopSync, net)
                          } else {
                            console.log('%s[%s] Error: %s', key, pair_key, err)
                            complete++
                            if (complete == total_pairs || stopSync)
                              util.get_last_usd_price(stopSync, net)
                          }
                        }, net)
                      })
                    }
                  }, net)
                }
              })
            } else {
              console.log('%s market is not installed', key)
              complete++
              if (complete == total_pairs || stopSync)
                util.get_last_usd_price(stopSync, net)
            }
          }
          // util.exit_remove_lock_completed(lock, coin, net)
        })
      } else {
        console.log('Error: No market trading pairs are enabled in settings')
        util.exit_remove_lock(1, lock, net)
      }
    } else {
      console.log('Error: Market feature is disabled in settings')
      util.exit_remove_lock(1, lock, net)
    }
  })
}

function create_market(coin_symbol, pair_symbol, reverse, market, ext_market_url, referal, logo, cb, net=settings.getDefaultNet()) {
  const dto = db.MarketsDb[net].create({
    market: market,
    ext_market_url: ext_market_url,
    referal: referal,
    logo: logo,
    coin_symbol: coin_symbol,
    pair_symbol: pair_symbol,
    reverse: reverse
  })
  if (dto) {
    console.log("Initial market entry created for %s: %s (reverse=%s), ext-url %s, referal %s", market, coin_symbol +'/' + pair_symbol, reverse, ext_market_url, referal)
  }
  return cb()
}

function check_market(market, coin_symbol, pair_symbol, reverse, cb, net=settings.getDefaultNet()) {
  db.MarketsDb[net].findOne({market: market, coin_symbol: coin_symbol, pair_symbol: pair_symbol }).then((data) => {
    return cb(market, data)
  }).catch((err) => {
    console.error("Failed to check market '%s' - '%s'/'%s' tx (reverse=%s) for chain '%s': %s", market, reverse ? pair_symbol : coin_symbol, reverse ? coin_symbol: pair_symbol, reverse, net, err)
    return cb(null)
  })
}

function update_markets_db(market, coin_symbol, pair_symbol, reverse, cb, net=settings.getDefaultNet()) {
  const coin = settings.getCoin(net)
  if (fs.existsSync('./lib/markets/' + market + '.js')) {
    db.get_market_data(market, coin_symbol, pair_symbol, reverse, function (err, obj) {
      if (err == null) {
        MarketsDb[net].updateOne({ market: market, coin_symbol: coin_symbol, pair_symbol: pair_symbol, reverse: reverse }, {
          chartdata: JSON.stringify(obj.chartdata),
          summary: obj.stats
        }).then(() => {
          const now = new Date().getTime()
          obj.buys.forEach((buy) => {
            copyOrderParam(buy, market, coin_symbol, pair_symbol, reverse == true ? 1 : 0, now)
          })
          obj.sells.forEach((sell) => {
            copyOrderParam(sell, market, coin_symbol, pair_symbol, reverse == true ? 0 : 1, now)
            obj.buys.push(sell)
          })
          // Renew offers.
          MarketOrderDb[net].insertMany(obj.buys).then(() => {
            MarketOrderDb[net].deleteMany({ex: market, market: coin_symbol, trade: pair_symbol, date: { $ne: now }}).then(() => {
              obj.trades.forEach((trade) => {
                copyHistoryParam(trade, market, coin_symbol, pair_symbol, now)
              })
              // Renew trade history.
              MarketTradeDb[net].insertMany(obj.trades).then(() => {
                MarketTradeDb[net].deleteMany({market: coin_symbol, trade: pair_symbol, date: { $ne: now }}).then(() => {
                  const markets_page = settings.get(net, 'markets_page')
                  // check if this is the default market and trading pair
                  if (market == markets_page.default_exchange.exchange_name && markets_page.default_exchange.trading_pair.toUpperCase() == coin_symbol.toUpperCase() + '/' + pair_symbol.toUpperCase()) {
                    StatsDb[net].updateOne({coin: coin.name}, {
                      last_price: obj.stats.last
                    }).then(() => {
                      // finished updating market data
                      return cb(null)
                    })
                  } else {
                    // this is not the default market so we are finished updating market data
                    return cb(null)
                  }
                })
              })
            })
          })
        })
      } else {
        return cb(err)
      }
    }, net)
  } else {
    return cb('market is not installed')
  }
}

function copyOrderParam(data, market, coin_symbol, pair_symbol, type, now) {
  data['ex'] = market
  data['market'] = coin_symbol
  data['trade'] = pair_symbol
  data['type'] = type
  data['date'] = now
}