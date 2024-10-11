const debug = require('debug')('sync')
const mongoose = require('mongoose')
const settings = require('../lib/settings')
const fs = require('fs')
const async = require('async')
const datautil = require('../lib/datautil')
const db = require('../lib/database')
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

      util.create_or_get_dbindex(net, coin.name, function (dbindex) {
        if (!dbindex)
          util.exit_remove_lock_completed(lock, coin, net)

        util.create_or_get_stats(net, coin.name, function(stats) {
          if (!stats)
            util.exit_remove_lock_completed(lock, coin, net)

          update_stats_db(net, coin.name, function(stats) {
            if (!stats)
              util.exit_remove_lock_completed(lock, coin, net)

            const block_start = get_block_start(process, dbindex)
            const block_end = get_block_end(process, stats)

            if (block_start == block_end) {
              console.log("Update chain '%s' from block %d to %d. Nothing to do.", net, block_start, block_end)
              util.exit_remove_lock_completed(lock, coin, net)
            } else if (block_start > block_end) {
              console.error("Update chain '%s' error. Start %d is greater as end %d. Stop.", net, block_start, block_end)
              util.exit_remove_lock(2, lock, net)
            } else {
              console.log("Update chain '%s' from block %d to %d.", net, block_start, block_end)
            }

            check_show_sync_message(block_end - block_start)
            
            update_tx_db(net, coin.name, block_start, block_end, stats.count_txes, settings.sync.update_timeout, false, function() {
              // check if the script stopped prematurely
              if (stopSync) {
                console.log('Block sync was stopped prematurely.')
                util.exit_remove_lock(1, lock, net)
              } else {
                util.update_last_updated_stats(coin.name, { blockchain_last_updated: Math.floor(new Date() / 1000) }, function(cb) {
                  util.get_stats(coin.name, function(nstats) {
                    const network_history = settings.get(net, 'network_history')
                    update_network_history(coin.name, nstats.last, network_history.enabled, function(network_hist) {
                      // always check for and remove the sync msg if exists
                      remove_sync_message(net)
                      console.log('Block sync complete (DB height %d, chain height %d)', dbindex.latest_block_height, nstats.last)
                      util.exit_remove_lock_completed(lock, coin, net)
                    }, net)
                  }, net)
                }, net)
              }
            })
          })
        })
      })
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

function get_block_start(process, dbindex) {
  var r = dbindex.count_blocks
  if (process.argv.length > 3) {
    const new_start = util.get_int_param(process.argv, 3)
    if (new_start > -1)
      r = new_start
  }
  return r
}

function get_block_end(process, stats) {
  var r = stats.last
  if (process.argv.length > 4) {
    const new_end = util.get_int_param(process.argv, 4)
    if (new_end > -1)
      r = new_end
  }
  return r
}

function check_show_sync_message(blocks_to_sync, net) {
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
    update_network_history_db(coin, height, function() {
      return cb(true)
    }, net)
  } else
    return cb(false)
}

