const debug = require('debug')('sync')
const settings = require('../lib/settings')
const lib = require('../lib/x')
const db = require('../lib/database')
// const { StatsDb, BlocksDb } = require('../lib/database')
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
// const algos = settings.get(net, 'algos')
const lock = 'verifydb'
var stopSync = false

util.gracefully_shut_down(process, stopSync)

util.log_start(lock, net, coin)

if (db.lib.is_locked([lock], net)) {
  console.error("Skip verify DB for '%s' for net '%s'.", lock, net)
  util.exit_remove_lock(2, lock, net)
}

db.lib.create_lock(lock, net)
lockCreated = true

util.init_db(net, function(status) {
  console.log("Run verify DB mode '%s'.", mode)
  switch(mode) {
    case 'all':
      // code block
    case 'chain':
      verify_chain_in_db(function(state) {
        console.log("Verified DB mode '%s': %s", mode, state == true ? 'Ok' : 'Failed')
        util.exit_remove_lock_completed(lock, coin, net)
      }, net)
      break
    case 'block':
      verify_block_in_db(function(state) {
        console.log("Verified DB mode '%s': %s", mode, state == true ? 'Ok' : 'Failed')
        util.exit_remove_lock_completed(lock, coin, net)
      }, net)
      break
    default:
      console.error("Skip verify due to unknown verification mode '%s'.", mode)
  } 
})

function verify_block_in_db(cb, net) {
  const height = util.get_int_param(process.argv, 4)

  db.lib.get_blockhash(height, function(hash) {
    handle_block_hash_from_daemon_not_found(hash, height, lock, coin, net)

    db.lib.get_block(hash, function(block2) {
      handle_block_from_daemon_not_found(block2, height, lock, coin, net)
      console.log("Got block '%s' from daemon, height %d, txes %d.", block2.hash, block2.height, block2.tx.length)

      handle_block_from_daemon_has_no_tx(block2, height, lock, coin, net)
      debug('Txes: ' + JSON.stringify(block2.tx, null, " "))

      db.get_block_by_height(height, function(block) {
        handle_block_from_db_not_found(block, height, lock, coin, net)

        lib.syncLoop(block2.tx.length, function (loop) {
          const i = loop.iteration()
          
          lib.get_rawtransaction(block2.tx[i], function(tx) {
            const txouts = get_txouts_by_tx(tx)
            console.log("Got tx '%s' type %s from daemon, txouts: %d", tx.txid, tx.type, txouts.length)
            debug("Txouts: ", txouts)

            if (txouts.length > 0) {
              db.AddressTxDb[net].find({ blockindex: height, txid: tx.txid }).then(txoutsbydb => {
                console.log("Got tx '%s' type %s from db, txouts: %d", txoutsbydb.tx_id, txoutsbydb.tx_type, txoutsbydb.length)
                for (var i = 0; i < txoutsbydb.length; i++) {
                  var txout1 = txoutsbydb[i]
                  var type = txout1.amount > 0 ? 'vout' : 'vin'
                  debug("Txout: %o", { type: type, received: txout1.amount, balance: txout1.amount })
                }
                loop.next()
              }).catch((err) => {
                console.error("Failed to count blocks for chain '%s' until %d: %s", net, height, err)
                loop.next()
              })

            } else
              loop.next()

            // if (stopSync)
            //   loop.break(true)
            // loop.next()
          }, net)
        }, function() {
          util.exit_remove_lock_completed(lock, coin, net)
        })
      }, net)
    }, net)
  }, net)
}

function verify_chain_in_db(cb, net) {
  var height = '-1'
  if (process.argv[4])
    height = process.argv[4]

  count_blocks(height, function(count) {
    if (height > -1) {
      console.log("Verified blocks in DB: count %d, height %d.", count, height)
      cb(count == height)
    } else {
      get_max_block_height(function(max_height) {
        console.log("Verified blocks in DB: count %d, height %d.", count, max_height)
        cb(count == max_height)
      }, net)
    }
  }, net)
}

function count_blocks(until_block, cb, net) {
  var criteria = {}
  if (until_block > -1 )
    criteria = { height: { $lte : until_block }}

  db.BlockDb[net].countDocuments(criteria).then(count => {
    cb(count)
  }).catch((err) => {
    console.error("Failed to count blocks for chain '%s' until %d: %s", net, until_block, err)
    cb(err)
  })
}

function get_max_block_height(cb, net) {
  db.BlockDb[net].find().sort({ height: -1 }).limit(1).then(function (block) {
    cb(Array.isArray(block) && block.length > 0 ? block[0].height : -1)
  }).catch((err) => {
    console.error("Failed to get max block height for chain '%s': %s", net, err)
    cb(err)
  })
}

function get_txouts_by_tx(tx) {
  const r = []
  if (Array.isArray(tx.vin))
    for (i = 0; i < tx.vin.length; i++) {
      r.push(get_txout(tx.vin[i].txid, 'vin', tx.vin[i].valueSat))
    }
  else
    console.warn("Vin txout is no array. Skip.")

  if (Array.isArray(tx.vout))
    for (i = 0; i < tx.vout.length; i++) {
      r.push(get_txout(tx.vout[i].spentTxId, 'vout', tx.vout[i].valueSat))
    }
  else
    console.warn("Vout txout is no array. Skip.")

  return r
}

function get_txout(hash, type, amount) {
  const r = {}
  r.type = type
  if (hash == 'coinbase')
    r.sent = amount
  else {
    if (type === 'vin') {
      r.sent = amount
      r.balance = -amount
    } else {
      r.received = amount
      r.balance = amount
    }
  }
  return r
}

function handle_block_from_db_not_found(block, height, lock, coin, net) {
  if (!block) {
    console.error("Failed to get block %d for chain '%s' from DB.", height, net)
    util.exit_remove_lock_completed(lock, coin, net)
  }
}

function handle_block_hash_from_daemon_not_found(hash, height, lock, coin, net) {
  if (!hash) {
    console.error("Failed to get block hash for height %d for chain '%s' from daemon.", height, net)
    util.exit_remove_lock_completed(lock, coin, net)
  }
}

function handle_block_from_daemon_not_found(block, height, lock, coin, net) {
  if (!block) {
    console.error("Failed to get block %d for chain '%s' from daemon.", height, net)
    util.exit_remove_lock_completed(lock, coin, net)
  }
}

function handle_block_from_daemon_has_no_tx(block, height, lock, coin, net) {
  if (!Array.isArray(block.tx) || block.tx.length == 0) {
    console.error("Block %d for chain '%s' from daemon does not have transactions.", height, net)
    util.exit_remove_lock_completed(lock, coin, net)
  }
}