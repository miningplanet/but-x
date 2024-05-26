const debug = require('debug')('debug')
const mongoose = require('mongoose')
const settings = require('../lib/settings')
const async = require('async')
const db = require('../lib/database')
const { TokenDb, TxDb } = require('../lib/database')
const datautil = require('../lib/datautil')
const util = require('./syncutil')

util.check_net_missing(process.argv)

const net = process.argv[2]

util.check_net_unknown(net)

const coin = settings.getCoin(net)
const lock = 'tokens'
var stopSync = false

util.gracefully_shut_down(process, stopSync)

util.log_start(lock, net, coin)

const tx_type = !isNaN(process.argv[3]) ? parseInt(process.argv[3]) : 8
const block_start = !isNaN(process.argv[4]) ? Math.max(1, parseInt(process.argv[4])) : 0
const end = !isNaN(process.argv[5]) ? Math.max(1, parseInt(process.argv[5])) : -1

if (!db.lib.is_locked([lock], net)) {
  db.lib.create_lock(lock, net)
  lockCreated = true

  util.init_db(net, function(status) {
    get_tx_by_type(tx_type, block_start, end, function(txes) {
      console.log("Found %d txes of type %d.", txes.length, tx_type)
      if (Array.isArray(txes)) {
        async.eachLimit(txes, 1, function(tx, next_tx) {
          db.lib.get_rawtransaction(tx.txid, function(rtx) {
            if (rtx) {
              for (i in rtx.vout) {
                if (rtx.vout[i].scriptPubKey && rtx.vout[i].scriptPubKey.asset) {
                  const asset = rtx.vout[i].scriptPubKey.asset
                  const type = rtx.vout[i].scriptPubKey.type
                  debug("Found asset: %o of type %s", asset, type)
                  create_or_update_token(asset.name, rtx.height, rtx.txid, rtx.vout, type, asset, function(token) {
                    console.log("Created or updated token %s", asset.name)
                  }, net)
                }
              }
            } else {
              console.log("Fail to get TX with id '%s' from daemon.", txid)
            }
            next_tx()
          }, net)
        }, function() {
          setTimeout( function() {
            util.exit_remove_lock_completed(lock, coin, net)
            // blockhash = null
            // block = null
            // stopSync ? exit(0) : next_tx() // stop or next
          }, settings.sync.update_timeout)
        })
      } else {
        console.log('No data found to reindex.')  
      }
    }, net)
  })
}

function get_tx_by_type(type, start, end, cb, net) {
  const findCriteria = {'blockindex': {$gte: start}, 'blockindex': {$lte: end}, 'tx_type': type, 'vout': { $gte: { $size: 1 }}}

  TxDb[net].find(findCriteria).then((txes) => {
    if (txes)
      return cb(txes)
    else
      return cb(null)
  }).catch((err) => {
    console.error("Failed to find txes from %d to %d of type %s for chain '%s': %s", type, start, end, net, err)
    return cb(null)
  })
}

function create_or_update_token(name, height, txid, vout, type, token, cb, net) {
  console.log("Try to create or update token '%s' height %d txid '%s' vout %d of type '%s' for chain '%s'.", name, height, txid, vout.length, type, net)
  
  TokenDb[net].findOne({name: name}).then((dbtoken) => {
    if (dbtoken) {
      debug('Update existing token %o.\n', dbtoken)

      datautil.yerbasAssetToToken(height, txid, vout, type, dbtoken, token)
      dbtoken = TokenDb[net].updateOne({name: name}, dbtoken).then(() => {
        console.log("Updated token '%s' from DB.", name)
        return cb(dbtoken)
      }).catch((err) => {
        console.error("Failed to update token '%s' for txid '%s' for chain '%s': %s", name, txid, net, err)
        return cb(err)
      })
    } else {
      dbtoken = {}
      dbtoken.name = name
      const dtoX = datautil.yerbasAssetToToken(height, txid, vout, type, dbtoken, token)
      const dto = TokenDb[net].create(dtoX)
      if (dto)
          console.log("Created token '%s' for %s", net)
      return cb(dto)
    }
  }).catch((err) => {
    console.error("Failed to find token '%s' height %d for chain '%s': %s", name, height, net, err)
    return cb()
  })
}