function update_network_history_db(coin, height, cb, net) {
  console.log("Update network history: %d", height)
  db.NetworkHistoryDb[net].findOne({blockindex: height}).then((network_hist) => {
    if (!network_hist) {
      db.lib.get_hashrate(function(hashps) {
        db.lib.get_difficulty(net, function(difficulties) {
          const isBut = settings.isButkoin(net)
          const isPepew = settings.isPepew(net)
          const isVkax = settings.isVkax(net)
          const difficulty = difficulties.difficulty
          var difficultyPOW = 0
          var difficultyPOS = 0
          const shared_pages = settings.get(net, 'shared_pages')
          if (difficulty && difficulty['proof-of-work']) {
            if (shared_pages.difficulty == 'Hybrid') {
              difficultyPOS = difficulty['proof-of-stake']
              difficultyPOW = difficulty['proof-of-work']
            } else if (shared_pages.difficulty == 'POW')
              difficultyPOW = difficulty['proof-of-work']
            else
              difficultyPOS = difficulty['proof-of-stake']
          } else if (shared_pages.difficulty == 'POW')
            difficultyPOW = difficulty
          else
            difficultyPOS = difficulty

          // create a new network history record
          var dto = null
          if (isBut) {
            const hashrate = hashps.butkscrypt
            dto = db.NetworkHistoryDb[net].create({
              blockindex: height,
              nethash: (hashrate == null || hashrate == '-' ? 0 : hashrate),
              difficulty_pow: difficultyPOW,
              difficulty_pos: difficultyPOS,
              difficulty_ghostrider: difficulties.difficulty_ghostrider,
              difficulty_yespower: difficulties.difficulty_yespower,
              difficulty_lyra2: difficulties.difficulty_lyra2,
              difficulty_sha256d: difficulties.difficulty_sha256d,
              difficulty_scrypt: difficulties.difficulty_scrypt,
              difficulty_butkscrypt: difficulties.difficulty_butkscrypt,
              nethash_ghostrider: hashps.ghostrider,
              nethash_yespower: hashps.yespower,
              nethash_lyra2: hashps.lyra2,
              nethash_sha256d: hashps.sha256d,
              nethash_scrypt: hashps.scrypt,
              nethash_butkscrypt: hashps.butkscrypt
            })
          } else if (isPepew) {
            dto = db.NetworkHistoryDb[net].create({
              blockindex: height,
              nethash: hashps,
              difficulty_pow: hashps,
              difficulty_pos: difficultyPOS,
              difficulty_pepew: difficulty,
              nethash_pepew: hashps
            })
          } else if (isVkax) {
            dto = db.NetworkHistoryDb[net].create({
              blockindex: height,
              nethash: hashps,
              difficulty_pow: hashps,
              difficulty_pos: difficultyPOS,
              difficulty_mike: difficulty,
              nethash_mike: hashps
            })
          } else {
            dto = db.NetworkHistoryDb[net].create({
              blockindex: height,
              nethash: hashps,
              difficulty_pow: hashps,
              difficulty_pos: difficultyPOS,
              difficulty_ghostrider: difficulty,
              nethash_ghostrider: hashps
            })
          }

          if (dto) {
            var rr = {}
            if (isBut) {
              const hashrate = hashps.butkscrypt
              rr.last = height,
              rr.nethash = (hashrate == null || hashrate == '-' ? 0 : hashrate),
              rr.difficulty_pow = difficultyPOW,
              rr.difficulty_pos = difficultyPOS,
              rr.difficulty_ghostrider = difficulties.difficulty_ghostrider,
              rr.difficulty_yespower = difficulties.difficulty_yespower,
              rr.difficulty_lyra2 = difficulties.difficulty_lyra2,
              rr.difficulty_sha256d = difficulties.difficulty_sha256d,
              rr.difficulty_scrypt = difficulties.difficulty_scrypt,
              rr.difficulty_butkscrypt = difficulties.difficulty_butkscrypt,
              rr.nethash_ghostrider = hashps.ghostrider,
              rr.nethash_yespower = hashps.yespower,
              rr.nethash_lyra2 = hashps.lyra2,
              rr.nethash_sha256d = hashps.sha256d,
              rr.nethash_scrypt = hashps.scrypt,
              rr.nethash_butkscrypt = hashps.butkscrypt
            } else {
              rr.last = height,
              rr.nethash = hashps,
              rr.nethash_ghostrider = hashps,
              rr.difficulty_pow = hashps,
              rr.difficulty_pos = difficultyPOS,
              rr.difficulty = difficulties.difficulty,
              rr.difficulty_ghostrider = difficulty
            }
            db.StatsDb[net].updateOne({coin: coin}, rr).then(() => {
              console.log("Done update stats: %d", height)
              // get the count of network history records
              db.NetworkHistoryDb[net].find({}).countDocuments().then((count) => {
                // read maximum allowed records from settings
                const network_history = settings.get(net, 'network_history')
                let max_records = network_history.max_saved_records

                // check if the current count of records is greater than the maximum allowed
                if (count > max_records) {
                  // prune network history records to keep collection small and quick to access
                  db.NetworkHistoryDb[net].find().select('blockindex').sort({blockindex: 1}).limit(count - max_records).exec().then((records) => {
                    // create a list of the oldest network history ids that will be deleted
                    const ids = records.map((doc) => doc.blockindex)

                    // delete old network history records
                    db.NetworkHistoryDb[net].deleteMany({blockindex: {$in: ids}}).then(() => {
                      console.log('Network history update complete')
                      return cb()
                    })
                  })
                } else {
                  console.log('Network history update complete')
                  return cb()
                }
              }).catch((err) => {
                console.error("Failed to network history for chain '%s': %s", net, err)
                return cb(err)
              })
            }).catch((err) => {
              console.error("Failed to update stats database: %s", err)
            })
          } else {
            console.error("Failed to update network history for chain '%s': %s", net, err)
            return cb()
          }
        }, net)
      }, net)
    } else {
      // block hasn't moved. skip.
      return cb()
    }
  }).catch((err) => {
    console.error(err)
    return cb(err)
  })
}

