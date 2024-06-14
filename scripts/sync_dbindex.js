const debug = require('debug')('sync')
const settings = require('../lib/settings')
const db = require('../lib/database')
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
    if (!dbindex)
      util.exit_remove_lock_completed(lock, coin, net)

    update_block_stats_from_db(algos, dbindex, function() {
      update_tx_by_type(dbindex, function () {
        const tx_type_index  = settings.get(net, 'tx_types').indexOf('TRANSACTION_COINBASE')
        update_latest_coinbase_tx(tx_type_index, dbindex, function () {
          update_masternodes_by_country_code(dbindex, function(mn) {
            
            db.get_markets_local(function(markets) {
              if (Array.isArray(markets) && markets.length > 0) {
                debug("Got markets size %d for net '%s'.", markets.length, net)

                update_sell_order_aggregation(coin.symbol, dbindex, function () {
                  update_buy_order_aggregation(coin.symbol, dbindex, function () {
                    update_dbindex_and_exit(coin, dbindex)
                  })
                })
              } else {
                update_dbindex_and_exit(coin, dbindex)
              }
            }, net)
          })
        })
      })
    })
  })
})

function update_dbindex_and_exit(coin, stats) {
  db.DbIndexDb[net].updateOne({coin: coin.name}, stats).then(() => {
    console.log("Updated dbindex for coin '%s' and chain '%s'.", coin.name, net)
    util.exit_remove_lock_completed(lock, coin, net)
  }).catch((err) => {
    console.error("Failed to update dbindex database: %s", err)
    util.exit_remove_lock(2, lock, net)
  })
}

function create_or_get_dbindex(coinName, cb) {
  db.get_dbindex_local(coinName, function(dbindex) {
    if (dbindex) {
      return cb(dbindex)
    }

    const dto = db.DbIndexDb[net].create({
      coin: coinName,
      chain: net
    }).then((dbindex) => {
      console.log("Initial dbindex entry created for %s value %o.", coinName, dto)
      cb(dbindex)
    }).catch((err) => {
      console.error("Failed to create initial dbindex for chain '%s': %s.", net, err)
    })
  }, net)
}

function update_tx_by_type(dbindex, cb) {
  db.TxDb[net].aggregate([{"$group" : {_id: "$tx_type", "count": {"$sum":1}}}, {"$sort": {"_id": 1}}]).then(txtypes => {
    if (Array.isArray(txtypes)) {
      var txes = 0
      for (var i = 0; i < txtypes.length; i++)
        if (!isNaN(txtypes[i].count))
          txes += txtypes[i].count

      for (var i = 0; i < txtypes.length; i++) {
        if (!isNaN(txtypes[i].count))
          txtypes[i].percent = 100 / txes * txtypes[i].count
      }
      dbindex.count_txes = txes
      dbindex.count_tx_by_type = txtypes
      debug("Got tx count (by type) %d from db for net '%s'.", txes, net)
    }
    cb(txtypes)
  }).catch((err) => {
    console.error("Failed to count tx types by blocks for chain '%s': %s", net, err)
    cb(err)
  })
}

function update_latest_coinbase_tx(tx_type, dbindex, cb) {
  db.TxDb[net].find({tx_type: tx_type}).sort({blockindex:-1}).limit(1).then((tx) => {
    if (Array.isArray(tx) && tx.length > 0) {
      dbindex.latest_coinbase_tx = tx[0]
      debug("Got latest coinbase '%s' for net '%s' from db, type %d, height %d", tx[0].txid, net, tx[0].tx_type, tx[0].blockindex)
    }
    cb(tx)
  }).catch((err) => {
    console.error("Failed to get latest coinbase tx for chain '%s': %s", net, err)
    cb(null)
  })
}

function update_sell_order_aggregation(coin_symbol, dbindex, cb) {
  get_order_aggregation(coin_symbol, 0, function (sells) {
    if (Array.isArray(sells)) {
      dbindex.sell_order_aggregation = sells
      debug("Got market sell order aggregation size %d for net '%s'.", sells.length, net)
    } else {
      dbindex.sell_order_aggregation = []
    }
    cb(sells)
  })
}

