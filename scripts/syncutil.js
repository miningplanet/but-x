const debug = require('debug')('market')
const mongoose = require('mongoose')
const settings = require('../lib/settings')
const db = require('../lib/database')
const { StatsDb } = require('../lib/database')
const coingecko = require('../lib/apis/coingecko')
const request = require('postman-request')

function check_net_missing(argv) {
  if (argv.length < 3) {
    console.error("Invalid parameters. Use net, one of %s.", settings.getAllNet())
    process.exit(1)
  }
}

function check_net_unknown(net) {
  if (!settings.getAllNet().includes(net)) {
    console.error("Invalid parameters. Use net, one of %s.", settings.getAllNet())
    process.exit(1)
  }
}

function get_int_param(args, index) {
  if (!isNaN(args[index]))
    return Number(args[index])
  else {
    console.warn("Failed get int parameter at index %d: %o", index, args)
    return -1
  }
}

function get_int_list_param(args, index) {
  const string = args[index]
  const list = string.split(',')
  var valid = true
  for (l in list) {
    if (!Number.isInteger(l)) //  | Number(l) < 0
      valid = false
  }
  if (!valid)
    console.warn("Failed get int list parameter at index %d: %o", index, args)
  return list;
}

function init_db_if_enabled(net) {
  const enabled = settings.getDbOrNull(net).enabled
  if (enabled) {
    db.connection_factory(net, false, settings.getDbConnectionString(net), function(conn) {
      db.initialize_data_startup(function() {
        // NOOP
      }, net)
    })
  } else {
    console.log("Database for net '%s' is disabled.", net)
  }
}

function init_db(net, cb) {
  db.connection_factory(net, false, settings.getDbConnectionString(net), function(conn) {
    db.initialize_data_startup(function() {
      cb('initialized')
    }, net)
  })
}

function exit(exitCode) {
  // always disconnect mongo connection
  mongoose.disconnect()
  process.exit(exitCode)
}

function exit_remove_lock(exitCode, lock, net=settings.getDefaultNet()) {
  mongoose.disconnect()

  // remove lock if any
  if (db.lib.is_locked([lock], net)) {
    const fs = require('fs')
    const pid = process.pid.toString()
    const fname = './tmp/' + net + '-' + lock + '.pid'
    const pidFromFile = fs.readFileSync(fname)
    if (pid == pidFromFile) {
      if (db.lib.remove_lock(lock, net) == true) {
        process.exit(exitCode)
      } else {
        // error removing lock
        process.exit(1)    
      }
    }
  }
  process.exit(exitCode)
}

function exit_remove_lock_completed(lock, coin, net=settings.getDefaultNet()) {
  log_completed(lock, net, coin)
  exit_remove_lock(0, lock, net)
}

function gracefully_shut_down(process, stopSync) {
  process.on('SIGINT', () => {
    console.log('Stopping sync process.. Please wait..')
    stopSync = true
  })
  
  // prevent killing of the sync script to be able to gracefully shut down
  process.on('SIGTERM', () => {
    console.log('Stopping sync process.. Please wait..')
    stopSync = true
  })
}

function get_last_usd_price(stopSync, net=settings.getDefaultNet()) {
  // get_last_usd_price_by_coingecko
  // get_last_usd_price_by_xeggex
  // get_last_usd_price_by_exbitron
  get_last_usd_price_by_xeggex(function(err) {
    if (err == null) {
      const coin = settings.getCoin(net)
      update_last_updated_stats(coin.name, { markets_last_updated: Math.floor(new Date() / 1000) }, function(cb) {
        // check if the script stopped prematurely
        if (stopSync) {
          console.log('Market sync was stopped prematurely')
          exit(1)
        } else {
          console.log('Market sync complete')
          exit(0)
        }
      }, net)
    } else {
      console.log('Error: %s', err)
      exit(1)      
    }
  }, net)
}

