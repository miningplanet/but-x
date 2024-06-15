const debug = require('debug')('sync')
const settings = require('../lib/settings')
const async = require('async')
const db = require('../lib/database')
const util = require('./syncutil')

util.check_net_missing(process.argv)

const net = process.argv[2]

util.check_net_unknown(net)

const timeout = 5
var mode = 'check_range'
if (process.argv[3])
  mode = process.argv[3]

const coin = settings.getCoin(net)
const lock = 'address_balances'
var stopSync = false

util.gracefully_shut_down(process, stopSync)

util.log_start(lock, net, coin)

if (db.lib.is_locked([lock], net)) {
  console.error("Skip sync for '%s' for net '%s'.", lock, net)
  util.exit_remove_lock(2, lock, net)
}

db.lib.create_lock(lock, net)
lockCreated = true

const skip = new Set()
var updated = 0

util.init_db(net, function(status) {

  util.create_or_get_dbindex(net, coin.name, function (dbindex) {
    if (!dbindex)
      util.exit_remove_lock_completed(lock, coin, net)

    util.create_or_get_stats(net, coin.name, function(stats) {
      if (!stats)
        util.exit_remove_lock_completed(lock, coin, net)

      if (mode == 'range' || mode == 'check_range') {
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

        console.log("Got %d addresses for net '%s'.", dbindex.count_addresses, net)

        update_address_balances(block_start, block_end, timeout, function() {
          util.exit_remove_lock_completed(lock, coin, net)
        })
      } else {
        // TODO: Implement address mode.
        console.error("Mode is unknown. Use range, check_range, address or check_address. Exit.")
        util.exit_remove_lock(2, lock, net)
      }
    })
  })
})

function get_block_start(process, dbindex) {
  var r = dbindex.count_blocks
  if (process.argv.length > 4) {
    const new_start = util.get_int_param(process.argv, 4)
    if (new_start > -1)
      r = new_start
  }
  return r
}

function get_block_end(process, stats) {
  var r = stats.last
  if (process.argv.length > 5) {
    const new_end = util.get_int_param(process.argv, 5)
    if (new_end > -1)
      r = new_end
  }
  return r
}

function update_address_balances(start, end, timeout, cb) {
  const blocks_to_scan = []

  for (i = start; i < (end + 1); i++) {
    blocks_to_scan.push(i)
    if (i % 1000 == 0)
      console.log('Prepare scan block %d.', i)
  }

  async.eachLimit(blocks_to_scan, 1, function(block_height, next_block) {
    get_addresses_by_txout(block_height, function(addresses) {
      if (Array.isArray(addresses)) {
        addresses.forEach(async e => {
          if (!skip.has(e)) {
            skip.add(e)
            await update_address(e)
          }
        })
      }
      setTimeout( function() {
        console.log("Finished block %d, verified %d addresses, updated %d. mem: %s", block_height, skip.size, updated, process.memoryUsage().heapTotal / 1024 / 1024)
        stopSync ? next_block({}) : next_block() // stop or next
      }, timeout)
    })
  }, function() {
    return cb()
  })
}

async function update_address(hash) {
  db.get_address_local(hash, function(address) {
    if (address) {
      debug("Verify address '%s' for net '%s'.", address.a_id, net)
      const old_balance = address.balance
      const old_received = address.received
      const old_sent = address.sent
      address.balance = 0
      address.received = 0
      address.sent = 0
      get_txouts_by_address(hash, function(txouts) {
        debug("Got %d txouts for address '%s',", txouts.length, address.a_id)
        if (Array.isArray(txouts)) {
          txouts.forEach(e => {
            address.balance += e.amount
            if (e.amount < 0) {
              address.sent -= e.amount
            } else {
              address.received += e.amount
            }
          })

          const needsUpdated = old_balance != address.balance || old_received != address.received || old_sent != address.sent
          if (needsUpdated) {
            ++updated
            debug("Updated address '%s': b %d, r %d, s %d.", address.a_id, address.balance, address.received, address.sent )
            if (mode == 'range') {
              db.AddressDb[net].updateOne({a_id: address.a_id}, {
                balance: address.balance,
                received: address.received,
                sent: address.sent
              }).then(() => {
                debug("Stored address '%s' in db.", address.a_id)
              }).catch((err) => {
                console.error("Failed to update address '%s' for chain '%s': %s", address.a_id, net, err)
              })
            }
          }
        }
      })
    }
  }, net)
}

function get_addresses_by_txout(block_height, cb) {
  db.AddressTxDb[net].distinct('a_id', { blockindex: block_height }).exec().then((addresses) => {
    cb(addresses)
  }).catch((err) => {
    console.error("Failed to find addresses by txouts for height %d for chain '%s': %s", block_height, net, err)
    cb(err)
  })
}

function get_txouts_by_address(hash, cb) {
  db.AddressTxDb[net].find({'a_id': hash }).exec().then((txouts) => {
    cb(txouts)
  }).catch((err) => {
    console.error("Failed to find txouts for address '%s' for chain '%s': %s", hash, net, err)
    cb(err)
  })
}