function update_buy_order_aggregation(coin_symbol, dbindex, cb) {
  get_order_aggregation(coin_symbol, 1, function (buys) {
    if (Array.isArray(buys)) {
      dbindex.buy_order_aggregation = buys
      debug("Got market buy order aggregation size %d for net '%s'.", buys.length, net)
    } else {
      dbindex.buy_order_aggregation = []
    }
    cb(buys)
  })
}

function get_order_aggregation(coin_symbol, type, cb) {
  const markets_page = settings.get(net, 'markets_page')
  if (markets_page.enabled == true) {
    db.MarketOrderDb[net].aggregate([{$match: {type:type}}, {$group: {_id: {type:"$type", trade:"$trade"}, sum_val:{$sum: { $multiply: ["$price", "$quantity"]}} }}]).then((data) => {
      cb(data ? data : null)
    }).catch((err) => {
      console.error("Failed to get orders aggregation with sum '%s' - '%s' tx for chain '%s': %s", type, coin_symbol, net, err)
      cb(err)
    })
  }
  return cb(null)
}

function update_block_stats_from_db(algos, dbindex, cb) {
  get_max_block_height(function(height) {
    if (!isNaN(height)) {
      dbindex.latest_block_height = height
      debug("Got max. block height %d from db for net '%s'.", height, net)
    }

    if (algos.length > 1) {
        count_blocks_by_algorithm(dbindex, function (blocks_by_algorithm) {
        cb()
      })
    } else {
      count_blocks(function(count) {
        if (!isNaN(count)) {
          dbindex.count_blocks = count
          debug("Got block count %d from db for net '%s'.", dbindex.count, net)
        }
        cb()
      })
    }
  })
}

function get_max_block_height(cb) {
  db.BlockDb[net].find().sort({ height: -1 }).limit(1).then(block => {
    cb(Array.isArray(block) && block.length > 0 ? block[0].height : undefined)
  }).catch((err) => {
    console.error("Failed to get max block height for chain '%s': %s", net, err)
    cb(err)
  })
}

function count_blocks(cb) {
  db.BlockDb[net].countDocuments().then(count => {
    cb(count)
  }).catch((err) => {
    console.error("Failed to count blocks for chain '%s': %s", net, err)
    cb(err)
  })
}

function count_blocks_by_algorithm(dbindex, cb) {
  db.BlockDb[net].aggregate([{"$group" : {_id: "$algo", "count": {"$sum":1}}}, {"$sort": {"_id": 1}}]).then(algos => {
    if (Array.isArray(algos)) {
      var blocks = 0
      for (var i = 0; i < algos.length; i++)
        if (!isNaN(algos[i].count))
          blocks += algos[i].count

      for (var i = 0; i < algos.length; i++) {
        if (!isNaN(algos[i].count))
          algos[i].percent = 100 / blocks * algos[i].count
      }

      dbindex.count_blocks = blocks
      dbindex.count_blocks_by_algorithm = algos
      debug("Got block count (by algos) %d from db for net '%s'.", dbindex.count_blocks, net)
    }
    cb(algos)
  }).catch((err) => {
    console.error("Failed to count blocks by algorithm for chain '%s': %s", net, err)
    cb(err)
  })
}

function update_masternodes_by_country_code(dbindex, cb) {
  db.MasternodeDb[net].aggregate([{"$match": {"status": "ENABLED" }}, { "$group" : {_id: "$country_code", "count": {"$sum":1}}}, {"$sort": {"_id": 1}}]).then(nodes => {
    if (Array.isArray(nodes)) {
      var count = 0
      for (var i = 0; i < nodes.length; i++)
        if (!isNaN(nodes[i].count))
          count += nodes[i].count

      for (var i = 0; i < nodes.length; i++) {
        if (!isNaN(nodes[i].count))
          nodes[i].percent = 100 / count * nodes[i].count
      }
      
      dbindex.count_masternodes_enabled = count
      dbindex.count_masternodes_by_country = nodes
      debug("Got masternodes by country code size %d for net '%s'.", nodes.length, net)
    }

    cb(nodes)
  }).catch((err) => {
    console.error("Failed to count masternodes by country code for chain '%s': %s", net, err)
    cb(err)
  })
}