function get_last_usd_price_by_coingecko(cb, net=settings.getDefaultNet()) {
  const coin = settings.getCoin(net)
  const markets_page = settings.get(net, 'markets_page')
  if (markets_page.exchanges[markets_page.default_exchange.exchange_name].enabled == true) {
    // get the list of coins from coingecko
    coingecko.get_coin_data(function (err, coin_list) {
      if (debug.enabled)
        debug('Got coin list from coingecko: %o.', coin_list)
      // check for errors
      if (err == null) {
        var symbol = markets_page.default_exchange.trading_pair.split('/')[1]
        var index = coin_list.findIndex(p => p.symbol.toLowerCase() == symbol.toLowerCase())

        // check if the default market pair is found in the coin list
        if (index > -1) {
          // get the usd value of the default market pair from coingecko
          coingecko.get_data(coin_list[index].id,  function (err, last_usd) {
            // check for errors
            if (err == null) {
              // get current stats
              StatsDb[net].findOne({coin: coin.name}).then((stats) => {
                StatsDb[net].updateOne({coin: coin.name}, {
                  last_usd_price: (last_usd * stats.last_price)
                }).then(() => {
                  // last usd price updated successfully
                  return cb(null)
                })
              })
            } else {
              // return error msg
              return cb(err)
            }
          })
        } else {
          // return error msg
          return cb('cannot find symbol ' + symbol + ' in the coingecko api')
        }
      } else {
        // return error msg
        return cb(err)
      }
    })
  } else {
    // default exchange is not enabled so just exit without updating last price for now
    return cb(null)
  }
}

function get_last_usd_price_by_xeggex(cb, net=settings.getDefaultNet()) {
  const coin = settings.getCoin(net)
  const markets_page = settings.get(net, 'markets_page')
  const req_url = 'https://api.xeggex.com/api/v2/asset/info?id=' + coin.symbol + '&ticker=' + coin.symbol
  if (markets_page.exchanges[markets_page.default_exchange.exchange_name].enabled == true) {
    request({uri: req_url, json: true}, function (error, response, summary) {
      if (error)
        return cb(error)
      else {
        if (summary != null) {
          if (!isNaN(summary.usdValue)) {
            console.log("Got latest USD price for '%s' from xeggex: %d", net, summary.usdValue)
            if (debug.enabled)
              debug("Got %o summary data.", summary)
            StatsDb[net].findOne({coin: coin.name}).then((stats) => {
              StatsDb[net].updateOne({coin: coin.name}, {
                last_usd_price: summary.usdValue
              }).then(() => {
                // last usd price updated successfully
                return cb(null)
              })
            })
          } else
            return cb("Summary USD value is not a for '%s'.", coin.symbol)
        } else
          return cb("Summary not found for '%s'.", coin.symbol)
      }
    })
  } else {
    // default exchange is not enabled so just exit without updating last price for now
    return cb(null)
  }
}

function get_last_usd_price_by_exbitron(cb, net=settings.getDefaultNet()) {
  const coin = settings.getCoin(net)
  const markets_page = settings.get(net, 'markets_page')
  const req_url = 'https://api.exbitron.digital/api/v1/trading/info/' + coin.symbol + '-USDT'
  if (markets_page.exchanges[markets_page.default_exchange.exchange_name].enabled == true) {
    request({uri: req_url, json: true}, function (error, response, summary) {
      if (error)
        return cb(error)
      else {
        if (summary != null && summary.data != null && summary.data.market != null && summary.data.market.marketDynamics != null) {
          const lastPrice = summary.data.market.marketDynamics.lastPrice
          if (!isNaN(lastPrice)) {
            console.log("Got latest USDT price for '%s' from xeggex: %d", net, lastPrice)
            if (debug.enabled)
              debug("Got %o summary data.", summary)
            StatsDb[net].findOne({coin: coin.name}).then((stats) => {
              StatsDb[net].updateOne({coin: coin.name}, {
                last_usd_price: lastPrice
              }).then(() => {
                // last usd price updated successfully
                return cb(null)
              })
            })
          } else
            return cb("Summary USD value is not a for '%s'.", coin.symbol)
        } else
          return cb("Summary not found for '%s'.", coin.symbol)
      }
    })
  } else {
    // default exchange is not enabled so just exit without updating last price for now
    return cb(null)
  }
}

