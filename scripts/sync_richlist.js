const debug = require('debug')('sync')
const settings = require('../lib/settings')
const db = require('../lib/database')
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