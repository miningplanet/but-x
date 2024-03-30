const debug = require('debug')('sync')
const mongoose = require('mongoose')
const settings = require('../lib/settings')
const async = require('async')
const db = require('../lib/database')
const { StatsDb, TxDb } = require('../lib/database')
const util = require('./syncutil')

util.check_net_missing(process.argv)

const net = process.argv[2]

util.check_net_unknown(net)

const coin = settings.getCoin(net)
const lock = 'chain'
var stopSync = false

util.gracefully_shut_down(process, stopSync)

util.log_start(lock, net, coin)

util.init_db(net, function(status) {
  if (!db.lib.is_locked([lock], net)) {
    db.lib.create_lock(lock, net)
    lockCreated = true
    // check the backup, restore and delete locks since those functions would be problematic when updating data
    if (db.lib.is_locked(['backup', 'restore', 'delete'], net) == false) {

      console.log('Syncing blocks. pid %s.', process.pid)

      mongoose.set('strictQuery', true)

      db.check_stats(coin.name, function(exists) {
        if (exists == false) {
          console.log('Run \'npm start\' to create database structures before running this script.')
          util.exit_remove_lock(1, lock, net)
        } else {
          db.update_db(net, coin.name, function(stats) {
            if (stats !== false) {
              // Get the last synced block index value
              var last = (stats.last ? stats.last : 0)
              // Get the total number of blocks
              var count = (stats.count ? stats.count : 0)
              check_show_sync_message(count - last)

              var block_start = 0

              if (block_start > 0)
                last = block_start

              console.log('Update chain %s from block %d to %d', net, block_start, last)

              update_tx_db(net, coin.name, last, count, stats.txes, settings.sync.update_timeout, false, function() {
                // check if the script stopped prematurely
                if (stopSync) {
                  console.log('Block sync was stopped prematurely')
                  util.exit_remove_lock(1, lock, net)
                } else {
                  db.update_last_updated_stats(coin.name, { blockchain_last_updated: Math.floor(new Date() / 1000) }, function(cb) {
                    db.update_richlist('received', function() {
                      db.update_richlist('balance', function() {
                        db.update_richlist('toptx', function() {
                          db.update_last_updated_stats(coin.name, { richlist_last_updated: Math.floor(new Date() / 1000) }, function(cb) {                              
                            db.get_stats(coin.name, function(nstats) {
                              // check for and update heavycoin data if applicable
                              update_heavy(coin.name, stats.count, 20, settings.blockchain_specific.heavycoin.enabled, function(heavy) {
                                // check for and update network history data if applicable
                                const network_history = settings.get(net, 'network_history')
                                update_network_history(coin.name, nstats.last, network_history.enabled, function(network_hist) {
                                  // always check for and remove the sync msg if exists
                                  db.remove_sync_message(net)
                                  console.log('Block sync complete (block: %s)', nstats.last)
                                  util.exit_remove_lock_completed(lock, coin, net)
                                }, net)
                              }, net)
                            }, net)
                          }, net)
                        }, net)
                      }, net)
                    }, net)
                  }, net)
                }
              })
            } else {
              // update_db threw an error so exit
              util.exit_remove_lock(1, lock, net)
            }
          })
        }
      }, net)
    } else {
      // another script process is currently running
      console.log("Sync aborted")
      util.exit_remove_lock(2, lock, net)
    }
  } else {
    // sync process is already running
    console.log("Sync aborted")
    util.exit_remove_lock(2, lock, net)
  }
})

function check_show_sync_message(blocks_to_sync, net=settings.getDefaultNet()) {
  var retVal = false
  const filePath = './tmp/show_sync_message-' + net + '.tmp'
  const showSyncBlocksNum = settings.sync.show_sync_msg_when_syncing_more_than_blocks
  if (blocks_to_sync > showSyncBlocksNum) {
    if (!db.fs.existsSync(filePath)) {
      db.fs.writeFileSync(filePath, '')
    }
    retVal = true
  }
  return retVal
}

function update_heavy(coin, height, count, heavycoin_enabled, cb) {
  if (heavycoin_enabled == true) {
    db.update_heavy(coin, height, count, function() {
      return cb(true)
    })
  } else
    return cb(false)
}

function update_network_history(coin, height, network_history_enabled, cb, net) {
  if (network_history_enabled == true) {
    db.update_network_history(coin, height, function() {
      return cb(true)
    }, net)
  } else
    return cb(false)
}