function update_stats_db(net, coin, cb) {
  db.lib.get_blockcount(function (count) {
    if (!count || (count != null && typeof count === 'number' && count < 0)) {
      console.log('Error: Unable to connect to the X API.')
      return cb(false)
    }
    db.StatsDb[net].findOne({coin: coin}).then((stats) => {
      if (stats) {
        db.StatsDb[net].updateOne({coin: coin}, {
          coin: coin,
          count : count,
          last : !isNaN(count) ? count : -1
        }).then(() => {
          return cb({
            coin: coin,
            count : count,
            last: (stats.last ? stats.last : 0),
            txes: (stats.count_txes ? stats.count_txes : 0)
          })
        }).catch((err) => {
          console.error("Failed to update coin stats for chain '%s': %s", net, err)
          // return cb(false)
        })
      } else {
        console.log("Error during stats update: %s", (err ? err : 'Cannot find stats collection'))
        return cb(false)
      }
    }).catch((err) => {
      console.error("Failed to find coin stats for chain '%s': %s", net, err)
      return cb(false)
    })
  }, net)
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
    const sync_after = settings.sync.save_stats_after_sync_blocks
    if (!check_only && sync_after > -1 && block_height % sync_after === 0) {
      debug("Scan block update stats: %d", block_height)

      db.lib.get_txoutsetinfo(net, function(info) {
        const dto = {}
        dto.last = block_height

        if (info && !isNaN(info.transactions))
          dto.txes = info.transactions
        if (info && !isNaN(info.transactions))
          dto.utxos = info.txouts
        if (info && !isNaN(info.total_amount))
          dto.supply = info.total_amount

        db.StatsDb[net].updateOne({coin: coin}, dto).then(() => {
          debug("Done update stats: %d", block_height)
        }).catch((err) => {
          console.error("Failed to update stats database: %s", err)
        })
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
            db.get_block_by_height(block_height, function(blockc) {
              if (blockc) {
                console.log('Block %d is in DB.', block_height)
                async.eachLimit(block.tx, task_limit_txs, function(txid, next_tx) {
                  db.TxDb[net].findOne({txid: txid}).then((tx) => {
                    debug("Got block tx: %s", txid)
                    if (tx) {
                      debug('TX %s is in DB.', txid)
                      setTimeout( function() {
                        tx = null
                        stopSync ? next_tx({}) : next_tx() // stop or next
                      }, timeout)
                    } else {
                      save_tx(net, txid, block_height, function(err, tx_has_vout) {
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
                create_block(block, function(blockr) {
                  if (blockr) {
                    async.eachLimit(block.tx, task_limit_txs, function(txid, next_tx) {
                      db.TxDb[net].findOne({txid: txid}).then((tx) => {
                        debug("Got block tx: %s", txid)
                        if (tx) {
                          debug('TX %s is in DB.', txid)
                          setTimeout( function() {
                            tx = null
                            stopSync ? next_tx({}) : next_tx() // stop or next
                          }, timeout)
                        } else {
                          save_tx(net, txid, block_height, function(err, tx_has_vout) {
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
      // count_addresses(function(addresses) {
      //   count_utxos(function(utxos) {
      //     StatsDb[net].updateOne({coin: coin}, {
      //       last: end,
      //       txes: txes,
      //       addresses: addresses,
      //       utxos: utxos
      //     }).then(() => {
      //       return cb()
      //     })
      //   }, net)
      // }, net)
      return cb()
    } else
      return cb()
  })
}

function create_block(block, cb, net) {
  var cbtx = null
  const d = block.cbTx
  if (d) {
    cbtx = []
    cbtx[0] = d.version
    cbtx[1] = d.height
    cbtx[2] = d.version
    cbtx[3] = d.merkleRootMNList == '0000000000000000000000000000000000000000000000000000000000000000' ? '0' : d.merkleRootMNList
    cbtx[4] = d.merkleRootQuorums == '0000000000000000000000000000000000000000000000000000000000000000' ? '0' : d.merkleRootQuorums
  }
  const algo = settings.getAlgoFromBlock(block, net)
  const dto = db.BlockDb[net].create({
    hash: block.hash,
    pow_hash: block.pow_hash,
    algo: algo,
    size: block.size,
    height: block.height,
    version: block.version,
    merkle_root: block.merkleroot,
    numtx: block.tx ? block.tx.length : 0,
    time: block.time,
    mediantime: block.mediantime,
    nonce: block.nonce,
    bits: block.bits,
    difficulty: block.difficulty,
    chainwork: block.chainwork,
    prev_hash: block.previousblockhash,
    next_hash: block.nextblockhash,
    cbtx: cbtx
  })
  if (dto) {
      console.log("Stored block for chain %s height %d", net, block.height)
  }
  return cb(block)
}

function save_tx(net, txid, blockheight, cb) {
  db.lib.get_rawtransaction(txid, function(tx) {
    if (tx && tx != 'There was an error. Check your console.') {
      db.lib.prepare_vin(net, tx, function(vin, tx_type_vin) {
        db.lib.prepare_vout(net, tx.vout, txid, vin, false, function(vout, nvin, tx_type_vout) {
          db.lib.syncLoop(vin.length, function (loop) {
            var i = loop.iteration()

            // check if address is inside an array
            if (Array.isArray(nvin[i].addresses)) {
              // extract the address
              nvin[i].addresses = nvin[i].addresses[0]
            }

            update_address(nvin[i].addresses, blockheight, txid, nvin[i].amount, 'vin', function() {
              loop.next()
            }, net)
          }, function() {
            const tx_types = settings.get(net, 'tx_types')
            const isButkoin = settings.isButkoin(net)
            const isBitoreum = settings.isBitoreum(net)
            const isRaptoreum = settings.isRaptoreum(net)
            const isVkax = settings.isVkax(net)
            const isYerbas = settings.isYerbas(net)

            db.lib.syncLoop(vout.length, function (subloop) {
              var t = subloop.iteration()

              // check if address is inside an array
              if (Array.isArray(vout[t].addresses)) {
                // extract the address
                vout[t].addresses = vout[t].addresses[0]
              }

              if (vout[t].addresses) {
                update_address(vout[t].addresses, blockheight, txid, vout[t].amount, 'vout', function() {
                  subloop.next()
                }, net)
              } else
                subloop.next()
            }, function() {
              db.lib.calculate_total(vout, function(total) {
                var op_return = null
                // check if the op_return value should be decoded and saved
                const transaction_page = settings.get(net, 'transaction_page')
                if (transaction_page.show_op_return) {
                  // loop through vout to find the op_return value
                  tx.vout.forEach(function (vout_data) {
                    // check if the op_return value exists
                    if (vout_data.scriptPubKey != null && vout_data.scriptPubKey.asm != null && vout_data.scriptPubKey.asm.indexOf('OP_RETURN') > -1) {
                      // decode the op_return value
                      op_return = hex_to_ascii(vout_data.scriptPubKey.asm.replace('OP_RETURN', '').trim())
                    }
                  })
                }
                var extra = null
                if (isButkoin || isBitoreum || isRaptoreum || isVkax) {
                  switch (tx.type) {
                    case tx_types.indexOf('TRANSACTION_NORMAL'): break // -> NORMAL
                    case tx_types.indexOf('TRANSACTION_PROVIDER_REGISTER'): extra = datautil.protxRegisterServiceTxToArray(tx); break
                    case tx_types.indexOf('TRANSACTION_PROVIDER_UPDATE_SERVICE'): extra = datautil.protxUpdateServiceTxToArray(tx); break
                    case tx_types.indexOf('TRANSACTION_PROVIDER_UPDATE_REGISTRAR'): extra = datautil.protxUpdateRegistrarTxToArray(tx); break
                    case tx_types.indexOf('TRANSACTION_PROVIDER_UPDATE_REVOKE'): extra = datautil.protxUpdateRevokeTxToArray(tx); break
                    case tx_types.indexOf('TRANSACTION_COINBASE'): break // COINBASE, Array.from(rtx.extraPayload).reverse().join("")
                    case tx_types.indexOf('TRANSACTION_QUORUM_COMMITMENT'): extra = datautil.protxQuorumCommitmentTxToArray(tx); break
                    case tx_types.indexOf('TRANSACTION_FUTURE'): extra = tx.extraPayload; break // FUTURE
                    default: console.warn('*** Unknown TX type %s.', tx.type)
                  }
                } else if (isYerbas) {
                  switch (tx.type) {
                    case tx_types.indexOf('TRANSACTION_NORMAL'): break // -> NORMAL
                    case tx_types.indexOf('TRANSACTION_PROVIDER_REGISTER'): extra = datautil.protxRegisterServiceTxToArray(tx); break
                    case tx_types.indexOf('TRANSACTION_PROVIDER_UPDATE_SERVICE'): extra = datautil.protxUpdateServiceTxToArray(tx); break
                    case tx_types.indexOf('TRANSACTION_PROVIDER_UPDATE_REGISTRAR'): extra = datautil.protxUpdateRegistrarTxToArray(tx); break
                    case tx_types.indexOf('TRANSACTION_PROVIDER_UPDATE_REVOKE'): extra = datautil.protxUpdateRevokeTxToArray(tx); break
                    case tx_types.indexOf('TRANSACTION_COINBASE'): break // COINBASE, Array.from(rtx.extraPayload).reverse().join("")
                    case tx_types.indexOf('TRANSACTION_QUORUM_COMMITMENT'): extra = datautil.protxQuorumCommitmentTxToArray(tx); break
                    case tx_types.indexOf('TRANSACTION_FUTURE'): extra = tx.extraPayload; break
                    case tx_types.indexOf('TRANSACTION_ASSET_REGISTER'): extra = tx.extraPayload; break
                    case tx_types.indexOf('TRANSACTION_ASSET_REISUE'): extra = tx.extraPayload; break
                    default: console.warn('*** Unknown TX type %s.', tx.type); console.log(JSON.stringify.tx); exit(0)
                  }
                }
                const dto = db.TxDb[net].create({
                  version: tx.version,
                  txid: tx.txid,
                  tx_type: tx.type,
                  size: tx.size,
                  locktime: tx.locktime,
                  instantlock: tx.instantlock,
                  chainlock: tx.chainlock,
                  vin: nvin,
                  vout: vout,
                  total: total.toFixed(8),
                  timestamp: tx.time,
                  blockhash: tx.blockhash,
                  blockindex: blockheight,
                  op_return: op_return,
                  extra: extra
                })
                if (dto) {
                  return cb(null, vout.length > 0)
                } else {
                  return cb("Failed to store TX.", false)
                }
              })
            })
          })
        })
      })
    } else
      return cb('tx not found: ' + txid, false)
  }, net)
}

function hex_to_ascii(hex) {
  var str = '';
  for (var i = 0; i < hex.length; i += 2)
    str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  return str;
}

function update_address(hash, blockheight, txid, amount, type, cb, net=settings.getDefaultNet()) {
  var to_sent = false
  var to_received = false
  var addr_inc = {}

  if (hash == 'coinbase')
    addr_inc.sent = amount
  else {
    if (type == 'vin') {
      addr_inc.sent = amount
      addr_inc.balance = -amount
    } else {
      addr_inc.received = amount
      addr_inc.balance = amount
    }
  }

  db.AddressDb[net].findOneAndUpdate({a_id: hash}, {
    $inc: addr_inc
  }, {
    new: true,
    upsert: true
  }).then((address) => {
    if (hash != 'coinbase') {
      db.AddressTxDb[net].findOneAndUpdate({a_id: hash, txid: txid}, {
        $inc: {
          amount: addr_inc.balance
        },
        $set: {
          a_id: hash,
          blockindex: blockheight,
          txid: txid
        }
      }, {
        new: true,
        upsert: true
      }).then(() => {
        return cb()
      }).catch((err) => {
        console.error("Failed to find address tx '%s' for chain '%s': %s", hash, net, err)
        return cb(err)
      })
    } else
      return cb()
  }).catch((err) => {
    console.error("Failed to find address '%s' for chain '%s': %s", hash, net, err)
    return cb(err)
  })
}

function remove_sync_message(net) {
  const filePath = './tmp/show_sync_message-' + net + '.tmp'
  // Check if the show sync stub file exists
  if (fs.existsSync(filePath)) {
    // File exists, so delete it now
    try {
      fs.unlinkSync(filePath)
    } catch (err) {
      console.log(err)
    }
  }
}

function update_heavy(coin, height, count, cb, net) {
  var newVotes = []

  db.lib.get_maxmoney(function (maxmoney) {
    db.lib.get_maxvote(function (maxvote) {
      db.lib.get_vote(function (vote) {
        db.lib.get_phase(function (phase) {
          db.lib.get_reward(function (reward) {
            util.get_stats(coin.name, function (stats) {
              db.lib.get_estnext(function (estnext) {
                db.lib.get_nextin(function (nextin) {
                  db.lib.syncLoop(count, function (loop) {
                    var i = loop.iteration()
                    db.lib.get_blockhash(height - i, function (hash) {
                      db.lib.get_block(hash, function (block) {
                        newVotes.push({ count: height - i, reward: block.reward, vote: (block && block.vote ? block.vote : 0) })
                        loop.next()
                      }, net)
                    }, net)
                  }, function() {
                    HeavyDb[net].updateOne({coin: coin}, {
                      lvote: (vote ? vote : 0),
                      reward: (reward ? reward : 0),
                      supply: (stats && stats.supply ? stats.supply : 0),
                      cap: (maxmoney ? maxmoney : 0),
                      estnext: (estnext ? estnext : 0),
                      phase: (phase ? phase : 'N/A'),
                      maxvote: (maxvote ? maxvote : 0),
                      nextin: (nextin ? nextin : 'N/A'),
                      votes: newVotes
                    }, function() {
                      // update reward_last_updated value
                      util.update_last_updated_stats(coin.name, { reward_last_updated: Math.floor(new Date() / 1000) }, function (new_cb) {
                        console.log('Heavycoin update complete')
                        return cb()
                      }, net)
                    })
                  })
                }, net)
              }, net)
            }, net)
          }, net)
        }, net)
      }, net)
    }, net)
  }, net)
}