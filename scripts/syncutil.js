const debug = require('debug')('debug')
const mongoose = require('mongoose')
const settings = require('../lib/settings')
const db = require('../lib/database')
const { StatsDb } = require('../lib/database')

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

function init_db_if_enabled(net) {
  const enabled = settings.getDbOrNull(net).enabled
  if (enabled) {
    db.connection_factory(net, settings.getDbConnectionString(net), function(conn) {
      db.initialize_data_startup(function() {
        // NOOP
      }, net)
    })
  } else {
    console.log("Database for net '%s' is disabled.", net)
  }
}

function init_db(net, cb) {
  db.connection_factory(net, settings.getDbConnectionString(net), function(conn) {
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
  db.get_last_usd_price(function(err) {
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
  init_db_if_enabled: init_db_if_enabled,
  init_db: init_db,
  exit: exit,
  exit_remove_lock: exit_remove_lock,
  exit_remove_lock_completed: exit_remove_lock_completed,
  gracefully_shut_down: gracefully_shut_down,
  get_last_usd_price: get_last_usd_price,
  update_last_updated_stats: update_last_updated_stats,
  get_stats: get_stats,
  log_start: log_start,
  log_completed: log_completed
}