// updates tx, address & richlist db's
function update_tx_db(net, coin, start, end, txes, timeout, check_only, cb) {
  var complete = false
  var blocks_to_scan = []
  var task_limit_blocks = settings.sync.block_parallel_tasks
  var task_limit_txs = 1

  // fix for invalid block height (skip genesis block as it should not have valid txs)
  if (typeof start === 'undefined' || start < 1)
    start = 1

  if (task_limit_blocks < 1)
    task_limit_blocks = 1

  for (i = start; i < (end + 1); i++) {
    blocks_to_scan.push(i)
    if (i % 1000 == 0)
      console.log('Prepare scan block %d.', i)
  }

  async.eachLimit(blocks_to_scan, task_limit_blocks, function(block_height, next_block) {
    if (!check_only && block_height % settings.sync.save_stats_after_sync_blocks === 0) {
      debug("Scan block update stats: %d", block_height)
      StatsDb[net].updateOne({coin: coin}, {
        last: block_height - 1,
        txes: txes
      }).then(() => {
        debug("Done update stats: %d", block_height)
      }).catch((err) => {
        console.error("Failed to update stats database: %s", err)
      })
    } else if (check_only) {
      console.log('Checking block %d...', block_height)
    }

    console.log("Process block: %d", block_height)
    db.lib.get_blockhash(block_height, function(blockhash) {
      debug("Got block hash: %s", blockhash)
      if (blockhash) {
        db.lib.get_block(blockhash, function(block) {
          debug("Got block: %s", blockhash)
          if (block) {
            db.find_block_by_height(block_height, function(blockc) {
              if (blockc) {
                console.log('Block %d is in DB.', block_height)
                async.eachLimit(block.tx, task_limit_txs, function(txid, next_tx) {
                  TxDb[net].findOne({txid: txid}).then((tx) => {
                    debug("Got block tx: %s", txid)
                    if (tx) {
                      debug('TX %s is in DB.', txid)
                      setTimeout( function() {
                        tx = null
                        stopSync ? next_tx({}) : next_tx() // stop or next
                      }, timeout)
                    } else {
                      db.save_tx(net, txid, block_height, function(err, tx_has_vout) {
                        debug("Saved block tx: %s", txid)
                        if (err)
                          console.log(err)
                        else
                          console.log('%s: %s', block_height, txid)

                        if (tx_has_vout)
                          txes++

                        setTimeout( function() {
                          tx = null
                          stopSync ? next_tx({}) : next_tx() // stop or next
                        }, timeout)
                      })
                    }
                  }).catch((err) => {
                    console.error("Failed to find tx database: %s", err)
                    return cb(null)
                  })
                }, function() {
                  setTimeout( function() {
                    blockhash = null
                    block = null
                    stopSync ? next_block({}) : next_block() // stop or next
                  }, timeout)
                })
              } else {
                db.create_block(block, function(blockr) {
                  if (blockr) {
                    async.eachLimit(block.tx, task_limit_txs, function(txid, next_tx) {
                      TxDb[net].findOne({txid: txid}).then((tx) => {
                        debug("Got block tx: %s", txid)
                        if (tx) {
                          debug('TX %s is in DB.', txid)
                          setTimeout( function() {
                            tx = null
                            stopSync ? next_tx({}) : next_tx() // stop or next
                          }, timeout)
                        } else {
                          db.save_tx(net, txid, block_height, function(err, tx_has_vout) {
                            debug("Saved block tx: %s", txid)
                            if (err)
                              console.log(err)
                            else
                              console.log('%s: %s', block_height, txid)

                            if (tx_has_vout)
                              txes++

                            setTimeout( function() {
                              tx = null
                              stopSync ? next_tx({}) : next_tx() // stop or next
                            }, timeout)
                          })
                        }
                      }).catch((err) => {
                        console.error("Failed to find tx database: %s", err)
                        return cb(null)
                      })
                    }, function() {
                      setTimeout( function() {
                        blockhash = null
                        block = null
                        stopSync ? next_block({}) : next_block() // stop or next
                      }, timeout)
                    })
                  } else {
                    console.error("Failed to insert block at height %d hash '%s'. Exit.", block.height, block.hash)
                    util.exit_remove_lock(1, lock, net)
                  }
                }, net)
              }
            }, net)
          } else {
            console.log('Block not found: %s', blockhash)
            setTimeout( function() {
              stopSync ? next_block({}) : next_block() // stop or next
            }, timeout)
          }
        }, net)
      } else {
        setTimeout( function() {
          stopSync ? next_block({}) : next_block() // stop or next
        }, timeout)
      }
    }, net)
  }, function() {
    // check if the script stopped prematurely
    if (!stopSync) {
      db.count_addresses(function(addresses) {
        db.count_utxos(function(utxos) {
          StatsDb[net].updateOne({coin: coin}, {
            last: end,
            txes: txes,
            addresses: addresses,
            utxos: utxos
          }).then(() => {
            return cb()
          })
        }, net)
      }, net)
    } else
      return cb()
  })
}
