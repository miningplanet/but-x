const debug = require('debug')('sync')
const settings = require('../lib/settings')
const lib = require('../lib/x')
const db = require('../lib/database')
const { DbIndexDb } = require('../lib/database')
const util = require('./syncutil')

util.check_net_missing(process.argv)

const net = process.argv[2]

util.check_net_unknown(net)

const timeout = 5000
var mode = 'all'
if (process.argv[3])
  mode = process.argv[3]

const coin = settings.getCoin(net)
// const wallet = settings.getWallet(net)
const algos = settings.get(net, 'algos')
const lock = 'dbindex'
var stopSync = false

util.gracefully_shut_down(process, stopSync)

util.log_start(lock, net, coin)

if (db.lib.is_locked([lock], net)) {
  console.error("Skip sync for '%s' for net '%s'.", lock, net)
  util.exit_remove_lock(2, lock, net)
}

db.lib.create_lock(lock, net)
lockCreated = true

util.init_db(net, function(status) {
  db.create_or_get_dbindex(coin.name, function (dbindex) {
    db.count_tx_by_type(0, function (count_tx_by_type) {
      if (count_tx_by_type)
        dbindex.count_tx_by_type = count_tx_by_type
      db.get_latest_coinbase_tx("5", function (latest_coinbase_tx) {
        if (latest_coinbase_tx)
          dbindex.latest_coinbase_tx = latest_coinbase_tx
        db.get_markets(function(markets) {
          db.get_order_aggregation(coin.symbol, 0, function (sells) {
            if (sells)
              dbindex.sell_order_aggregation = sells
            db.get_order_aggregation(coin.symbol, 1, function (buys) {
              if (buys)
                dbindex.buy_order_aggregation = buys
              if (algos.length > 1) {
                db.count_blocks_by_algorithm(0, function (blocks_by_algorithm) {
                  if (blocks_by_algorithm)
                    dbindex.count_blocks_by_algorithm = blocks_by_algorithm
                  update_dbindex_and_exit(coin, dbindex)
                }, net)
              } else
                update_dbindex_and_exit(coin, dbindex)
            }, net)
          }, net)
        }, net)
      }, net)
    }, net)
  }, net)
})

function update_dbindex_and_exit(coin, stats) {
  DbIndexDb[net].updateOne({coin: coin.name}, stats).then(() => {
    console.log("Updated dbindex for coin '%s' and chain '%s'.", coin.name, net)
    util.exit_remove_lock_completed(lock, coin, net)
  }).catch((err) => {
    console.error("Failed to update dbindex database: %s", err)
    util.exit_remove_lock(2, lock, net)
  })
}
