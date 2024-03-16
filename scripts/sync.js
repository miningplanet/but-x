const debug = require('debug')('sync')
const mongoose = require('mongoose')
const settings = require('../lib/settings')
const async = require('async')
const datautil = require('../lib/datautil')
const db = require('../lib/database')
const { StatsDb, AddressDb, AddressTxDb, TxDb, RichlistDb } = require('../lib/database')

var net = settings.getDefaultNet()
var coin = settings.getCoin(net)
var mode = 'update'
var database = 'index'
var block_start = 0
var lockCreated = false
var stopSync = false

// prevent stopping of the sync script to be able to gracefully shut down
process.on('SIGINT', () => {
  console.log('Stopping sync process.. Please wait..')
  stopSync = true
})

// prevent killing of the sync script to be able to gracefully shut down
process.on('SIGTERM', () => {
  console.log('Stopping sync process.. Please wait..')
  stopSync = true
})

// displays usage and exits
function usage() {
  console.log('Usage: /path/to/node scripts/sync.js [mode]')
  console.log('')
  console.log('Mode: (required)')
  console.log('update           Updates index from last sync to current block')
  console.log('check            Checks index for (and adds) any missing transactions/addresses')
  console.log('                 Optional parameter: block number to start checking from')
  console.log('insert-blocks    Inserts blocks not in the DB')
  console.log('enrichtx         Only for TX data synced prior to commit b14ae8d5636fd75e8e464323d9ba50ef0914a8c2:')
  console.log('                 Enriches TXs with further fields like version, type, locktime and more.')
  console.log('                 Optional parameters: block number start and end inclusive')
  console.log('reindex          Clears index then resyncs from genesis to current block')
  console.log('reindex-rich     Clears and recreates the richlist data')
  console.log('reindex-txcount  Rescan and flatten the tx count value for faster access')
  console.log('reindex-last     Rescan and flatten the last blockindex value for faster access')
  console.log('market           Updates market summaries, orderbooks, trade history + charts')
  console.log('peers            Updates peer info based on local wallet connections')
  console.log('masternodes      Updates the list of active masternodes on the network')
  console.log('')
  console.log('Notes:')
  console.log('- \'current block\' is the latest created block when script is executed.')
  console.log('- The market + peers databases only support (& defaults to) reindex mode.')
  console.log('- If check mode finds missing data (other than new data since last sync),')
  console.log('  this likely means that sync.update_timeout in settings.json is set too low.')
  console.log('')
  process.exit(100)
}

