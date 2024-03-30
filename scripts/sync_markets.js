const debug = require('debug')('sync')
const settings = require('../lib/settings')
const db = require('../lib/database')
const util = require('./syncutil')

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
                  db.check_market(key, split_pair[0], split_pair[1], reverse, function(mkt, exists) {
                    if (!exists) {
                      // exchange doesn't exist in the market collection so add a default definition now
                      console.log('No %s: %s (reverse=%s) entry found. Creating new entry now..', exMarket.market_name, pair_key, reverse)
                      db.create_market(split_pair[0], split_pair[1], reverse, exMarket.market_name.toLowerCase(), exMarket.ext_market_url, exMarket.referal, exMarket.market_logo, function() {
                        // !!! automatically pause for 2 seconds in between requests
                        rateLimit.schedule(function() {
                          db.update_markets_db(key, split_pair[0], split_pair[1], reverse, function(err) {
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
                        db.update_markets_db(key, split_pair[0], split_pair[1], reverse, function(err) {
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