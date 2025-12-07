const debug = require('debug')('sync')
const d_assets = require('debug')('assets')
const mongoose = require('mongoose')
const settings = require('../lib/settings')
const fs = require('fs')
const async = require('async')
const datautil = require('../lib/datautil')
const assetutil = require('../lib/functions/assetutil')
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
          const isMultiAlgo = settings.isMultiAlgo(net)
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
          if (isMultiAlgo) {
            const hashrate = hashps.ghostrider
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
              nethash_ghostrider: hashps['nethash_ghostrider'],
              nethash_sha256d: hashps['nethash_sha256d'],
              nethash_scrypt: hashps['nethash_scrypt']
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
            if (isMultiAlgo) {
              const hashrate = hashps.ghostrider
              rr.last = height,
              rr.nethash = (hashrate == null || hashrate == '-' ? 0 : hashrate),
              rr.difficulty_pow = difficultyPOW,
              rr.difficulty_pos = difficultyPOS,
              rr.difficulty_ghostrider = difficulties.difficulty_ghostrider,
              rr.difficulty_yespower = difficulties.difficulty_yespower,
              rr.difficulty_lyra2 = difficulties.difficulty_lyra2,
              rr.difficulty_sha256d = difficulties.difficulty_sha256d,
              rr.difficulty_scrypt = difficulties.difficulty_scrypt,
              rr.nethash_ghostrider = hashps.ghostrider,
              rr.nethash_yespower = hashps.yespower,
              rr.nethash_lyra2 = hashps.lyra2,
              rr.nethash_sha256d = hashps.sha256d,
              rr.nethash_scrypt = hashps.scrypt
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
    // TODO: Fix. Updates DB with DB.
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
  if (typeof start === 'undefined' || start < 0)
    start = 0

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
      if (debug.enabled) debug("Scan block update stats: %d", block_height)

      db.lib.get_txoutsetinfo(net, function(info) {
        const dto = {}
        dto.last = block_height

        if (info && !isNaN(info.transactions))
          dto.txes = info.transactions
        if (info && !isNaN(info.txouts))
          dto.utxos = info.txouts
        if (info && !isNaN(info.total_amount))
          dto.supply = info.total_amount

        db.StatsDb[net].updateOne({coin: coin}, dto).then(() => {
          if (debug.enabled) debug("Done update stats: %d", block_height)
        }).catch((err) => {
          console.error("Failed to update stats database: %s", err)
        })
      })
    } else if (check_only) {
      console.log('Checking block %d...', block_height)
    }

    console.log("-Process block: %d", block_height)
    db.lib.get_blockhash(block_height, function(blockhash) {
      if (debug.enabled) debug("Got block hash: %s", blockhash)
      if (blockhash) {
        db.lib.get_block(blockhash, function(block) {
          if (debug.enabled) debug("Got block: %s", blockhash)
          if (block) {
            db.get_block_by_height(block_height, function(blockc) {
              if (blockc) {
                processBlockIsInDb(net, block, block_height, blockhash, task_limit_txs, timeout, next_block)
              } else {
                processNewBlock(net, block, block_height, blockhash, txes, task_limit_txs, timeout, next_block)
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

function processBlockIsInDb(net, block, block_height, blockhash, task_limit_txs, timeout, next_block) {
  console.log('Block %d is in DB.', block_height)
  async.eachLimit(block.tx, task_limit_txs, function(txid, next_tx) {
    db.TxDb[net].findOne({txid: txid}).then((tx) => {
      if (debug.enabled) debug("Got block tx: %s", txid)
      if (tx) {
        if (debug.enabled) debug('TX %s is in DB.', txid)
        setTimeout( function() {
          tx = null
          stopSync ? next_tx({}) : next_tx() // stop or next
        }, timeout)
      } else {
        save_tx(net, txid, block_height, function(err, tx_has_vout) {
          if (debug.enabled) debug("Saved block tx: %s", txid)
          if (err)
            console.log(err)
          else
            console.log('%s: %s', block_height, txid)

          // if (tx_has_vout)
          //   txes++

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
}

function processNewBlock(net, block, block_height, blockhash, txes, task_limit_txs, timeout, next_block) {
  create_block(block, function(blockr) {
    if (blockr) {
      async.eachLimit(block.tx, task_limit_txs, function(txid, next_tx) {
        db.TxDb[net].findOne({txid: txid}).then((tx) => {
          if (debug.enabled) debug("Got block tx: %s", txid)
          if (tx) {
            if (debug.enabled) debug('TX %s is in DB.', txid)
            setTimeout( function() {
              tx = null
              stopSync ? next_tx({}) : next_tx() // stop or next
            }, timeout)
          } else {
            save_tx(net, txid, block_height, function(err, tx_has_vout) {
              if (debug.enabled) debug("Saved block tx: %s", txid)
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
      console.log("+Stored block for chain %s height %d", net, block.height)
  }
  return cb(block)
}

const tx_types = settings.get(net, 'tx_types')

function save_tx(net, txid, blockheight, cb) {
  db.lib.get_rawtransaction(txid, async function(tx) {
    if (tx && tx != 'There was an error. Check your console.') {

      // Register asset.
      if (tx_types.indexOf('TRANSACTION_ASSET_REGISTER') == tx.type) {
        const newAsset = assetutil.getNewAsset(tx.vout)
        console.log("NEW ASSET %o", newAsset)
        const name = newAsset[1].scriptPubKey.asset.name
        var index = await db.AssetsDb[net].findOne({name: name}).exec() 
        if (index) 
          console.log("Asset with name '%s' for chain '%s' is already in DB.", name, net)
        else {
          index = await db.AssetsDb[net].create({
            height: blockheight,
            txid, txid,
            name: newAsset[1].scriptPubKey.asset.name,
            address: newAsset[1].scriptPubKey.addresses[0],
            owner: newAsset[0] ? newAsset[0].scriptPubKey.asset.name : newAsset[1].scriptPubKey.asset.name + '!',
            owner_address: newAsset[0] ? newAsset[0].scriptPubKey.addresses[0] : newAsset[1].scriptPubKey.addresses[0],
            expire_time: newAsset[1].scriptPubKey.asset.expire_time,
            amount: newAsset[1].scriptPubKey.asset.amount,
            units: newAsset[1].scriptPubKey.asset.units,
            balance: newAsset[1].scriptPubKey.asset.amount,
            ipfs_hash: newAsset[1].scriptPubKey.asset.ipfs_hash ? newAsset[1].scriptPubKey.asset.ipfs_hash : ''
          })
          console.log("Creates asset index with name '%s' for chain '%s'.", index.name, net)
        }
      }
      
      const txAssets = assetutil.getDistinctTransferAssets(tx.vout)
      for (const txAsset of txAssets) {
        if (d_assets.enabled) d_assets("Increase tx count for asset '%s'.", txAsset)
        await db.AssetsDb[net].updateOne({name: txAsset}, {$inc: { tx_count: 1 }}).exec()
      }

      prepare_vin(net, txAssets, tx, function(vin, tx_type_vin) {
        prepare_vout(net, tx.vout, txid, vin, function(vout, nvin, tx_type_vout) {
          // tx.vin = vin
          for (var i = 0; i < tx.vin.length; i += 1) {
            if (vin[i].scriptPubKey) {
              tx.vin[i].scriptPubKey = vin[i].scriptPubKey
            }
          }

          db.lib.syncLoop(vin.length, function (loop) {
            var i = loop.iteration()

            // Copy address from array (should be only one).
            if (Array.isArray(nvin[i].addresses)) {
              nvin[i].addresses = nvin[i].addresses[0]
              if (nvin[i].addresses.length > 1)
                console.warn("Found vin with multiple addresses. Txid '%s', index %d: %o", txid, i, nvin[i].addresses)
            }

            update_address(i, tx, nvin[i].addresses, nvin[i].amount, blockheight, 'vin', function() {
              loop.next()
            }, net)
          }, function() {
            const isBitoreum = settings.isBitoreum(net)
            const isRaptoreum = settings.isRaptoreum(net)
            const isVkax = settings.isVkax(net)

            db.lib.syncLoop(vout.length, function (subloop) {
              var t = subloop.iteration()

              // check if address is inside an array
              if (Array.isArray(vout[t].addresses)) {
                // extract the address
                vout[t].addresses = vout[t].addresses[0]
              }

              if (vout[t].addresses) {
                update_address(t, tx, vout[t].addresses, vout[t].amount, blockheight, 'vout', function() {
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
                if (isBitoreum || isRaptoreum || isVkax) {
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
                } else {
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

async function update_address(index, tx, hash, amount, height, type, cb, net=settings.getDefaultNet()) {
  if (debug.enabled) debug("Update address: %s %d, %s, %d, %d", type, index, hash, height, amount)

  const utxo = type == 'vin' ? tx.vin[index] : tx.vout[index]
  const hasAsset = assetutil.hasAsset(utxo) // && assetutil.hasAssetHexAsm(utxo)

  var address = await db.AddressDb[net].find({a_id: hash}).exec()
  
  if (address && Array.isArray(address) && address.length > 0) {
    address = address[0]
    const assets = address.assets
    
    if (hash == 'coinbase') {
      // Update coinbase address. since is the counter.
      address.since = height
      address.sent = address.sent + amount
    } else {
      if (type == 'vin') {
        address.sent = address.sent + amount
        address.balance = address.balance - amount
        // *******************
        if (hasAsset) {
          const asset = utxo.scriptPubKey.asset
          if (d_assets.enabled) d_assets("Found vin asset '%o'.", asset)
          const ai = findAssetIndex(assets, asset.name)
          const assetAmount = asset.amount
          if (ai > -1 && assets[ai]) {
            // console.warn("Found vin asset.")
            const sent = assets[ai].sent
            const balance = assets[ai].balance
            assets[ai].sent = sent + assetAmount
            assets[ai].balance = balance - assetAmount
            if (d_assets.enabled) d_assets("Update vin asset '%s' for address '%s' sent/balance %d/%d to %d/%d.", hash, assets[ai].name, sent, balance, assets[ai].sent, assets[ai].balance)
          } else {
            if (!Array.isArray(assets)) 
              assets = []
            assets.push({ name: asset.name, sent: assetAmount, received: 0, balance: 0 })
          }
        }
        // *******************
      } else {
        address.received = Number(address.received + amount)
        address.balance = Number(address.balance + amount)
        if (hasAsset) {
          const asset = utxo.scriptPubKey.asset
          if (d_assets.enabled) d_assets("Found vout asset '%o'.", asset)
          const ai = findAssetIndex(assets, asset.name)
          if (ai > -1) {
            // Update address asset balance.
            const received = assets[ai].received
            const balance = assets[ai].balance
            assets[ai].received = received + asset.amount
            assets[ai].balance = balance + asset.amount
            if (d_assets.enabled) d_assets("Update vout asset for address '%s' received/balance %d/%d to %d/%d.", hash, received, balance, assets[ai].received, assets[ai].balance)

            // Update asset index balance / tx_count.
            if (!asset.name.endsWith('!')) {
              var assetIndex = await db.AssetsDb[net].findOne({ name: asset.name }).exec()
              if (assetIndex) {
                var mbalance = assetIndex.balance
                if (assetIndex.address == address.a_id) {
                  if (d_assets.enabled) d_assets("Asset '%s' receiver is owner. Amount %d. Owner %s.", asset.name, asset.amount, assetIndex.address)
                  mbalance = mbalance + asset.amount
                }
                for (let i = 0; i < tx.vin.length; i++) {
                  if (tx.vin[i].address == assetIndex.address && tx.vin[i].scriptPubKey && tx.vin[i].scriptPubKey.type == 'transfer_asset' && tx.vin[i].scriptPubKey.asset && tx.vin[i].scriptPubKey.asset.name == asset.name) {
                    if (d_assets.enabled) d_assets("Asset '%s' send by owner.  %d.", asset.name, asset.amount)
                    mbalance = mbalance - asset.amount
                  }
                }
                // else {
                //   d_assets("Asset '%s' send by owner.  %d.", asset.name, asset.amount)
                //   mbalance = mbalance - asset.amount
                // }
                if (assetIndex.balance != mbalance) {
                  await db.AssetsDb[net].updateOne({ name: asset.name }, { balance: mbalance}).exec()
                }
              }
            }

          } else {
            if (!Array.isArray(assets)) 
              assets = []
            assets.push({ name: asset.name, sent: 0, received: asset.amount, balance: asset.amount })
          }
        }
      }
    }

    await db.AddressDb[net].updateOne({a_id: hash}, {
      received: Number(address.received),
      balance: Number(address.balance),
      sent: Number(address.sent),
      assets: address.assets
    }).exec()
  } else {
    console.log("Create new address: %d, %j", amount, address)
    address = {}
    address.a_id = hash
    if (hash == 'coinbase') {
      // First coinbase.
      address.since = 0
      address.sent = amount
      address.received = 0
      address.balance = 0
    } else {
      // New address. First utxo will be stored below.
      address.since = height
      address.received = amount
      address.balance = amount
      address.sent = 0
      if (hasAsset) {
        // Add first asset to the address.
        // TODO: Multiple assets
        address.assets = [{name: utxo.scriptPubKey.asset.name, since: height, received: utxo.scriptPubKey.asset.amount, sent: 0, balance: utxo.scriptPubKey.asset.amount}]
      }
    }
    await db.AddressDb[net].create(address)
  }

  if (hash == 'coinbase')
    return cb()

  var dto = {}
  var filter = {}
  if (hasAsset) {
    filter = {a_id: hash, txid: tx.txid, name: utxo.scriptPubKey.asset.name}
    const ttype = assetutil.getAssetTypeIndex(utxo.scriptPubKey.type)
    dto = {
      a_id: hash,
      blockindex: height,
      txid: tx.txid,
      name: utxo.scriptPubKey.asset.name,
      tamount: utxo.scriptPubKey.asset.amount,
      ttype: ttype,
      asm: utxo.scriptPubKey.hex
    }
    if (ttype == 0 && utxo.scriptPubKey.asset.reissuable && utxo.scriptPubKey.asset.units) {
      dto.treissue = utxo.scriptPubKey.asset.reissuable
      dto.tunits = utxo.scriptPubKey.asset.units
    }
  } else {
    filter = {a_id: hash, txid: tx.txid}
    dto = {
      a_id: hash,
      blockindex: height,
      txid: tx.txid
    }
  }
  
  db.AddressTxDb[net].findOneAndUpdate(filter, {
    $inc: {
      amount: type == 'vin' ? -amount : amount
    },
    $set: dto
  }, {
    new: true,
    upsert: true
  }).then(() => {
    return cb()
  }).catch((err) => {
    console.error("Failed to find address tx '%s' for chain '%s': %s", hash, net, err)
    return cb(err)
  })
}

function findAssetIndex(assets, name) {
  if (d_assets.enabled) d_assets('Find address asset index, %s: %o.', name, assets)
  if (assets && Array.isArray(assets)) {
    for (let i = 0; i < assets.length; i++) {
      if (assets[i] && assets[i].name && assets[i].name == name) {
        if (d_assets.enabled) d_assets("Found asset index %d for token '%s'.", i, name)
        return i
      }
    }
  }
  if (d_assets.enabled) d_assets('Asset index with name %s not found.', name)
  return -1
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

// TODO: yerbas

function prepare_vin(net=settings.getDefaultNet(), txAssets, tx, cb) {
  const arr_vin = []
  // const txAssets = assetutil.getDistinctAssets(tx.vout)
  var tx_type = null

  db.lib.syncLoop(tx.vin.length, function (loop) {
    const i = loop.iteration()

    get_input_addresses(net, tx.vin[i], tx.vout, function(addresses, tx_type_vin) {
      // check if the tx type is set
      if (tx_type_vin != null) {
        // set the tx type return value
        tx_type = tx_type_vin
      }

      if (addresses && addresses.length) {
        if (txAssets.size > 0) {
          const vinTxId = tx.vin[i].txid
          const vinVoutIndex = tx.vin[i].vout          
          if (d_assets.enabled) d_assets("Lookup vin asset txid '%s', vout index %d.", vinTxId, vinVoutIndex)

          const dto = {}
          db.lib.get_rawtransaction(vinTxId, function(vinTx) {
            // asset_transfer!
            if (vinTx && assetutil.hasAsset(vinTx.vout[vinVoutIndex])) {
              dto.scriptPubKey = {}
              dto.scriptPubKey.asset = {}
              dto.scriptPubKey.asset.name = vinTx.vout[vinVoutIndex].scriptPubKey.asset.name
              dto.scriptPubKey.asset.amount = vinTx.vout[vinVoutIndex].scriptPubKey.asset.amount
              dto.scriptPubKey.asset.type = vinTx.vout[vinVoutIndex].scriptPubKey.type
              dto.scriptPubKey.type = vinTx.vout[vinVoutIndex].scriptPubKey.type
              if (d_assets.enabled) d_assets("Add asset to vin %o.", vinTx.vout[vinVoutIndex].scriptPubKey.asset)
            }
            datautil.convert_to_satoshi(parseFloat(addresses[0].amount), function(amount_sat) {
              dto.addresses = addresses[0].hash
              dto.amount = amount_sat
              arr_vin.push(dto)
              loop.next()
            })    
          }, net)
        } else {
          datautil.convert_to_satoshi(parseFloat(addresses[0].amount), function(amount_sat) {
            arr_vin.push({
              addresses: addresses[0].hash, 
              amount: amount_sat
            })
            loop.next()
          })
       }
      } else {
        // could not decipher the address, save as unknown and move to next vin
        console.warn('Failed to find vin address from tx ' + tx.txid)
        datautil.is_unique(arr_vin, 'unknown_address', 'addresses', function(unique, index) {
          // TODO: Prio 1. Fix it.
          if (unique == true)
            arr_vin.push({addresses: 'unknown_address', amount: 0})
          else {
            // TODO: Check error message.
            console.error("Not unique: unknown_address is not unique 1.");
          }
          loop.next()
        })
      }
    })
  }, function() {
    return cb(arr_vin, tx_type)
  })
}

function prepare_vout(net=settings.getDefaultNet(), vout, txid, vin, cb) {
  var arr_vout = []
  var arr_vin = vin
  var tx_type = null

  db.lib.syncLoop(vout.length, function (loop) {
    var i = loop.iteration();
    // make sure vout has an address
    if (vout[i].scriptPubKey.type != 'nonstandard' && vout[i].scriptPubKey.type != 'nulldata') {
      var address_list = vout[i].scriptPubKey.addresses;
      // check if there are one or more addresses in the vout
      if (address_list == null || address_list.length == 0) {
        // no addresses defined
        // check if there is a single address defined
        if (vout[i].scriptPubKey.address == null) {
          // no single address defined
          // check if bitcoin features are enabled
          if (settings.blockchain_specific.bitcoin.enabled == true) {
            // assume the asm value is a P2PK (Pay To Pubkey) public key that should be encoded as a P2PKH (Pay To Pubkey Hash) address
            encodeP2PKaddress(vout[i].scriptPubKey.asm, function(p2pkh_address) {
              // check if the address was encoded properly
              if (p2pkh_address != null) {
                // mark this tx as p2pk
                tx_type = 'p2pk';
                // process vout addresses
                processVoutAddresses(vout[i], p2pkh_address, vout[i].value, arr_vout, function(vout_array) {
                  // save updated array
                  arr_vout = vout_array;
                  // move to next vout
                  loop.next();
                });
              } else {
                // could not decipher the address, save as unknown and move to next vout
                console.log('Failed to find vout address from tx ' + txid);
                // process vout addresses
                processVoutAddresses(vout[i], ['unknown_address'], vout[i].value, arr_vout, function(vout_array) {
                  // save updated array
                  arr_vout = vout_array;
                  // move to next vout
                  loop.next();
                });
              }
            }, net);
          } else {
            // could not decipher the address, save as unknown and move to next vout
            console.log('Failed to find vout address from tx ' + txid)
            processVoutAddresses(vout[i], ['unknown_address'], vout[i].value, arr_vout, function(vout_array) {
              arr_vout = vout_array
              loop.next()
            })
          }
        } else {
          processVoutAddresses(vout[i], [vout[i].scriptPubKey.address], vout[i].value, arr_vout, function(vout_array) {
            arr_vout = vout_array
            loop.next()
          })
        }
      } else {
        processVoutAddresses(vout[i], address_list, vout[i].value, arr_vout, function(vout_array) {
          arr_vout = vout_array
          loop.next()
        })
      }
    } else {
      // no address, move to next vout
      loop.next()
    }
  }, function() {
    if (typeof vout[0] !== 'undefined' && vout[0].scriptPubKey.type == 'nonstandard') {
      if (arr_vin.length > 0 && arr_vout.length > 0) {
        if (arr_vin[0].addresses == arr_vout[0].addresses) {
          //PoS
          arr_vout[0].amount = arr_vout[0].amount - arr_vin[0].amount
          arr_vin.shift();

          return cb(arr_vout, arr_vin, tx_type)
        } else
          return cb(arr_vout, arr_vin, tx_type)
      } else
        return cb(arr_vout, arr_vin, tx_type)
    } else
      return cb(arr_vout, arr_vin, tx_type)
  })
}

function processVoutAddresses(vout, address_list, vout_value, arr_vout, cb) {
  if (address_list != null && address_list.length > 0) {
    if (Array.isArray(address_list[0])) {
      // extract the address
      address_list[0] = address_list[0][0]
    }

    datautil.convert_to_satoshi(parseFloat(vout_value), function(amount_sat) {
      if (assetutil.hasAsset(vout) && assetutil.hasAssetHexAsm(vout))
        arr_vout.push({ 
          addresses: address_list[0],
          amount: amount_sat,
          name: vout.scriptPubKey.asset.name,
          tamount: vout.scriptPubKey.asset.amount,
          ttype: assetutil.getAssetTypeIndex(vout.scriptPubKey.type),
          asm: vout.scriptPubKey.hex })
      else 
        arr_vout.push({ addresses: address_list[0], amount: amount_sat})
      return cb(arr_vout)
    })
  } else {
    // No address, move to next vout.
    return cb(arr_vout)
  }
}

function get_input_addresses(net=settings.getDefaultNet(), input, vout, cb) {
  var addresses = [];

  if (input.coinbase) {
    var amount = 0;

    db.lib.syncLoop(vout.length, function (loop) {
      var i = loop.iteration();

      amount = amount + parseFloat(vout[i].value);
      loop.next();
    }, function() {
      addresses.push({hash: 'coinbase', amount: amount});
      return cb(addresses, null);
    });
  } else {
    db.lib.get_rawtransaction(input.txid, function(tx) {
      if (tx) {
        var tx_type = null;

        db.lib.syncLoop(tx.vout.length, function (loop) {
          var i = loop.iteration();

          if (tx.vout[i].n == input.vout) {
            if (tx.vout[i].scriptPubKey.addresses || tx.vout[i].scriptPubKey.address) {
              var new_address = tx.vout[i].scriptPubKey.address || tx.vout[i].scriptPubKey.addresses[0]

              // check if address is inside an array
              if (Array.isArray(new_address)) {
                // extract the address
                new_address = new_address[0]
              }
              addresses.push({hash: new_address, amount: tx.vout[i].value})
              loop.break(true)
              loop.next()
            } else {
              // no addresses defined
              // check if bitcoin features are enabled
              if (settings.blockchain_specific.bitcoin.enabled == true) {
                // assume the asm value is a P2PK (Pay To Pubkey) public key that should be encoded as a P2PKH (Pay To Pubkey Hash) address
                db.lib.encodeP2PKaddress(tx.vout[i].scriptPubKey.asm, function(p2pkh_address) {
                  // check if the address was encoded properly
                  if (p2pkh_address != null) {
                    // mark this tx as p2pk
                    tx_type = 'p2pk';

                    // check if address is inside an array
                    if (Array.isArray(p2pkh_address)) {
                      // extract the address
                      p2pkh_address = p2pkh_address[0];
                    }

                    // save the P2PKH address
                    datautil.is_unique(addresses, p2pkh_address, 'hash', function(unique, index) {
                      if (unique == true)
                        addresses.push({hash: p2pkh_address, amount: tx.vout[i].value});
                      else {
                        // TODO: Check error message.
                        console.error("Not unique: " + p2pkh_address + " not unique 2");
                        addresses[index].amount = addresses[index].amount + tx.vout[i].value;
                      }

                      loop.break(true);
                      loop.next();
                    });
                  } else {
                    // could not decipher the address, save as unknown
                    console.log('Failed to find vin address from tx ' + input.txid)
                    addresses.push({hash: 'unknown_address', amount: tx.vout[i].value})
                    loop.break(true)
                    loop.next()
                  }
                }, net)
              } else {
                // could not decipher the address, save as unknown
                console.log('Failed to find vin address from tx ' + input.txid)
                addresses.push({hash: 'unknown_address', amount: tx.vout[i].value})
                loop.break(true)
                loop.next()
              }
            }
          } else
            loop.next()
        }, function() {
          return cb(addresses, tx_type)
        })
      } else
        return cb()
    }, net)
  }
}