// exit function used to cleanup before finishing script
function exit(exitCode) {
  // always disconnect mongo connection
  mongoose.disconnect()

  // only remove sync lock if it was created in this session
  if (!lockCreated || db.lib.remove_lock(database, net) == true) {
    // clean exit with previous exit code
    process.exit(exitCode)
  } else {
    // error removing lock
    process.exit(1)
  }
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
                    exit(1)
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

function get_last_usd_price(net=settings.getDefaultNet()) {
  db.get_last_usd_price(function(err) {
    if (err == null) {
      const coin = settings.getCoin(net)
      db.update_last_updated_stats(coin.name, { markets_last_updated: Math.floor(new Date() / 1000) }, function(cb) {
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

const folder = process.argv[0]
const script = process.argv[1]


console.log("Sync args: '%s'", process.argv)

// 0 -> folder
// 1 -> sync.js
// 2 -> mode [update]
// 3 -> database
// . -> ...
// . -> ...
// L -> net

const last = process.argv[process.argv.length - 1]
if (last) {
  net = settings.getNetOrNull(last)
  if (net == null) {
    console.error("Chain '%s' not found.", last)
    exit(1)
  }
  coin = settings.getCoin(net)
}

// init DB
const enabled = settings.getDbOrNull(net).enabled
if (enabled) {
  db.connection_factory(net, settings.getDbConnectionString(net), function(conn) {
    db.initialize_data_startup(function() {
      // NOOP
    }, net)
  })
}

// check options
if (mode == null || mode == 'index' || mode == 'update') {
  mode = null

  switch (process.argv[3]) {
    case undefined:
    case null:
    case 'chain':
    case 'update':
      mode = 'update'
      if (!isNaN(process.argv[4]) && Number.isInteger(parseFloat(process.argv[4])))
        block_start = Math.max(0, parseInt(process.argv[4]))
      break
    case 'check':
      mode = 'check'
      // check if the block start value was passed in and is an integer
      if (!isNaN(process.argv[4]) && Number.isInteger(parseFloat(process.argv[4])))
        block_start = Math.max(0, parseInt(process.argv[4]))
      break
    case 'enrichtx':
      mode = 'enrichtx'
      break
    case 'insert-blocks':
      mode = 'insert-blocks'
      break
    case 'reindex':
      // check if readlinesync module is installed
      if (!db.fs.existsSync('./node_modules/readline-sync')) {
        console.log('Installing missing packages.. Please wait..')
        const { execSync } = require('child_process')
        execSync('npm update')
      }

      const readlineSync = require('readline-sync')
      console.log('You are about to delete all blockchain data (transactions and addresses) and resync from the genesis block.')

      // prompt for the reindex
      if (readlineSync.keyInYN('Are you sure you want to do this? ')) {
        mode = 'reindex'
      } else {
        console.log('Process aborted. Nothing was deleted')
        exit(2)
      }
      break
    case 'reindex-rich':
      mode = 'reindex-rich'
      break
    case 'reindex-txcount':
      mode = 'reindex-txcount'
      break
    case 'reindex-last':
      mode = 'reindex-last'
      break
    case 'peers':
      database = process.argv[3]
      break
    case 'masternodes':
      database = process.argv[3]
      break
    case 'market':
      database = `${process.argv[3]}s`
      break
    default:
      usage()
  }
} else
usage()

// check if this sync option is already running/locked
if (db.lib.is_locked([database], net) == false) {
  db.lib.create_lock(database, net)
  lockCreated = true
  // check the backup, restore and delete locks since those functions would be problematic when updating data
  if (db.lib.is_locked(['backup', 'restore', 'delete'], net) == false) {
    // all tests passed. OK to run sync
    console.log("Script launched with pid: %s", process.pid)

    if (mode == 'update')
      console.log('Syncing %s.. Please wait..', (database == 'index' ? 'blocks' : database))

    mongoose.set('strictQuery', true)

    /* update chain */
    
    if (database == 'index') {
      console.log('Syncing index..')
      db.check_stats(coin.name, function(exists) {
        if (exists == false) {
          console.log('Run \'npm start\' to create database structures before running this script.')
          exit(1)
        } else {
          db.update_db(net, coin.name, function(stats) {
            if (stats !== false) {
              // determine which index mode to run
              if (mode == 'reindex') {
                console.log('Deleting transactions.. Please wait..')
                TxDb[net].deleteMany({}, function(err) {
                  debug('Transactions deleted successfully. Deleting addresses.. Please wait..')
                  AddressDb[net].deleteMany({}, function(err2) {
                    debug('Addresses deleted successfully. Deleting address transactions.. Please wait..')
                    AddressTxDb[net].deleteMany({}, function(err3) {
                      debug('Address transactions deleted successfully. Deleting top 100 data.. Please wait..')
                      RichlistDb[net].updateOne({coin: coin.name}, {
                        received: [],
                        balance: []
                      }, function(err3) {
                        console.log('Top 100 data deleted successfully. Deleting block index.. Please wait..')
                        StatsDb[net].updateOne({coin: coin.name}, {
                          last: 0,
                          count: 0,
                          supply: 0,
                          txes: 0,
                          blockchain_last_updated: 0,
                          richlist_last_updated: 0
                        }, function() {
                          console.log('Block index deleted successfully')
                          check_show_sync_message(stats.count, net)

                          console.log('Starting resync of blockchain data.. Please wait..')
                          update_tx_db(net, coin.name, block_start, stats.count, stats.txes, settings.sync.update_timeout, false, function() {
                            // check if the script stopped prematurely
                            if (stopSync) {
                              console.log('Reindex was stopped prematurely')
                              exit(1)
                            } else {
                              // update blockchain_last_updated value
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
                                              console.log('Reindex complete (block: %s)', nstats.last)
                                              exit(0)
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
                        })
                      })
                    })
                  })
                })
              } else if (mode == 'check') {
                console.log('Checking blocks. Please wait...')

                update_tx_db(net, coin.name, block_start, stats.count, stats.txes, settings.sync.check_timeout, true, function() {
                  // check if the script stopped prematurely
                  if (stopSync) {
                    console.log('Block check was stopped prematurely')
                    exit(1)
                  } else {
                    db.get_stats(coin.name, function(nstats) {
                      console.log('Block check complete (block: %s)', nstats.last)
                      exit(0)
                    }, net)
                  }
                })
              } else if (mode == 'insert-blocks') {
                console.log('Insert blocks. Please wait...')

                // check if the block start value was passed in and is an integer
                if (!isNaN(process.argv[4])) {
                  block_start = Math.max(0, parseInt(process.argv[4]))
                } else {
                  block_start = 0
                }

                var end = stats.count
                // check if the block end value was passed in and is an integer
                if (!isNaN(process.argv[5])) {
                  // Check if the block start value is less than 1
                  const newEnd = parseInt(process.argv[5])
                  if (newEnd >= block_start && newEnd <= end)
                    end = newEnd
                }

                console.log('Insert blocks from height %d to %d...', block_start, end)
                const blocks_to_scan = []
                const task_limit_blocks = settings.sync.block_parallel_tasks
                // var task_limit_txs = 1

                if (task_limit_blocks < 1)
                  task_limit_blocks = 1

                for (i = block_start; i <= end; i++)
                  blocks_to_scan.push(i)

                async.eachLimit(blocks_to_scan, task_limit_blocks, function(block_height, next_block) {
                  db.find_block_by_height(block_height, function(block) {
                    if (block) {
                      console.log('Block %d is in DB.', block_height)
                    } else {
                      db.lib.get_blockhash(block_height, function(blockhash) {
                        if (blockhash) {
                          db.lib.get_block(blockhash, function(blockd) {
                            console.log('Sync block from daemon %s (%s)', block_height, blockhash)
                            if (blockd) {
                              debug("Block: %o", blockd)
                              db.create_block(blockd, function(blockr) {
                                
                              }, net) 
                            }
                          }, net)
                        }
                      }, net)
                    }
                    setTimeout( function() {
                      tx = null
                      stopSync ? next_block({}) : next_block() // stop or next
                    }, settings.sync.update_timeout)
                  }, net)
                }, function() {
                  console.log( "Finished insert blocks.")
                  exit(0)
                })

              } else if (mode == 'enrichtx') {
                console.log('Enrich TX. Please wait...')

                // check if the block start value was passed in and is an integer
                if (!isNaN(process.argv[4])) {
                  block_start = Math.max(1, parseInt(process.argv[4]))
                } else {
                  block_start = 0
                }

                var end = stats.count
                // check if the block end value was passed in and is an integer
                if (!isNaN(process.argv[5])) {
                  // Check if the block start value is less than 1
                  const newEnd = parseInt(process.argv[5])
                  if (newEnd >= block_start && newEnd <= end)
                    end = newEnd
                }

                console.log('Scan blocks from height %d to %d...', block_start, end)
                const blocks_to_scan = []
                const task_limit_blocks = settings.sync.block_parallel_tasks
                // var task_limit_txs = 1

                if (task_limit_blocks < 1)
                  task_limit_blocks = 1

                for (i = block_start; i <= end; i++)
                  blocks_to_scan.push(i)

                check_only = true

                const tx_types = settings.get(net, 'tx_types')
                const isButkoin = settings.isButkoin(net)
                const isBitoreum = settings.isBitoreum(net)
                const isRaptoreum = settings.isRaptoreum(net)
                const isYerbas = settings.isYerbas(net)

                async.eachLimit(blocks_to_scan, task_limit_blocks, function(block_height, next_block) {
                  db.lib.get_blockhash(block_height, function(blockhash) {
                    if (blockhash) {
                      console.log('Check block %s (%s)', block_height, blockhash)
                      db.lib.get_block(blockhash, function(block) {
                        if (block) {
                          var task_limit_txs = 1
                          async.eachLimit(block.tx, task_limit_txs, function(txid, next_tx) {
                            TxDb[net].findOne({txid: txid}).then((tx) => {
                              debug('Check TX with ID %s', txid)
                              if (tx === undefined || tx === null) {
                                console.log(" ... not found %o! Exit.", tx)
                                exit(1)
                              } else if (tx && tx != null && tx !== undefined) {
                                debug(" and type %s will be updated.", tx.tx_type)
                                
                                db.lib.get_rawtransaction(txid, function(rtx) {
                                  if (rtx && rtx.txid) {
                                    debug(" with TX from daemon and type: %s", rtx.type)
                                    var extra = null
                                    if (isButkoin || isBitoreum || isRaptoreum) {
                                      switch (tx.tx_type) {
                                        case tx_types.indexOf('TRANSACTION_NORMAL').toString(): break // -> NORMAL
                                        case tx_types.indexOf('TRANSACTION_PROVIDER_REGISTER').toString(): extra = datautil.protxRegisterServiceTxToArray(rtx); break
                                        case tx_types.indexOf('TRANSACTION_PROVIDER_UPDATE_SERVICE').toString(): extra = datautil.protxUpdateServiceTxToArray(rtx); break
                                        case tx_types.indexOf('TRANSACTION_PROVIDER_UPDATE_REGISTRAR').toString(): extra = datautil.protxUpdateRegistrarTxToArray(rtx); break
                                        case tx_types.indexOf('TRANSACTION_PROVIDER_UPDATE_REVOKE').toString(): extra = datautil.protxUpdateRevokeTxToArray(rtx); break
                                        case tx_types.indexOf('TRANSACTION_COINBASE').toString(): break // COINBASE, Array.from(rtx.extraPayload).reverse().join("")
                                        case tx_types.indexOf('TRANSACTION_QUORUM_COMMITMENT').toString(): extra = datautil.protxQuorumCommitmentTxToArray(rtx); break
                                        case tx_types.indexOf('TRANSACTION_FUTURE').toString(): extra = rtx.extraPayload; break
                                        default: console.warn('*** Unknown TX type %s.', tx.tx_type)
                                      }
                                    } else if (isYerbas) {
                                      switch (tx.tx_type) {
                                        case tx_types.indexOf('TRANSACTION_NORMAL').toString(): break // -> NORMAL
                                        case tx_types.indexOf('TRANSACTION_PROVIDER_REGISTER').toString(): extra = datautil.protxRegisterServiceTxToArray(rtx); break
                                        case tx_types.indexOf('TRANSACTION_PROVIDER_UPDATE_SERVICE').toString(): extra = datautil.protxUpdateServiceTxToArray(rtx); break
                                        case tx_types.indexOf('TRANSACTION_PROVIDER_UPDATE_REGISTRAR').toString(): extra = datautil.protxUpdateRegistrarTxToArray(rtx); break
                                        case tx_types.indexOf('TRANSACTION_PROVIDER_UPDATE_REVOKE').toString(): extra = datautil.protxUpdateRevokeTxToArray(rtx); break
                                        case tx_types.indexOf('TRANSACTION_COINBASE').toString(): break // COINBASE, Array.from(rtx.extraPayload).reverse().join("")
                                        case tx_types.indexOf('TRANSACTION_QUORUM_COMMITMENT').toString(): extra = datautil.protxQuorumCommitmentTxToArray(rtx); break
                                        case tx_types.indexOf('TRANSACTION_FUTURE').toString(): extra = rtx.extraPayload; break
                                        case tx_types.indexOf('TRANSACTION_ASSET_REGISTER').toString(): extra = rtx.extraPayload; break
                                        case tx_types.indexOf('TRANSACTION_ASSET_REISUE').toString(): extra = rtx.extraPayload; break
                                        default: console.warn('*** Unknown TX type %s.', tx.tx_type); console.log(JSON.stringify.tx); exit(0);
                                      }
                                    }
                                    TxDb[net].updateOne({txid: txid}, {
                                      version: rtx.version,
                                      tx_type: rtx.type,
                                      size: rtx.size,
                                      locktime: rtx.locktime,
                                      instantlock: rtx.instantlock,
                                      chainlock: rtx.chainlock,
                                      extra: extra
                                    }).then(() => {
                                      setTimeout( function() {
                                        tx = next_tx
                                        // next_tx()
                                      }, settings.sync.update_timeout)
                                      console.log("TX %s updated.", txid)
                                      // return cb()
                                    }).catch((err) => {
                                      console.error("Failed to update TX with ID '%s': %s", txid, tx_type)
                                    })
                                  }
                                }, net)
                                setTimeout( function() {
                                  tx = null
                                  stopSync ? next_tx({}) : next_tx() // stop or next
                                }, settings.sync.update_timeout)
                              }
                            }).catch((err) => {
                              console.error("Failed to find TX '%s' for chain '%s': %s", tx, net, err)
                              return cb()
                            })
                          }, function() {
                            setTimeout( function() {
                              blockhash = null
                              block = null
                              stopSync ? next_block({}) : next_block() // stop or next
                            }, settings.sync.update_timeout)
                          })
                        } else {
                          console.log('Block not found: %s', blockhash)
                          setTimeout( function() {
                            stopSync ? next_block({}) : next_block() // stop or next
                          }, settings.sync.update_timeout)
                        }
                      }, net)
                    } else {
                      console.log("- not found! Exit.")
                      exit(1)
                    }
                  }, net)
                }, function() {
                  console.log( "Finished.")
                  exit(0)
                })
              } else if (mode == 'update') {
                // Get the last synced block index value
                var last = (stats.last ? stats.last : 0)
                // Get the total number of blocks
                var count = (stats.count ? stats.count : 0)
                check_show_sync_message(count - last)

                if (block_start > 0)
                  last = block_start

                update_tx_db(net, coin.name, last, count, stats.txes, settings.sync.update_timeout, false, function() {
                  // check if the script stopped prematurely
                  if (stopSync) {
                    console.log('Block sync was stopped prematurely')
                    exit(1)
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
                                    exit(0)
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
              } else if (mode == 'reindex-rich') {
                console.log('Check richlist')
                db.check_richlist_and_upgrade_schema(coin.name, function(exists) {
                  if (exists)
                    console.log('Richlist entry found, deleting now..')
                  db.delete_richlist(coin.name, function(deleted) {
                    if (deleted)
                      console.log('Richlist entry deleted')
                    db.create_richlist(coin.name, false, function() {
                      console.log('Richlist created')
                      db.update_richlist('received', function() {
                        console.log('Richlist updated received')
                        db.update_richlist('balance', function() {
                          db.update_richlist('toptx', function() {
                            db.update_last_updated_stats(coin.name, { richlist_last_updated: Math.floor(new Date() / 1000) }, function(cb) {
                              console.log("Richlist update complete for net '%s'", net)
                              exit(0)
                            }, net)
                          }, net)
                        }, net)
                      }, net)
                    }, net)
                  }, net)
                }, net)
              } else if (mode == 'reindex-txcount') {
                console.log('Calculating tx count.. Please wait..')

                // Resetting the transaction counter requires a single lookup on the txes collection to find all txes that have a positive or zero total and 1 or more vout
                TxDb[net].find({'total': {$gte: 0}, 'vout': { $gte: { $size: 1 }}}).countDocuments(function(err, count) {
                  console.log('Found tx count: %d', count.toString())
                  StatsDb[net].updateOne({coin: coin.name}, {
                    txes: count
                  }, function() {
                    console.log('Tx count update complete')
                    exit(0)
                  })
                })
              } else if (mode == 'reindex-last') {
                console.log('Finding last blockindex.. Please wait..')

                // Resetting the last blockindex counter requires a single lookup on the txes collection to find the last indexed blockindex
                TxDb[net].find({}, {blockindex:1, _id:0}).sort({blockindex: -1}).limit(1).exec(function(err, tx) {
                  // check if any blocks exists
                  if (err != null || tx == null || tx.length == 0) {
                    console.log('No blocks found. setting last blockindex to 0.')

                    StatsDb[net].updateOne({coin: coin.name}, {
                      last: 0
                    }, function() {
                      console.log('Last blockindex update complete')
                      exit(0)
                    })
                  } else {
                    console.log('Found last blockindex: %d', tx[0].blockindex.toString())

                    StatsDb[net].updateOne({coin: coin.name}, {
                      last: tx[0].blockindex
                    }, function() {
                      console.log('Last blockindex update complete')
                      exit(0)
                    })
                  }
                })
              }
            } else {
              // update_db threw an error so exit
              exit(1)
            }
          })
        }
      }, net)
    } else if (database == 'peers') {
      db.lib.get_peerinfo(net, function(body) {
        if (body != null) {
          db.lib.syncLoop(body.length, function(loop) {
            var i = loop.iteration()
            var address = body[i].addr
            var port = null

            if (address.includes(':') || address.includes(']:')) {
              // Separate the port # from the IP address
              address = address.substring(0, address.lastIndexOf(":")).replace("[", "").replace("]", "")
              port = body[i].addr.substring(body[i].addr.lastIndexOf(":") + 1)
            }

            if (address.indexOf("]") > -1) {
              // Remove [] characters from IPv6 addresses
              address = address.replace("[", "").replace("]", "")
            }

            console.log("Check peer update: %s, version %s", address, body[i].version)
            db.find_peer(address, port, function(peer) {
              if (peer) {
                // if (peer['port'] != null && (isNaN(peer['port']) || peer['port'].length < 2)) {
                //   db.drop_peers(function() {
                //     console.log('Removing peers due to missing port information. Re-run this script to add peers again.')
                //     exit(1)
                //   }, net)
                // }

                // peer already exists and should be refreshed
                // drop peer
                db.drop_peer(address, port, function() {
                  // re-add the peer to refresh the data and extend the expiry date
                  console.log( 'Dropped peer %s port %d', address, port)
                  var subver = body[i].subver
                  if (subver) {
                    subver = subver.replace('/', '').replace('/', '').replace('\n', '')
                  }
                  db.create_peer({
                    address: address,
                    port: port,
                    protocol: body[i].version,
                    version: subver,
                    country: peer.country,
                    country_code: peer.country_code
                  }, function() {
                    console.log('Created peer %s:%s [%s/%s] %s / version %s', address, port ? port.toString() : '', (i + 1).toString(), body.length.toString(), peer.protocol, peer.version)

                    if (stopSync) {
                      loop.break(true)
                    }

                    loop.next()
                  }, net)
                }, net)
              } else {
                const rateLimitLib = require('../lib/ratelimit')
                const rateLimit = new rateLimitLib.RateLimit(1, 2000, false)

                rateLimit.schedule(function() {
                  db.lib.get_geo_location(address, function(error, geo) {
                    // check if an error was returned
                    if (error) {
                      console.log(error)
                      exit(1)
                    } else if (geo == null || typeof geo != 'object') {
                      console.log('Error: geolocation api did not return a valid object')
                      exit(1)
                    } else {
                      // add peer to collection
                      db.create_peer({
                        address: address,
                        port: port,
                        protocol: body[i].version,
                        version: body[i].subver.replace('/', '').replace('/', ''),
                        country: geo.country_name,
                        country_code: geo.country_code
                      }, function() {
                        console.log('Added new peer %s:%s [%s/%s]', address, port ? port.toString() : '', (i + 1).toString(), body.length.toString())

                        if (stopSync) {
                          loop.break(true)
                        }

                        loop.next()
                      }, net)
                    }
                  })
                })
              }
            }, net)
          }, function() {
            db.update_last_updated_stats(coin.name, { network_last_updated: Math.floor(new Date() / 1000) }, function(cb) {
              // check if the script stopped prematurely
              if (stopSync) {
                console.log('Peer sync was stopped prematurely')
                exit(1)
              } else {
                console.log('Peer sync complete')
                exit(0)
              }
            }, net)
          })
        } else {
          console.log('No peers found')
          exit(2)
        }
      })
    } else if (database == 'masternodes') {
      db.lib.get_masternodelist(net, function(body) {
        if (body != null) {
          var isObject = false
          var objectKeys = null
          // Check if the masternode data is an array or an object
          if (body.length == null) {
            // Process data as an object
            objectKeys = Object.keys(body)
            isObject = true
          }
          const rateLimitLib = require('../lib/ratelimit')
          const rateLimit = new rateLimitLib.RateLimit(1, 2000, false)
          var enabled = 0

          db.get_masternodes(function(masternodes) {
            console.log('Got Smartnode list by DB with size: %d', masternodes.length)
            db.lib.syncLoop((isObject ? objectKeys : body).length, function(loop) {
              var i = loop.iteration()
              var node = isObject ? body[objectKeys[i]] : body[i]
              if ('pepew' == net) {
                // It is the tx as key and a space or tab separated string as value rest of the values.
                const okeys = Object.keys(body)
                const allItems = node.trim().split(' ')
                let items = allItems.reduce((acc, i) => i ? [...acc, i] : acc, [])
                node = {}
                node.network = 'mainnet'
                node.proTxHash = okeys[i].indexOf("-") > -1 ? okeys[i].substring(0, okeys[i].indexOf("-")) : okeys[i]
                node.outidx = okeys[i].indexOf("-") > -1 ? okeys[i].substring(okeys[i].indexOf("-") + 1, okeys[i].length) : okeys[i]
                node.status = items[0]
                node.version = items[1]
                node.payee = items[2]
                node.uptime = items[3]
                node.lastseen = items[4]
                node.lastpaidtime = items[5] // lastpaid
                node.lastpaidblock = items[6] // last_paid_block
                node.address = items[7]
                node.ip_address = items[7]
              } else {
                // Copy for BUTK.
                node.txhash = node.proTxHash
                /* node.lastseen = node.lastseentime */
                node.lastpaid = node.lastpaidtime
                node.last_paid_block = node.lastpaidblock
                node.pose_score = node.pospenaltyscore
                node.txhash = node.proTxHash
              }
              if (node.status == 'ENABLED')
                ++enabled
              // Copy for BUTK end.
              var address = node.address
              console.log('Sync Smartnode %s', address)
              var name = ''
              var code = ''
              // IP location does not change so often...
              for (mn of masternodes) {
                if (address == mn.ip_address) {
                  if (mn.country && mn.country_code && mn.country.length > 0 && mn.country_code.length > 0) {
                    name = mn.country
                    code = mn.country_code
                  }
                }
              }
              address = address.indexOf(":") > -1 ? address.substring(0, address.indexOf(":")) : address
              
              if (name.length > 0 && code.length > 0) {
                node.country = name
                node.country_code = code
                db.save_masternode(node, function(success) {
                  if (success) {
                    // check if the script is stopping
                    if (stopSync) {
                      loop.break(true)
                    }
                    loop.next()
                  } else {
                    console.log('Error: Cannot save Smartnode %s.', (isObject ? (body[objectKeys[i]].payee ? body[objectKeys[i]].payee : 'UNKNOWN') : (body[i].addr ? body[i].addr : 'UNKNOWN')))
                    exit(1)
                  }
                }, net)
              } else {
                rateLimit.schedule(function() {
                  console.log('Request geo location for Smartnode: %s', address)
                  db.lib.get_geo_location(address, function(error, geo) {
                    // check if an error was returned    
                    if (error) {
                      console.log(error)
                    } else if (geo == null || typeof geo != 'object') {
                      console.log('Error: geolocation api did not return a valid object')
                    } else {
                      name = geo.country_name
                      code = geo.country_code
                    }
                    node.country = name
                    node.country_code = code
                    db.save_masternode(node, function(success) {
                      if (success) {
                        // check if the script is stopping
                        if (stopSync) {
                          loop.break(true)
                        }
                        loop.next()
                      } else {
                        console.log('Error: Cannot save Smartnode %s.', (isObject ? (body[objectKeys[i]].payee ? body[objectKeys[i]].payee : 'UNKNOWN') : (body[i].addr ? body[i].addr : 'UNKNOWN')))
                        exit(1)
                      }
                    }, net)
                  })
                })
              }
            }, function() {
              StatsDb[net].updateOne({coin: coin.name}, {
                smartnodes_total: masternodes.length,
                smartnodes_enabled: enabled,
                masternodes_last_updated: Math.floor(new Date() / 1000)
              }).then(() => {
                if (stopSync) {
                  console.log('Smartnodes sync was stopped prematurely')
                  exit(1)
                } else {
                  console.log('Smartnodes sync complete')
                  exit(0)
                }
              })
            })
          }, net)
        } else {
          console.log('No Smartnodes found')
          exit(2)
        }
      })
    } else {
      /* update markets */
      const markets_page = settings.get(net, 'markets_page')
      if (markets_page.enabled == true) {
        var complete = 0
        var total_pairs = 0
        var exchanges = Object.keys(markets_page.exchanges)

        // loop through exchanges and update trading pairs
        exchanges.forEach(function(key, index, map) {
          if (markets_page.exchanges[key].enabled == true) {
            if (db.fs.existsSync('./lib/markets/' + key + '.js')) {
              total_pairs += markets_page.exchanges[key].trading_pairs.length
              for (var i = 0; i < markets_page.exchanges[key].trading_pairs.length; i++) {
                // ensure trading pair setting is always uppercase
                markets_page.exchanges[key].trading_pairs[i] = markets_page.exchanges[key].trading_pairs[i].toUpperCase()
              }
            }
          }
        })

        // update trading pairs
        if (total_pairs > 0) {
          var rateLimitLib = require('../lib/ratelimit')
          var rateLimit = new rateLimitLib.RateLimit(1, 2000, false)
          // loop through and test all exchanges defined in the settings.json file
          exchanges.forEach(function(key, index, map) {
            // check if market is enabled via settings
            if (markets_page.exchanges[key].enabled == true) {
              if (db.fs.existsSync('./lib/markets/' + key + '.js')) {
                const exMarket = require('../lib/markets/' + key + '.js')
                // loop through all trading pairs
                markets_page.exchanges[key].trading_pairs.forEach(function(pair_key, pair_index, pair_map) {
                  const split_pair = pair_key.split('/')
                  const reverse = coin.symbol != split_pair[0]

                  if (split_pair.length == 2) {
                    // lookup the exchange in the market collection
                    db.check_market(key, split_pair[0], split_pair[1], reverse, function(mkt, exists) {
                      if (!exists) {
                        // exchange doesn't exist in the market collection so add a default definition now
                        console.log('No %s: %s (reverse=%s) entry found. Creating new entry now..', exMarket.market_name, pair_key, reverse)
                        db.create_market(split_pair[0], split_pair[1], reverse, exMarket.market_name.toLowerCase(), exMarket.ext_market_url, exMarket.referal, exMarket.market_logo, function() {
                          // !!! automatically pause for 2 seconds in between requests
                          rateLimit.schedule(function() {
                            db.update_markets_db(key, split_pair[0], split_pair[1], reverse, function(err) {
                              if (!err) {
                                console.log('%s[%s]: Market data updated successfully.', key, pair_key)
                                complete++
                                if (complete == total_pairs || stopSync)
                                  get_last_usd_price(net)
                              } else {
                                console.log('%s[%s] Error: %s', key, pair_key, err)
                                complete++
                                if (complete == total_pairs || stopSync)
                                  get_last_usd_price(net)
                              }
                            }, net)
                          })
                        }, net)
                      } else {
                        rateLimit.schedule(function() {
                          db.update_markets_db(key, split_pair[0], split_pair[1], reverse, function(err) {
                            if (!err) {
                              console.log('%s[%s]: Market data updated successfully.', key, pair_key)
                              complete++
                              if (complete == total_pairs || stopSync)
                                get_last_usd_price(net)
                            } else {
                              console.log('%s[%s] Error: %s', key, pair_key, err)
                              complete++
                              if (complete == total_pairs || stopSync)
                                get_last_usd_price(net)
                            }
                          }, net)
                        })
                      }
                    }, net)
                  }
                })
              } else {
                console.log('%s market is not installed', key)
                complete++
                if (complete == total_pairs || stopSync)
                  get_last_usd_price(net)
              }
            }
          })
        } else {
          console.log('Error: No market trading pairs are enabled in settings')
          exit(1)
        }
      } else {
        console.log('Error: Market feature is disabled in settings')
        exit(1)
      }
    }
  } else {
    // another script process is currently running
    console.log("Sync aborted")
    exit(2)
  }
} else {
  // sync process is already running
  console.log("Sync aborted")
  exit(2)
}