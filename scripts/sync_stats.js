const debug = require('debug')('sync')
const settings = require('../lib/settings')
const lib = require('../lib/x')
const db = require('../lib/database')
const { StatsDb } = require('../lib/database')
const util = require('./syncutil')

util.check_net_missing(process.argv)

const net = process.argv[2]

util.check_net_unknown(net)

const timeout = 5000
var mode = 'all'
if (process.argv[3])
  mode = process.argv[3]

const coin = settings.getCoin(net)
const wallet = settings.getWallet(net)
const algos = settings.get(net, 'algos')
const lock = 'stats'
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
  StatsDb[net].findOne({coin: coin.name}).then((stats) => {
    if (typeof stats === 'undefined') {
      console.error("Failed to load stats by database for net '%s': %s", net, err)
      util.exit_remove_lock(2, lock, net)
    }
    if (Boolean(stats.chain) == false) {
      stats.chain = wallet.chain
    }
    db.lib.get_blockchaininfo(net, function(info) {
      if (typeof info === 'undefined') {
        debug("No stats from DB for net '%s', re-creating..", net)
        util.exit_remove_lock(2, lock, net)
      }
      debug("Got stats from DB for net '%s': %o", net, info)

      if (!isNaN(info.blocks)) {
        stats.last = info.blocks
      }
      if (!isNaN(info.headers)) {
        stats.count = info.headers
      }
      if (info.bestblockhash) {
        stats.bestblockhash = info.bestblockhash.toLowerCase()
      }
      if (info.chainwork) {
        stats.chainwork = info.chainwork.toLowerCase()
      }
      if (!isNaN(info.pow_algo_id)) {
        stats.pow_algo_id = info.pow_algo_id
      }
      if (info.pow_algo) {
        stats.pow_algo = info.pow_algo
      }
      if (algos.length == 1) {
        stats.pow_algo = algos[0].algo
      }
      if (!isNaN(info.mediantime)) {
        stats.mediantime = info.mediantime
      }
      if (!isNaN(info.verificationprogress)) {
        stats.verificationprogress = info.verificationprogress
      }
      if (!isNaN(info.total_amount)) {
        stats.supply = info.total_amount
      }
      if (info.pruned !== null) {
        stats.pruned = info.pruned
      }

      db.lib.get_blockhash(info.blocks, function (hash) {
        if (typeof hash === 'undefined') {
          debug("Block hash for height %d not found for net '%s'.", info.blocks, net)
          util.exit_remove_lock(2, lock, net)
        }

        db.lib.get_block(hash, function (block) {
          if (typeof block === 'undefined') {
            debug("Block with hash 's%' not found for height %d for net '%s'.", hash, info.blocks, net)
            util.exit_remove_lock(2, lock, net)
          }
          debug("Got block with hash '%s' for height %d for net '%s'", block.hash, block.height, net)

          lib.get_hashrate(function(ms) {
            if (typeof ms === 'undefined') {
              update_stats_and_exit(coin, stats)
            }
            debug("Got mining info from DB for net '%s': %o", net, ms)

            r.hashps = !isNaN(ms.networkhashps) ? ms.networkhashps : -1
            algos.forEach((algo) => {
              if (!isNaN(ms['nethash_' + algo.algo]))
                r['nethash_' + algo.algo] = ms['nethash_' + algo.algo]
            })

            r.difficulty = !isNaN(ms.difficulty) ? ms.difficulty : -1
            algos.forEach((algo) => {
              if (!isNaN(ms['difficulty_' + algo.algo]))
                r['difficulty_' + algo.algo] = ms['difficulty_' + algo.algo]
            })

            db.lib.get_txoutsetinfo(net, function (txout) {
              if (txout) {
                debug("Got txoutsetinfo with for height %d for net '%s': %o", block.height, net, txout)

                if (!isNaN(txout.transactions)) {
                  stats.count_txes = txout.transactions
                }
                if (!isNaN(txout.txouts)) {
                  stats.count_utxos = txout.txouts
                }
                if (!isNaN(txout.total_amount)) {
                  stats.supply = txout.total_amount
                }
                if (!isNaN(txout.disk_size)) {
                  stats.size_on_disk = txout.disk_size
                }
              }
              update_stats_and_exit(coin, stats)
            })
          }, net)
        }, net)
      }, net)
    })
  }).catch((err) => {
    console.error("Failed to load stats by database for net '%s': %s", net, err)
    util.exit_remove_lock(2, lock, net)
  })
})

function update_stats_and_exit(coin, stats) {
  StatsDb[net].updateOne({coin: coin.name}, stats).then(() => {
    console.log("Updated stats for coin '%s' and chain '%s'.", coin.name, net)
    util.exit_remove_lock_completed(lock, coin, net)
  }).catch((err) => {
    console.error("Failed to update stats database: %s", err)
    util.exit_remove_lock(2, lock, net)
  })
}