function create_or_get_dbindex(net, coinName, cb) {
  db.get_dbindex_local(coinName, function(dbindex) {
    if (dbindex) {
      if (!isNaN(dbindex.count_blocks) && !isNaN(dbindex.latest_block_height) && dbindex.count_blocks != dbindex.latest_block_height)
        console.warn("!!! Block index in db for net '%s' is invalid. !!!", net)
      return cb(dbindex)
    }

    const dto = db.DbIndexDb[net].create({
      coin: coinName,
      chain: net
    }).then((dbindex) => {
      console.log("Initial dbindex entry created for %s value %o.", coinName, dbindex)
      cb(dbindex)
    }).catch((err) => {
      console.error("Failed to create initial dbindex for chain '%s': %s.", net, err)
    })
  }, net)
}


function create_or_get_stats(net, coinName, cb) {
  db.get_stats_local(coinName, function(stats) {
    if (stats) {
      return cb(stats)
    }

    const dto = db.StatsDb[net].create({
      coin: coinName,
      chain: net,
      last: 0
    }).then((stats) => {
      console.log("Initial stats entry created for %s value %o.", coinName, stats)
      cb(stats)
    }).catch((err) => {
      console.error("Failed to create initial stats for chain '%s': %s.", net, err)
      cb(null)
    })
  }, net)
}

function update_last_updated_stats(coin, param, cb, net=settings.getDefaultNet()) {
  const dto = {}
  if (param.blockchain_last_updated) {
    dto.blockchain_last_updated = param.blockchain_last_updated
  } else if (param.reward_last_updated) {
    dto.reward_last_updated = param.reward_last_updated
  } else if (param.masternodes_last_updated) {
    dto.masternodes_last_updated = param.masternodes_last_updated
  } else if (param.network_last_updated) {
    dto.network_last_updated = param.network_last_updated
  } else if (param.richlist_last_updated) {
    dto.richlist_last_updated = param.richlist_last_updated
  } else if (param.markets_last_updated) {
    dto.markets_last_updated = param.markets_last_updated
  } else {
    // invalid option
    return cb(false)
  }
  db.StatsDb[net].updateOne({ coin: coin }, dto).then(() => {
    return cb(true)
  }).catch((err) => {
    console.error("Failed to update stats for chain '%s': %s", net, err)
    // return cb([])
  })
}

function get_stats(coinName, cb, net) {
  db.StatsDb[net].findOne({coin: coinName}).then((data) => {
    return cb(data)
  }).catch((err) => {
    console.error("Failed to find stats for chain '%s': %s", net, err)
    return cb(null)
  })
}

function log_start(objname, net, coin) {
  console.log("\n****** Sync %s for net '%s' ('%s'). ******\n", objname, net, coin.symbol)
}

function log_completed(objname, net, coin) {
  console.log("\n****** Sync %s for net '%s' ('%s') completed. ******\n", objname, net, coin.symbol)
}

module.exports = {
  check_net_missing: check_net_missing,
  check_net_unknown: check_net_unknown,
  get_int_param: get_int_param,
  get_int_list_param: get_int_list_param,
  init_db_if_enabled: init_db_if_enabled,
  init_db: init_db,
  exit: exit,
  exit_remove_lock: exit_remove_lock,
  exit_remove_lock_completed: exit_remove_lock_completed,
  gracefully_shut_down: gracefully_shut_down,
  get_last_usd_price: get_last_usd_price,
  create_or_get_dbindex: create_or_get_dbindex,
  create_or_get_stats: create_or_get_stats,
  update_last_updated_stats: update_last_updated_stats,
  get_stats: get_stats,
  log_start: log_start,
  log_completed: log_completed
}
