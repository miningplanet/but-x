const debug = require('debug')('sync')
const settings = require('../lib/settings')
const lib = require('../lib/x')
const db = require('../lib/database')
const { DbIndexDb, BlockDb, TxDb, MarketOrderDb } = require('../lib/database')
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
  create_or_get_dbindex(coin.name, function (dbindex) {
    count_tx_by_type(0, function (count_tx_by_type) {
      if (count_tx_by_type)
        dbindex.count_tx_by_type = count_tx_by_type
      get_latest_coinbase_tx("5", function (latest_coinbase_tx) {
        if (latest_coinbase_tx)
          dbindex.latest_coinbase_tx = latest_coinbase_tx
        db.get_markets(function(markets) {
          get_order_aggregation(coin.symbol, 0, function (sells) {
            if (sells)
              dbindex.sell_order_aggregation = sells
            get_order_aggregation(coin.symbol, 1, function (buys) {
              if (buys)
                dbindex.buy_order_aggregation = buys
              if (algos.length > 1) {
                count_blocks_by_algorithm(0, function (blocks_by_algorithm) {
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

function create_or_get_dbindex(coinName, cb, net) {
  db.get_dbindex(coinName, function(dbindex) {
    if (dbindex) {
      return cb(dbindex)
    }
    db.get_stats(coinName, function (stats) {
      count = 0
      last = 0
      console.log("Try to init initial dbindex.")
      debug("Stats is %o.", stats)
      if (stats) {
        if (!isNaN(stats.count))
          count = stats.count
        if (!isNaN(stats.last))
          last = stats.last
      }
      
      const dto = DbIndexDb[net].create({
        coin: coinName,
        chain: net,
        count: count,
        last: last
      }).then((dbindex) => {
        console.log("Initial dbindex entry created for %s value %o.", coinName, dto)
        return cb(dbindex)
      }).catch((err) => {
        console.error("Failed to create initial dbindex for chain '%s': %s.", net, err)
        return cb()
      })
    }, net)
  }, net)
}

function count_tx_by_type(height=0, cb, net=settings.getDefaultNet()) {
  TxDb[net].aggregate([{"$match": {"blockindex": {"$gt":height}}}, {"$group" : {_id: "$tx_type", "count": {"$sum":1}}}, {"$sort": {"_id": 1}}]).then(txtypes => {
    return cb(txtypes)
  }).catch((err) => {
    console.error("Failed to count tx types by blocks for chain '%s': %s", net, err)
    return cb(err)
  })
}

function get_latest_coinbase_tx(tx_type, cb, net=settings.getDefaultNet()) {
  TxDb[net].find({tx_type: tx_type}).sort({blockindex:-1}).limit(1).then((tx) => {
    return cb(tx)
  }).catch((err) => {
    console.error("Failed to get latest coinbase tx for chain '%s': %s", net, err)
    return cb(null)
  })
}

function get_order_aggregation(coin_symbol, type, cb, net) {
  const markets_page = settings.get(net, 'markets_page')
  if (markets_page.enabled == true) {
    db.MarketOrderDb[net].aggregate([{$match: {type:type}}, {$group: {_id: {type:"$type", trade:"$trade"}, sum_val:{$sum: { $multiply: ["$price", "$quantity"]}} }}]).then((data) => {
      return cb(data ? data : null)
    }).catch((err) => {
      console.error("Failed to get orders aggregation with sum '%s' - '%s' tx for chain '%s': %s", type, coin_symbol, net, err)
      return cb(err)
    })
  }
  return cb(null)
}

function count_blocks_by_algorithm(height=0, cb, net=settings.getDefaultNet()) {
  BlockDb[net].aggregate([{"$match": {"height": {"$gt":height}}}, {"$group" : {_id: "$algo", "count": {"$sum":1}}}, {"$sort": {"_id": 1}}]).then(algos => {
    return cb(algos)
  }).catch((err) => {
    console.error("Failed to count blocks by algorithm for chain '%s': %s", net, err)
    return cb(err)
  })
}