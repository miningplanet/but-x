const debug = require('debug')('sync')
const settings = require('../lib/settings')
const db = require('../lib/database')
const { PeersDb } = require('../lib/database')
const util = require('./syncutil')

util.check_net_missing(process.argv)

const net = process.argv[2]

util.check_net_unknown(net)

const coin = settings.getCoin(net)
const lock = 'peers'
var stopSync = false

util.gracefully_shut_down(process, stopSync)

util.log_start(lock, net, coin)

if (!db.lib.is_locked([lock], net)) {
  db.lib.create_lock(lock, net)
  lockCreated = true

  util.init_db(net, function(status) {
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

          console.log("Check peer update: %s:%d, version %s", address, port, body[i].version)
          find_peer(address, port, function(peer) {
            if (peer) {
              // if (peer['port'] != null && (isNaN(peer['port']) || peer['port'].length < 2)) {
              //   db.drop_peers(function() {
              //     console.log('Removing peers due to missing port information. Re-run this script to add peers again.')
              //     exit(1)
              //   }, net)
              // }

              // peer already exists and should be refreshed
              // drop peer
              drop_peer(address, port, function() {
                // re-add the peer to refresh the data and extend the expiry date
                console.log('Dropped peer %s port %d', address, port)
                var subver = body[i].subver
                if (subver) {
                  subver = subver.replace('/', '').replace('/', '').replace('\n', '')
                }
                create_peer({
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
                    util.exit_remove_lock(1, lock, net)
                  } else if (geo == null || typeof geo != 'object') {
                    console.log('Error: geolocation api did not return a valid object')
                    util.exit_remove_lock(1, lock, net)
                  } else {
                    // add peer to collection
                    create_peer({
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
              util.exit_remove_lock(1, lock, net)
            } else {
              util.exit_remove_lock_completed(lock, coin, net)
            }
          }, net)
        })
      } else {
        console.log('No peers found')
        util.exit_remove_lock(2, lock, net)
      }
    })
  })
}

function find_peer(address, port, cb, net) {
  const network_page = settings.get(net, 'network_page')
  if (network_page.enabled == true) {
    // TODO: Fix PeersDb is undefined.
    db.PeersDb[net].findOne({address: address, port: port}).then((peer) => {
      if (peer)
        return cb(peer)
      else
        return cb (null)
    }).catch((err) => {
      console.error("Failed to find peer address '%s' for chain '%s': %s", address, net, err)
      return cb(null)
    })
  } else {
    return cb(null)
  }
}

function create_peer(params, cb, net) {
  const network_page = settings.get(net, 'network_page')
  if (network_page.enabled == true) {
    PeersDb[net].create(params).then((peer) => {
      return cb()
    }).catch((err) => {
      console.error("Failed to insert peer for chain '%s': %s", net, err)
      return cb()
    })
  } else {
    return cb()
  }
}

function drop_peer(address, port, cb, net=settings.getDefaultNet()) {
  PeersDb[net].deleteOne({address: address, port: port}).then(() => {
    return cb()
  }).catch((err) => {
    console.error("Failed to drop peer address '%s' for chain '%s': %s", address, net, err)
    return cb()
  })
}

function drop_peers(cb, net=settings.getDefaultNet()) {
  PeersDb[net].deleteMany({}).then(() => {
    return cb()
  }).catch((err) => {
    console.error("Failed to drop peers for chain '%s': %s", net, err)
    return cb()
  })
}
