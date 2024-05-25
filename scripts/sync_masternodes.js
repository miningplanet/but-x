const debug = require('debug')('sync')
const settings = require('../lib/settings')
const db = require('../lib/database')
const { StatsDb, MasternodeDb } = require('../lib/database')
const util = require('./syncutil')

util.check_net_missing(process.argv)

const net = process.argv[2]

util.check_net_unknown(net)

const coin = settings.getCoin(net)
const lock = 'masternodes'
var stopSync = false

util.gracefully_shut_down(process, stopSync)

util.log_start(lock, net, coin)

if (!db.lib.is_locked([lock], net)) {
  db.lib.create_lock(lock, net)
  lockCreated = true

  util.init_db(net, function(status) {
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
              save_masternode(node, function(success) {
                if (success) {
                  // check if the script is stopping
                  if (stopSync) {
                    loop.break(true)
                  }
                  loop.next()
                } else {
                  console.log('Error: Cannot save Smartnode %s.', (isObject ? (body[objectKeys[i]].payee ? body[objectKeys[i]].payee : 'UNKNOWN') : (body[i].addr ? body[i].addr : 'UNKNOWN')))
                  util.exit_remove_lock(1, lock, net)
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
                  save_masternode(node, function(success) {
                    if (success) {
                      // check if the script is stopping
                      if (stopSync) {
                        loop.break(true)
                      }
                      loop.next()
                    } else {
                      console.log('Error: Cannot save Smartnode %s.', (isObject ? (body[objectKeys[i]].payee ? body[objectKeys[i]].payee : 'UNKNOWN') : (body[i].addr ? body[i].addr : 'UNKNOWN')))
                      util.exit_remove_lock(1, lock, net)
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
                util.exit_remove_lock(1, lock, net)
              } else {
                util.exit_remove_lock_completed(lock, coin, net)
              }
            })
          })
        }, net)
      } else {
        console.log('No Smartnodes found')
        util.exit_remove_lock(2, lock, net)
      }
    })
  })
}

function save_masternode(raw_masternode, cb, net=settings.getDefaultNet()) {
  // lookup masternode in local collection
  find_masternode((raw_masternode.proTxHash != null ? raw_masternode.proTxHash : raw_masternode.txhash), function (masternode) {
    // determine if the claim address feature is enabled
    if (settings.get(net, 'claim_address_page').enabled == true) {
      // claim address is enabled so lookup the address claim name
      db.get_address((raw_masternode.proTxHash != null ? raw_masternode.payee : raw_masternode.addr), function(address) {
        if (address) {
          // save claim name to masternode obejct
          raw_masternode.claim_name = address.name
        } else {
          // save blank claim name to masternode obejct
          raw_masternode.claim_name = ''
        }

        // add/update the masternode
        add_update_masternode(raw_masternode, (masternode == null), function(success) {
          return cb(success)
        }, net)
      }, net)
    } else {
      // claim address is disabled so add/update the masternode
      add_update_masternode(raw_masternode, (masternode == null), function(success) {
        return cb(success)
      }, net)
    }
  }, net)
}

function add_update_masternode(masternode, add, cb, net=settings.getDefaultNet()) {
  if (masternode.proTxHash == null && masternode.txhash == null) {
    console.log('Masternode update error: Tx Hash is missing')
    return cb(false)
  }
  if (add) {
    // Check if this older or newer Dash masternode format
    var dto = null
    if (masternode.proTxHash != null) {
      // This is the newer Dash format
      dto = MasternodeDb[net].create({
        txhash: masternode.proTxHash,
        status: masternode.status,
        addr: masternode.payee,
        lastpaid: masternode.lastpaidtime,
        ip_address: masternode.address,
        last_paid_block: masternode.lastpaidblock,
        lastseen: Math.floor(Date.now() / 1000),
        claim_name: (masternode.claim_name == null ? '' : masternode.claim_name),
        country: masternode.country,
        country_code: masternode.country_code
      }).then(() => {
        return cb(true)
      }).catch((err) => {
        console.error("Failed to insert masternode address '%s' for chain '%s': %s", masternode.address, net, err)
        return cb(false)
      })
    } else {
      // This is the older Dash format, or an unknown format
      dto = MasternodeDb[net].create({
        rank: masternode.rank,
        network: masternode.network,
        txhash: masternode.txhash,
        outidx: masternode.outidx,
        status: masternode.status,
        addr: masternode.addr,
        version: masternode.version,
        lastseen: masternode.lastseen,
        activetime: masternode.activetime,
        lastpaid: masternode.lastpaid,
        claim_name: (masternode.claim_name == null ? '' : masternode.claim_name),
        country: masternode.country,
        country_code: masternode.country_code
      }).then(() => {
        return cb(true)
      }).catch((err) => {
        console.error("Failed to insert masternode address '%s' for chain '%s': %s", masternode.address, net, err)
        return cb(false)
      })
    }
  } else {
    // update existing masternode in local collection
    MasternodeDb[net].updateOne({ txhash: (masternode.proTxHash != null ? masternode.proTxHash : masternode.txhash) }, masternode).then(() => {
      return cb(true)
    }).catch((err) => {
      console.error("Failed to update masternode address '%s' for chain '%s': %s", masternode.address, net, err)
      return cb(false)
    })
  }
}

function find_masternode(txhash, cb, net=settings.getDefaultNet()) {
  db.MasternodeDb[net].findOne({ txhash: txhash }).then((dto) => {
    if (dto)
      return cb(dto)
    else
      return cb(null)
  }).catch((err) => {
    console.error("Failed to find masternode hash '%s' for chain '%s': %s", txhash, net, err)
    return cb(null)
  })
}