const debug = require('debug')('sync')
const settings = require('../lib/settings')
const db = require('../lib/database')
const { AddressDb, TxDb, RichlistDb } = require('../lib/database')
const util = require('./syncutil')

util.check_net_missing(process.argv)

const net = process.argv[2]

util.check_net_unknown(net)

const coin = settings.getCoin(net)
const lock = 'richlist'
var stopSync = false

util.gracefully_shut_down(process, stopSync)

util.log_start(lock, net, coin)

if (!db.lib.is_locked([lock], net)) {
  db.lib.create_lock(lock, net)
  lockCreated = true

  util.init_db(net, function(status) {
    check_richlist_and_upgrade_schema(coin.name, function(exists) {
      if (exists)
        console.log('Richlist entry found, deleting now..')
      delete_richlist(coin.name, function(deleted) {
        if (deleted)
          console.log('Richlist entry deleted')
        create_richlist(coin.name, false, function() {
          console.log('Richlist created')
          update_richlist('received', function() {
            console.log('Richlist updated received')
            update_richlist('balance', function() {
              update_richlist('toptx', function() {
                util.update_last_updated_stats(coin.name, { richlist_last_updated: Math.floor(new Date() / 1000) }, function(cb) {
                  util.exit_remove_lock_completed(lock, coin, net)
                }, net)
              }, net)
            }, net)
          }, net)
        }, net)
      }, net)
    }, net)
  })
}

function create_richlist(coin, skip, cb, net=settings.getDefaultNet()) {
  if (!skip) {
    var dto = RichlistDb[net].create({
      coin: coin
    })
    if (dto) {
      console.log("Initial richlist entry created for %s", coin)
    }
    return cb()
  } else
    return cb()
}

function delete_richlist(coin, cb, net=settings.getDefaultNet()) {
  RichlistDb[net].findOneAndDelete({coin: coin}).then((data) => {
    return cb(data ? true : false)
  }).catch((err) => {
    console.error("Failed to delete richlist for chain '%s': %s", net, err)
    // return cb(null)
  })
}

function check_richlist_and_upgrade_schema(coin, cb, net=settings.getDefaultNet()) {
  RichlistDb[net].findOne({coin: coin}).then((data) => {
    return cb(data ? true : false)
  }).catch((err) => {
    console.error("Failed to richlist for chain '%s': %s", net, err)
    // return cb(null)
  })
}

function update_richlist(list, cb, net=settings.getDefaultNet()) {
  const coin = settings.getCoin(net)
  const cnt = 100
  // create the burn address array so that we omit burned coins from the rich list
  const richlist_page = settings.get(net, 'richlist_page')
  var burn_addresses = richlist_page.burned_coins.addresses

  // always omit special addresses used by but-x from the richlist (coinbase, hidden address and unknown address)
  burn_addresses.push('coinbase')
  burn_addresses.push('hidden_address')
  burn_addresses.push('unknown_address')

  if (list == 'received') {
    // update 'received' richlist data
    AddressDb[net].find({a_id: { $nin: burn_addresses }}, 'a_id name balance received').sort({received: 'desc'}).limit(cnt).exec().then((addresses) => {
      RichlistDb[net].updateOne({coin: coin.name}, {
        received: addresses
      }).then(() => {
        return cb()
      }).catch((err) => {
        console.error("Failed to update richlist address for chain '%s': %s", net, err)
        // return cb(null)
      })
    }).catch((err) => {
      console.error("Failed to find richlist address for chain '%s': %s", net, err)
      // return cb(null)
    })
  } else if (list == 'balance') {
    // update 'balance' richlist data
    // check if burned addresses are in use and if it is necessary to track burned balances
    if (richlist_page.burned_coins.addresses == null || richlist_page.burned_coins.addresses.length == 0 || !richlist_page.burned_coins.include_burned_coins_in_distribution) {
      // update 'balance' richlist data by filtering burned coin addresses immidiately
      AddressDb[net].find({a_id: { $nin: burn_addresses }}, 'a_id name balance received').sort({balance: 'desc'}).limit(cnt).exec().then((addresses) => {
        RichlistDb[net].updateOne({coin: coin.name}, {
          balance: addresses
        }).then(() => {
          return cb()
        })
      }).catch((err) => {
        console.error("Failed to find richlist address for chain '%s': %s", net, err)
        // return cb(null)
      })
    } else {
      // do not omit burned addresses from database query. instead, increase the limit of returned addresses and manually remove each burned address that made it into the rich list after recording the burned balance
      AddressDb[net].find({}, 'a_id name balance received').sort({balance: 'desc'}).limit(cnt + burn_addresses.length).exec().then((addresses) => {
        var return_addresses = []
        var burned_balance = 0.0

        // loop through all richlist addresses
        addresses.forEach(function (address) {
          // check if this is a burned coin address
          if (burn_addresses.findIndex(p => p.toLowerCase() == address.a_id.toLowerCase()) > -1) {
            // this is a burned coin address so save the balance, not the address
            burned_balance += address.balance
          } else if (return_addresses.length < cnt) {
            // this is not a burned address so add it to the return list
            return_addresses.push(address)
          }
        })

        // update the rich list collection
        RichlistDb[net].updateOne({coin: coin.name}, {
          balance: return_addresses,
          burned: burned_balance
        }).then(() => {
          return cb()
        }).catch((err) => {
          console.error("Failed to update richlist address for chain '%s': %s", net, err)
        })
      }).catch((err) => {
        console.error("Failed to find richlist address for chain '%s': %s", net, err)
      })
    }
  } else if (list == 'toptx') {
    // db.txes.find({total: { $gte: 2500000000000000 }}, {total: 1, blockindex: 1}).sort({blockindex:-1})
    TxDb[net].find({}, 'txid total blockindex blockhash size timestamp tx_type').sort({total: 'desc'}).limit(cnt).exec().then((txes) => {
      RichlistDb[net].updateOne({coin: coin.name}, {
        toptx: txes
      }).then(() => {
        return cb()
      })
    }).catch((err) => {
      console.error("Failed to find richlist top tx for chain '%s': %s", net, err)
    })
  }
}