const debug = require('debug')('debug')
const debugChart = require('debug')('chart')
const debugPeers = require('debug')('peers')
const express = require('express')
const session = require('express-session')
const path = require('path')
const nodeapi = require('./lib/nodeapi')
const favicon = require('serve-favicon')
const serveStatic = require('serve-static')
const logger = require('morgan')
const cookieParser = require('cookie-parser')
const bodyParser = require('body-parser')
const settings = require('./lib/settings')
const { Peers } = require('./lib/peers')
const routes = require('./routes/index')
const lib = require('./lib/x')
const db = require('./lib/database')
const util = require('./lib/functions/util')
const datautil = require('./lib/datautil')
const package_metadata = require('./package.json')
const locale = require('./lib/locale')
const app = express()
const wsInstance = require('express-ws') (app)
const apiAccessList = []
const { exec } = require('child_process')
const networks = settings.getAllNet()
const request = require('postman-request')
const base_server = 'http://127.0.0.1:' + settings.webserver.port + "/"
const base_url = base_server + '' // api/
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const TTLCache = require('@isaacs/ttlcache')
const cache = settings.cache

const assetutil = require('./lib/functions/assetutil')

// Application caches.
const foreverCache        = new TTLCache({ max: 10,                       ttl: Infinity,                        updateAgeOnGet: false, noUpdateTTL: false })
const tickerCache         = new TTLCache({ max: cache.ticker.size,        ttl: 1000 * cache.ticker.ttl,         updateAgeOnGet: false, noUpdateTTL: false })
const xpeersCache         = new TTLCache({ max: cache.xpeers.size,        ttl: 1000 * cache.xpeers.ttl,         updateAgeOnGet: false, noUpdateTTL: false })
const assetsCache         = new TTLCache({ max: cache.assets.size,        ttl: 1000 * cache.assets.ttl,         updateAgeOnGet: false, noUpdateTTL: false })
const assetCache          = new TTLCache({ max: cache.asset.size,         ttl: 1000 * cache.asset.ttl,          updateAgeOnGet: false, noUpdateTTL: false })

const METHOD_DISABLED = 'This method is disabled'
const BLOCK_NOT_FOUND = 'Block not found'
const BLOCK_HEIGHT_MUST_BE_A_NUMBER = 'Block height must be a number.'

// Pass wallet rpc connections info to nodeapi.
nodeapi.setWalletDetails(settings.wallets)

// Dynamically build the nodeapi cmd access list by adding all non-blockchain-specific api cmds that have a value.
networks.forEach( function(item, index) {
  const api_cmds = settings.get(item, 'api_cmds')
  Object.keys(api_cmds).forEach(function(key, index, map) {
    if (key != 'use_rpc' && api_cmds[key] != null && api_cmds[key] != '')
      apiAccessList.push(item + "@" + key)
  })
})

var loginEnabled = false
networks.forEach( function(net, index) {
  if (settings.get(net, 'login_page').enabled) {
    loginEnabled = true
  }
})

// Allow user sessions if login is enabled.
if (loginEnabled == true) {
  app.use(session({
    secret: 'secret-key',
    resave: false,
    saveUninitialized: false
  }))
}

// An upstream peer (client) connects to us (we are the server) - 1.
wsInstance.getWss().on('connection', (obj) => {
  const clientsSet = wsInstance.getWss().clients
  const clientsValues = clientsSet.values()
  for(let i=0; i < clientsSet.size; i++) {
    if (debugPeers.enabled) {
      debugPeers("*** " + (i + 1) + "/" + clientsSet.size + " ***")
      debugPeers("Connected upstream peer %o.", clientsValues.next().value._sender._socket._peername)
    }
  }
})

// Dynamically find and add additional blockchain_specific api cmds.
Object.keys(settings.blockchain_specific).forEach(function(key, index, map) {
  // check if this feature is enabled and has api cmds
  if (settings.blockchain_specific[key].enabled == true && Object.keys(settings.blockchain_specific[key]).indexOf('api_cmds') > -1) {
    // add all blockchain specific api cmds that have a value
    Object.keys(settings.blockchain_specific[key]['api_cmds']).forEach(function(key2, index, map) {
      if (settings.blockchain_specific[key]['api_cmds'][key2] != null && settings.blockchain_specific[key]['api_cmds'][key2] != '')
        apiAccessList.push(key2)
    })
  }
})
// Whitelist the cmds in the nodeapi access list.
nodeapi.setAccess('only', apiAccessList)

// Determine if cors should be enabled.
if (settings.webserver.cors.enabled == true) {
  app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", settings.webserver.cors.corsorigin);
    res.header('Access-Control-Allow-Methods', 'DELETE, PUT, GET, POST');
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
  });
}

// View engine setup.
app.set('views', path.join(__dirname, 'views'))
app.set('view engine', 'pug')

// Security.
app.disable('x-powered-by')

function setCustomCacheControl (res, path) {
  if (serveStatic.mime.lookup(path) === 'text/html') {
    // Cache HTML files.
    res.setHeader('Cache-Control', 'public, max-age=30')
  }
}

// Always use main coin favicon.
app.use(favicon(path.join('./public', settings.shared_pages.favicons.favicon32)))
app.use(serveStatic(path.join(__dirname, 'public'), {
  maxAge: '1d',
  setHeaders: setCustomCacheControl
}))
app.use(logger('dev'))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(cookieParser())
app.use(express.static(path.join(__dirname, 'public')))

/* RPC APIs by DB / cache */

app.use('/api/getblockchaininfo/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  stats(res, net, api_page, api_page.public_apis.rpc.getblockchaininfo.enabled, function (stats) {
    const chain = settings.getWallet(net).chain
    const algos = settings.get(net, 'algos')
    const r = {}

    if (stats.coin)
      r.coin = stats.coin

    r.chain = chain ? chain : 'n/a'
    r.blocks = !isNaN(stats.last) ? stats.last : 'n/a'
    r.headers = !isNaN(stats.count) ? stats.count : 'n/a'
    r.addresses = !isNaN(stats.addresses) ? stats.addresses : 'n/a'
    r.txes = !isNaN(stats.count_txes) ? stats.count_txes : 'n/a'
    r.utxos = !isNaN(stats.count_utxos) ? stats.count_utxos : 'n/a'

    r.bestblockhash = stats.bestblockhash

    if (algos.length > 1)
      r.pow_algo_id = !isNaN(stats.pow_algo_id) ? stats.pow_algo_id : 'n/a'

    r.pow_algo = stats.pow_algo ? stats.pow_algo : 'n/a'

    r.difficulty = stats && !isNaN(stats.difficulty) ? stats.difficulty : -1
    if (algos.length > 1)
      algos.forEach((algo) => {
        if (!isNaN(stats['difficulty_' + algo.algo]))
          r['difficulty_' + algo.algo] = stats['difficulty_' + algo.algo]
      })

    r.hashps = stats && !isNaN(stats.nethash) ? stats.nethash : -1
    if (algos.length > 1)
      algos.forEach((algo) => {
        if (!isNaN(stats['nethash_' + algo.algo]))
          r['nethash_' + algo.algo] = stats['nethash_' + algo.algo]
      })

    r.mediantime = !isNaN(stats.mediantime) ? stats.mediantime : 'n/a'
    r.verificationprogress = !isNaN(stats.verificationprogress) ? stats.verificationprogress : 'n/a'
    r.initialblockdownload = stats.initialblockdownload ? stats.initialblockdownload : 'n/a'
    r.chainwork = stats.chainwork ? stats.chainwork : 'n/a'
    r.size_on_disk = !isNaN(stats.size_on_disk) ? stats.size_on_disk : 'n/a'
    r.pruned = stats.pruned !== null ? stats.pruned : 'n/a'
    r.supply = !isNaN(stats.supply) ? stats.supply : 'n/a'
    if (!isNaN(stats.smartnodes_total))
      r.smartnodes_total = stats.smartnodes_total
    if (!isNaN(stats.smartnodes_enabled))
      r.smartnodes_enabled = stats.smartnodes_enabled
    return r
  })
})

app.use('/api/getmininginfo/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  stats(res, net, api_page, api_page.public_apis.rpc.getmininginfo.enabled, function (stats) {
    const isMultiAlgo = settings.isMultiAlgo(net)
    const chain = settings.getWallet(net).chain
    const algos = settings.get(net, 'algos')
    const r = {}

    if (stats.coin)
      r.coin = stats.coin
    r.chain = chain ? chain : 'n/a'
    r.blocks = !isNaN(stats.last) ? stats.last : 'n/a'
    r.headers = !isNaN(stats.count) ? stats.count : 'n/a'
    
    if (isMultiAlgo) {
      r.pow_algo_id = !isNaN(stats.pow_algo_id) ? stats.pow_algo_id : 'n/a'
      r.pow_algo = stats.pow_algo ? stats.pow_algo : 'n/a'
    }
    
    r.difficulty = stats && !isNaN(stats.difficulty) ? stats.difficulty : -1
    algos.forEach((algo) => {
      if (!isNaN(stats['difficulty_' + algo.algo]))
        r['difficulty_' + algo.algo] = stats['difficulty_' + algo.algo]
    })

    r.errors = ''

    r.hashps = stats && !isNaN(stats.nethash) ? stats.nethash : -1
    algos.forEach((algo) => {
      if (!isNaN(stats['nethash_' + algo.algo]))
        r['nethash_' + algo.algo] = stats['nethash_' + algo.algo]
    })

    r.hashespersec = stats && !isNaN(stats.hashespersec) ? stats.hashespersec : 'n/a'

    r.algos = settings.get(net, 'algos')
    r.pooledtx = !isNaN(stats.pooledtx) ? stats.pooledtx : 'n/a'
    return r
  })
})

app.use('/api/getdifficulty/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  stats(res, net, api_page, api_page.public_apis.rpc.getdifficulty.enabled, function (stats) {
    const algos = settings.get(net, 'algos')
    const r = {}
    r.height = stats && !isNaN(stats.count) ? stats.count : -1
    r.difficulty = stats && !isNaN(stats.difficulty) ? stats.difficulty : -1
    algos.forEach((algo) => {
      if (!isNaN(stats['difficulty_' + algo.algo]))
        r['difficulty_' + algo.algo] = stats['difficulty_' + algo.algo]
    })
    return r
  })
})

app.use('/api/getconnectioncount/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  stats(res, net, api_page, api_page.public_apis.rpc.getconnectioncount.enabled, function (stats) {
    return stats && stats.connections ? stats.connections.toString() : '0'
  })
})

app.use('/api/getblockcount/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  stats(res, net, api_page, api_page.public_apis.rpc.getblockcount.enabled, function (stats) {
    return stats && stats.count ? stats.count.toString() : '0'
  })
})

app.use('/api/getblockhash/:height/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const height = req.params['height']
  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true && api_page.public_apis.rpc.getblockhash.enabled == true) {
    if (isNaN(height)) {
      res.end(BLOCK_HEIGHT_MUST_BE_A_NUMBER)
    } else {
      db.get_block_by_height(height, function(block) {
        if (block) {
          res.send(block.hash)
        } else {
          res.end(BLOCK_NOT_FOUND)
        }
      }, net)
    }
  } else {
    res.end(METHOD_DISABLED)
  }
})

app.use('/api/getblock/:hash/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const hash = req.params['hash']
  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true && api_page.public_apis.rpc.getblock.enabled == true) {
    db.get_block_by_hash(hash, function(block) {
      if (block) {
        res.send(block)
      } else {
        res.end("Block not found")
      }
    }, net)
  } else {
    res.end(METHOD_DISABLED)
  }
})

// TODO: API: Fix getrawtransaction (comes from deamon -> nodeapi.js)

// app.use('/api/getrawtransaction/:hash/:net?', function(req, res) {
//   const net = settings.getNet(req.params['net'])
//   const hash = req.params['hash']
//   const api_page = settings.get(net, 'api_page')
//   if (api_page.enabled == true && api_page.public_apis.rpc.getrawtransaction.enabled == true) {
//     db.find_tx(hash, function(tx) {
//       if (tx) {
//         console.log('Tx %s is in DB.', hash)
//         res.send(tx)
//       } else {
//         res.end("Tx not found")
//       }
//     }, net)
//   } else {
//     res.end(METHOD_DISABLED)
//   }
// })

app.use('/api/getnetworkhashps/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  stats(res, net, api_page, api_page.public_apis.rpc.getnetworkhashps.enabled, function (stats) {
    const algos = settings.get(net, 'algos')
    if (algos.length == 1) {
      return stats && !isNaN(stats.nethash) ? stats.nethash.toString() : '-1'
    } else {
      const r = {}
      algos.forEach((algo) => {
        if (!isNaN(stats['nethash_' + algo.algo]))
          r[algo.algo] = stats['nethash_' + algo.algo]
      })
      return r
    }
  })
})

app.use('/api/getmasternodecount/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  stats(res, net, api_page, api_page.public_apis.rpc.getmasternodecount.enabled, function (stats) {
    const total = !isNaN(stats.smartnodes_total) ? stats.smartnodes_total : -1
    const enabled = !isNaN(stats.smartnodes_enabled) ? stats.smartnodes_enabled : -1
    const r = {}
    r.total = total
    r.enabled = enabled
    res.send(r)
  })
})

// TODO: Peers: Impl. verifymessage
// TODO: Peers: Impl. validateaddress

app.use('/api/getgovernanceinfo/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  stats(res, net, api_page, api_page.public_apis.rpc.getgovernanceinfo.enabled, function (stats) {
    const chain = settings.getWallet(net).chain
    const r = {}

    if (stats.coin)
      r.coin = stats.coin
    r.chain = chain ? chain : 'n/a'

    r.governanceminquorum = !isNaN(stats.governanceminquorum) ? stats.governanceminquorum : 'n/a'
    r.proposalfee = !isNaN(stats.proposalfee) ? stats.proposalfee : 'n/a'
    r.superblockcycle = !isNaN(stats.superblockcycle) ? stats.superblockcycle : 'n/a'
    r.lastsuperblock = !isNaN(stats.lastsuperblock) ? stats.lastsuperblock : 'n/a'
    r.nextsuperblock = !isNaN(stats.nextsuperblock) ? stats.nextsuperblock : 'n/a'

    return r
  })
})

/* Asset APIs by DB / cache */

app.use('/api/asset/:name/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const name = req.params['name'].replace('+', '/')
  const api_page = settings.get(net, 'api_page')
  const ckey = net + '---' + name
  if (api_page.enabled == true && api_page.public_apis.db.asset.enabled == true) {
    var r = assetCache.get(ckey)
    if (r == undefined) {
      db.get_asset_by_name_local(name, function (asset) {
        if (asset) {
          assetCache.set(ckey, asset)
          if (debug.enabled) 
            debug("Cached asset '%s' %o - mem: %o", net, asset, util.memoryUsage(process))
          res.send(asset)
        } else {
          res.send("Asset with name '" + name + "' not found.")
        }
      }, net)
    } else {
      if (debug.enabled) 
        debug("Get asset by cache '%s' %o ...", net, r)
      res.send(r)
    }
  } else {
    res.end(METHOD_DISABLED)    
  }
})

app.use('/api/assets/:net/:start?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const start = req.params['start']
  
  // req.url.split contains a list of params after ':start?', i.e. length/mintxes/sortby...
  var split = []
  if (!isNaN(start)) {
    split = req.url.replace('/','').split('/')
  }
  var length = 100000
  if (split.length > 0 && !isNaN(split[0])) {
    length = Number(split[0])
  }

  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true && api_page.public_apis.db.assets.enabled == true) {
    const coin = settings.getCoin(net)
    db.get_dbindex(coin.name, function (dbindex) {
      db.get_assets_local(start, length, function (assets) {
        const rows = []
        if (assets) {
          for (i = 0; i < assets.length; i++) {
            const row = {}
            row.name = assets[i].name
            row.height = assets[i].height
            row.amount = assets[i].amount
            row.units = assets[i].units
            row.balance = assets[i].balance
            row.tx_count = assets[i].tx_count
            row.ipfs_hash = assets[i].ipfs_hash
            rows.push(row)
          }
        }
        res.json({"data": rows, "recordsTotal": dbindex.count_assets, "recordsFiltered": dbindex.count_assets})
      }, net)
    }, net)
  } else {
    res.end(METHOD_DISABLED)
  }
})

function stats(res, net, api_page, fenabled, cb) {
  if (api_page.enabled == true && fenabled == true) {
    const coin = settings.getCoin(net)
    const r = db.statsCache.get(net)
    if (r == undefined) {
      db.get_stats(coin.name, function (stats) {
        db.statsCache.set(net, stats)
        debug("Cached stats '%s' %o - mem: %o", net, stats, util.memoryUsage(process))
        // res.setHeader('content-type', 'text/plain')
        res.send(cb(stats))
      }, net)
    } else {
      debug("Get stats by cache '%s' %o ...", net, r)
      // res.setHeader('content-type', 'text/plain')
      res.send(cb(r))
    }
  } else
    res.end(METHOD_DISABLED)
}

// routes
app.use('/api', nodeapi.app);
// app.use('/:net?', routes);
app.use('/', routes);

app.post('/register/:net?', async (req, res) => {
  const net = settings.getNet(req.params['net'])
  try {
    const { uuid, address, signature, pwd, repeatpwd } = req.body
    
    if (address == null || address.trim().length == 0) {
      res.json({ error: true, message: 'Address is missing.' })
      return
    }
    if (net == null || net.trim().length == 0) {
      res.json({ error: true, message: 'Net is missing.' })
      return
    }
    if (signature == null || signature.trim().length == 0) {
      res.json({ error: true, message: 'Signature is missing.' })
      return
    }
    if (pwd == null || pwd.trim().length == 0) {
      res.json({ error: true, message: 'Password is missing.' })
      return
    }
    if (repeatpwd == null || repeatpwd.trim().length == 0) {
      res.json({ error: true, message: 'Repeat Password is missing.' })
      return
    }
    if (pwd != repeatpwd) {
      res.json({ error: true, message: 'Repeat Password does not match.1' })
      return 
    }

    debug("Try to register user '%s', uuid '%s', signature '%s', pwd '%s', repeat '%s'.", uuid, address, signature, pwd, repeatpwd)
    
    const existingUser = await db.UsersDb[net].findOne({ address })
    if (existingUser) {
      res.json({ error: true, message: "User '" + address + "' already registered." })
      return
    }

    lib.validate_address(net, address, function(address_validation) {
      if (address_validation && address_validation.isvalid && address_validation.isvalid == true) {
        
        db.get_address(address, function(addressobj) {
          if (addressobj) {
            const min_balance = settings.get(net, 'registration_page').min_balance_for_registration
            const balance = addressobj.balance / 100000000
            debug("Got balance %d (min %d) for address '%s' and net '%s' - mem: %o", balance, min_balance, address, net, util.memoryUsage(process))
            
            if (balance == null || isNaN(balance) || (min_balance > 0 && balance < min_balance)) {
              res.json({ status: 'failed', error: true, message: 'Insufficient funds.' })
              return
            }
            lib.verify_message(net, address, signature, uuid, function(body) {
              if (body == true) {
                const salt = bcrypt.genSaltSync(10)
                const hashedPassword = bcrypt.hashSync(pwd, salt)
                db.create_user_local(uuid, address, hashedPassword, salt, balance, function(user) {
                  if (user) {
                    res.status(201).json({ status: 'success', message: 'User registered successfully.' })
                  } else {
                    res.json({ status: 'failed', error: true, message: 'Internal Server Error' })
                  }
                }, net)
              } else {
                return res.json({ status: 'failed', error: true, message: 'Signature verification failed.' })
              }
            })
            // res.setHeader('content-type', 'text/plain')
            // res.end((addressobj.balance / 100000000).toString().replace(/(^-+)/mg, ''))
          } else
            res.json({ status: 'failed', error: true, message: 'address not found.', hash: address, coin: coin, net: net })
        }, net)
      } else {
        res.json({ status: 'failed', error: true, message: 'Address is not valid.' })
      }
    })
  } catch (error) {
    console.error('Error registering user:', error)
    res.json({ status: 'failed', error: true, message: 'An error occurred while registering the user' + error })
  }
})

app.post('/login/:net?', async (req, res) => {
  const net = settings.getNet(req.params['net'])
  try {
    const { address, pwd } = req.body

    if (address == null || address.trim().length == 0) {
      res.json({ error: true, message: 'Address is missing.' })
      return
    }
    if (net == null || net.trim().length == 0) {
      res.json({ error: true, message: 'Net is missing.' })
      return
    }
    if (pwd == null || pwd.trim().length == 0) {
      res.json({ error: true, message: 'Password is missing.' })
      return
    }

    const user = await db.UsersDb[net].findOne({ address })
    if (!user) {
      res.json({ error: true, message: 'Invalid address or password.' })
      return
    }
    
    const hashedPassword = bcrypt.hashSync(pwd, user.salt)
    if (user.pwd === hashedPassword) {
      const token = jwt.sign({ userId: user._id }, 'secretKey')

      req.session.isLoggedIn = true
      req.session.username = address
      req.session.apiKey = user.apiKey

      debug("Logged in user '%s' for net '%s', session ID '%s'.", address, net, req.session.id)

      // TODO: User: Fix login redirect
      // res.redirect('/user/' + net + '/' + address)

      res.status(200).json({ error: false, status: 'success', token: token, message: 'User ' + address + ' logged in.'})
    } else {
      res.json({ error: true, message: 'Invalid address or password.' })
    }
  } catch (error) {
    console.error('Error logging in:', error)
    res.json({ error: true, message: 'An error occurred while logging in.' })
  }
})

// post method to claim an address using verifymessage functionality
app.post('/claim/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])

  var message = null
  if (settings.get(net, 'claim_address_page').enable_bad_word_filter == true) {
    const bad_word_lib = require('bad-words')
    const bad_word_filter = new bad_word_lib()
    // clean the message (Display name) of bad words
    message = (req.body.message == null || req.body.message == '' ? '' : bad_word_filter.clean(req.body.message))
  } else {
    message = (req.body.message == null || req.body.message == '' ? '' : req.body.message);
  }

  // check if the message was filtered
  if (message == req.body.message) {
    // call the verifymessage api
    lib.verify_message(net, req.body.address, req.body.signature, req.body.message, function(body) {
      if (body == false)
        res.json({status: 'failed', error: true, message: 'Invalid signature'})
      else if (body == true) {
        db.update_label(req.body.address, req.body.message, function(val) {
          // check if the update was successful
          if (val == '')
            res.json({status: 'success'})
          else if (val == 'no_address')
            res.json({status: 'failed', error: true, message: 'Wallet address ' + req.body.address + ' is not valid or does not have any transactions'})
          else
            res.json({status: 'failed', error: true, message: 'Wallet address or signature is invalid'})
        }, net)
      } else
        res.json({status: 'failed', error: true, message: 'Wallet address or signature is invalid'})
    })
  } else {
    // message was filtered which would change the signature
    res.json({status: 'failed', error: true, message: 'Display name contains bad words and cannot be saved: ' + message})
  }
})

/* Extended APIs by DB / cache */

app.use('/ext/getmoneysupply/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  stats(res, net, api_page, api_page.public_apis.ext.getmoneysupply.enabled, function (stats) {
    return stats && stats.supply ? stats.supply.toString() : '0'
  })
  return -1
})

app.use('/ext/getaddress/:hash/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true && api_page.public_apis.ext.getaddress.enabled == true) {
    db.get_address(req.params.hash, function(address) {
      db.get_address_txs(req.params.hash, 0, api_page.public_apis.ext.getaddresstxs.max_items_per_query, function(obj) {
        if (address) {
          const txs = obj.data
          var last_txs = []

          for (i = 0; i < txs.length; i++) {
            if (typeof txs[i].txid !== "undefined") {
              var out = 0,
                  vin = 0,
                  tx_type = 'vout',
                  row = {}

              txs[i].vout.forEach(function (r) {
                if (r.addresses == req.params.hash)
                  out += r.amount
              })

              txs[i].vin.forEach(function (s) {
                if (s.addresses == req.params.hash)
                  vin += s.amount
              })

              if (vin > out)
                tx_type = 'vin'

              row['addresses'] = txs[i].txid
              row['type'] = tx_type
              last_txs.push(row)
            }
          }

          var a_ext = {
            address: address.a_id,
            sent: (address.sent / 100000000),
            received: (address.received / 100000000),
            balance: (address.balance / 100000000).toString().replace(/(^-+)/mg, ''),
            last_txs: last_txs,
            coin: coin,
            net: net,
            assets : address.assets
          }

          res.send(a_ext)
        } else
          res.send({ error: 'address not found.', hash: req.params.hash, coin: coin, net: net})
      }, net)
    }, net)
  } else
    res.end(METHOD_DISABLED)
})

app.use('/ext/gettx/:txid/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true && api_page.public_apis.ext.gettx.enabled == true) {
    var txid = req.params.txid

    db.get_tx(txid, function(tx) {
      const shared_pages = settings.get(net, 'shared_pages')
      if (tx && tx != null) {
        db.get_stats(coin.name, function (stats) {
          res.send({ active: 'tx', tx: tx, confirmations: shared_pages.confirmations, blockcount: (stats && !isNaN(stats.count) ? stats.count : 0), coin: coin, net: net})
        }, net)
      } else
        res.send({ error: 'tx not found.', hash: txid, coin: coin, net: net})
    }, net)
  } else
    res.end(METHOD_DISABLED)
})

app.use('/ext/getbalance/:hash/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true && api_page.public_apis.ext.getbalance.enabled == true) {
    const hash = req.params.hash
    const coin = settings.getCoin(net)
    db.get_address(hash, function(address) {
      if (address) {
        debug("Got balance '%s' '%s' %o - mem: %o", net, hash, address.balance, util.memoryUsage(process))
        res.setHeader('content-type', 'text/plain')
        res.end((address.balance / 100000000).toString().replace(/(^-+)/mg, ''))
      } else
        res.send({ error: 'address not found.', hash: hash, coin: coin, net: net })
    }, net)
  } else
    res.end(METHOD_DISABLED)
})

app.use('/ext/getdistribution/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true && api_page.public_apis.ext.getdistribution.enabled == true) {
    const coin = settings.getCoin(net)
    db.get_richlist(coin.name, function(richlist) {
      db.get_stats(coin.name, function(stats) {
        datautil.get_distribution(settings, lib, richlist, stats, function(dist) {
          debug("Got distribution '%s' %o - mem: %o", net, dist, util.memoryUsage(process))
          res.send(dist)
        }, net)
      }, net)
    }, net)
  } else {
    res.end(METHOD_DISABLED)
  }
})

app.use('/ext/getcurrentprice/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true && api_page.public_apis.ext.getcurrentprice.enabled == true) {
    const defaultExchangeCurrencyPrefix = settings.get(net, 'markets_page').default_exchange.trading_pair.split('/')[1].toLowerCase()
    db.get_stats(coin.name, function (stats) {
      r = {}
      r.last_updated=new Date().toUTCString().replace('GMT', 'UTC')
      r.rates = []
      ratesPush(r.rates, settings.currencies, 'USD', stats.last_usd_price)
      ratesPush(r.rates, settings.currencies, 'USDT', stats.last_price)
      lib.get_exchange_rates(function(error, data) {
        if (error) {
          console.log(error)
        } else if (data == null || typeof data != 'object') {
          console.log('Error: exchange rates api did not return a valid object')
        } else {
          for (var item in settings.currencies) {
            if (data.rates && data.rates[item] && item.toLowerCase() != defaultExchangeCurrencyPrefix && item.toLowerCase() != 'usd') {
              ratesPush(r.rates, settings.currencies, item, Number.parseFloat(stats.last_usd_price) * Number.parseFloat(data.rates[item]))
            }
          }
          debug("Get prices by cache '%s' %o ...", net, r.last_updated)
          res.send(r)
        }
      })
    }, net)
  } else {
    res.end(METHOD_DISABLED)
  }
})

function ratesPush(rates, currencies, item, price) {
  rates.push({
    "code": currencies[item].code,
    "symbol": currencies[item].symbol,
    "rate": price,
    "name": currencies[item].name,
  })
}

app.use('/ext/getbasicstats/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true && api_page.public_apis.ext.getbasicstats.enabled == true) {
    const coin = settings.getCoin(net)
    const r = db.statsCache.get(net)
    if (r == undefined) {
      db.get_stats(coin.name, function (stats) {
        if (stats) {
          const s = {}
          if (!isNaN(stats.count))
            s.block_count = stats.count
          if (!isNaN(stats.supply))
            s.money_supply = stats.supply
          if (!isNaN(stats.count))
            s.block_count = stats.count
          if (!isNaN(stats.smartnodes_enabled)) 
            s.masternode_enabled = stats.smartnodes_enabled
          if (!isNaN(stats.smartnodes_total)) 
            s.masternode_count = stats.smartnodes_total
          if (!isNaN(stats.last_usd_price)) 
            s.last_price_usd = stats.last_usd_price,

          // eval('var p_ext = {  "last_price_' + markets_page.default_exchange.trading_pair.split('/')[1].toLowerCase() + '":   }')
          db.statsCache.set(net, s)
          debug("Cached coin stats '%s' %o - mem: %o", net, s, util.memoryUsage(process))
          res.send(s)
        } else 
          res.end(METHOD_DISABLED)
      }, net)
    } else {
      debug("Get coin stats by cache '%s' %o ...", net, r.block_count)
      res.send(r)
    }
  } else
    res.end(METHOD_DISABLED)
})

app.use('/ext/getticker/:mode/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const api_page = settings.get(net, 'api_page')
  const algos = settings.algos
  if (api_page.enabled == true && api_page.public_apis.ext.getticker.enabled == true) {
    if (settings.cache.enabled == true) {
      var r = tickerCache.get(net)
      if (r == undefined) {
        db.get_stats(coin.name, function (stats) {
          db.get_markets_summary(function(marketdata) {
            var markets = marketdata;
            if (typeof markets === 'string') {
              console.warn(markets)
              markets = []
            }
            request({uri: base_url + 'ext/getcurrentprice/' + net, json: true}, function (error, response, ratesdata) {
              var rates = ratesdata;
              if (typeof rates === 'string') {
                console.warn(rates)
                rates = []
              }
              request({uri: base_url + 'ext/getdistribution/' + net, json: true}, function (error, response, ddata) {
                var distribution = ddata;
                if (typeof distribution === 'string') {
                  console.warn(distribution)
                  distribution = {}
                }
                
                if (stats) {
                  for (i = 0; i < algos.length; i++) {
                    const algo = algos[i].algo.toLowerCase()
                    if ((!isNaN(stats['nethash_' + algo]))) {
                      algos[i].hashps = stats['nethash_' + algo]
                      algos[i].diff = stats['difficulty_' + algo]
                    }
                  }
                }

                const r = {}
                // r.rank = 1234
                r.coin = coin.name
                r.code = coin.symbol
                r.last_updated=new Date().toUTCString().replace('GMT', 'UTC')
                r.tip = stats.count
                r.supply = stats.supply
                r.supply_max = 21000000000
                r.price = stats.last_price
                r.price_usd = stats.last_usd_price
                r.txes = stats.count_txes
                r.markets = markets
                r.rates = rates;
                r.node_collateral = 25000000
                r.node_count = stats.smartnodes_total
                r.node_active = stats.smartnodes_enabled
                r.distribution = distribution
                r.pools = ["crimson-pool.com","cryptoverse.eu","kriptokyng.com","mecrypto.club","mining4people.com","mypool.sytes.net","suprnova.cc","zergpool.com","zpool.ca"]
                r.algos = algos
                tickerCache.set (net, r)
                debug("Got ticker '%s' '%s' %o - mem: %o", r.coin, net, r, util.memoryUsage(process))
                res.send(r)
                  
              })
            })
          }, net)
        }, net)
      } else {
        debug("Get ticker by ćache '%s' '%s' % ...", r.coin, net, r.last_updated)
        res.send(r)
      }
    } else {
      res.end('This method is available only with caching enabled.')
    }
  } else
    res.end(METHOD_DISABLED)
})

app.use('/ext/getmarkets/:mode/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true && api_page.public_apis.ext.getmarkets.enabled == true) {
    if (req.params.mode == 'summary') {
      db.get_markets_summary(function(data) {
      var markets = data;
      if (typeof markets === 'string') {
        console.warn(markets);
        res.end(markets);
      }
      var r = {}
      r.last_updated=new Date().toUTCString().replace('GMT', 'UTC')
      r.markets = markets;
      res.send(r);
      }, net);
    } else if (req.params.mode == 'full') {
      db.get_markets(function(data) {
      var markets = data;
      if (typeof markets === 'string') {
        console.warn(markets);
        res.end(markets);
      }
      var r = {}
      r.last_updated=new Date().toUTCString().replace('GMT', 'UTC')
      r.markets = markets;
      res.send(r);
      }, net);
    } else {
      res.end('Invalid mode: use summary or full.');
    }
  } else {
    res.end(METHOD_DISABLED);
  }
});

function isInternalRequest(req) {
  // TODO: Sec: Find secure asymmetric solution for internal request.
  return req.headers['x-requested-with'] != null 
    && req.headers['x-requested-with'].toLowerCase() == 'xmlhttprequest' 
    && req.headers.referer != null 
    && req.headers.accept.indexOf('text/javascript') > -1 
    && req.headers.accept.indexOf('application/json') > -1
}

app.use('/ext/getlasttxs/:net/:min', function(req, res) {
  // TODO: Cache: Latest tx.
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  if ((api_page.enabled == true && api_page.public_apis.ext.getlasttxs.enabled == true) || isInternalRequest(req)) {
    var min = req.params.min, start, length

    // split url suffix by forward slash and remove blank entries
    var type = req.params['type'] ? req.params['type'] : -1
    var split = req.url.split('/').filter(function(v) { return v; })
    // determine how many parameters were passed
    switch (split.length) {
      case 2:
        // capture start and length
        start = split[0]
        length = split[1]
        break;
      default:
        if (split.length == 1) {
          // capture start
          start = split[0]
        } else if (split.length >= 3) {
          type = split[2]
        } else if (split.length >= 2) {
          // capture start and length
          start = split[0]
          length = split[1]
        }
        break
    }

    if (typeof length === 'undefined' || isNaN(length) || length < 1 || length > api_page.public_apis.ext.getlasttxs.max_items_per_query)
      length = api_page.public_apis.ext.getlasttxs.max_items_per_query;
    if (typeof start === 'undefined' || isNaN(start) || start < 0)
      start = 0;
    if (typeof min === 'undefined' || isNaN(min) || min < 0)
      min  = 0;
    else
      min  = (min * 100000000);

    db.get_last_txs(start, length, min, type, function(data, count) {
      const rows = []
      for (i = 0; i < data.length; i++) {
        const row = []
        row.push(data[i].blockindex)
        row.push(data[i].blockhash)
        row.push(data[i].txid)
        row.push(data[i].type)
        row.push(data[i].recipients)
        row.push(data[i].amount)
        row.push(data[i].timestamp)
        rows.push(row)
      }
      res.json({"data": rows, "recordsTotal": count, "recordsFiltered": count})
    }, net)
  } else
    res.end(METHOD_DISABLED);
})

app.use('/ext/getaddresstxs/:address/:net/:start/:length', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  if ((api_page.enabled == true && api_page.public_apis.ext.getaddresstxs.enabled == true) || isInternalRequest(req)) {
    var internal = false;
    // split url suffix by forward slash and remove blank entries
    var split = req.url.split('/').filter(function(v) { return v; });
    // check if this is an internal request
    if (split.length > 0 && split[0] == 'internal')
      internal = true;

    // fix parameters
    const max = api_page.public_apis.ext.getaddresstxs.max_items_per_query
    var min = min
    var start = req.params.start
    var length = req.params.length
    if (typeof length === 'undefined' || isNaN(length) || length < 1 || length > max)
      length = max
    if (typeof start === 'undefined' || isNaN(start) || start < 0)
      start = 0;
    if (typeof min === 'undefined' || isNaN(min) || min < 0)
      min = 0;
    else
      min  = (min * 100000000);

    debug("getaddresstx for chain '%s': min=%d, start=%d, length=%d", net, min, start, length)

    db.get_address_txs(req.params.address, start, length, function(obj) {
      // TODO: Peers: Fix balance is null with upstream peer.
      const tx_types = settings.get(net, 'tx_types')
      const txs = obj.data
      var data = [];

      for (i = 0; i < txs.length; i++) {
        if (typeof txs[i].txid !== "undefined") {
          var out = 0
          var vin = 0

          txs[i].vout.forEach(function(r) {
            if (r.addresses == req.params.address)
              out += r.amount
          })

          txs[i].vin.forEach(function(s) {
            if (s.addresses == req.params.address)
              vin += s.amount
          })

          const row = []
          row.push(txs[i].timestamp)
          row.push(txs[i].txid)
          row.push(tx_types[txs[i].tx_type])
          row.push(Number(out / 100000000))
          row.push(Number(vin / 100000000))
          row.push(Number(txs[i].balance / 100000000))
          row.push(txs[i])
          data.push(row)
        }
      }

      res.json({"data": data, "recordsTotal": obj.recordsTotal, "recordsFiltered": obj.recordsFiltered })
    }, net)
  } else
    res.end(METHOD_DISABLED)
})

app.use('/ext/getsummary/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  if ((api_page.enabled == true && api_page.public_apis.ext.getsummary.enabled == true) || isInternalRequest(req)) {
    const coin = settings.getCoin(net)
    const r = {}
    db.get_stats(coin.name, function (stats) {
      const algos = settings.get(net, 'algos')
      if (!isNaN(stats.count)) 
        r.blockcount = stats.count
      if (!isNaN(stats.connections)) 
        r.connections = stats.connections
      if (!isNaN(stats.smartnodes_enabled)) 
        r.masternodeCountOnline = stats.smartnodes_enabled
      if (!isNaN(stats.smartnodes_total) && !isNaN(stats.smartnodes_enabled)) 
        r.masternodeCountOffline = stats.smartnodes_total - stats.smartnodes_enabled
      if (!isNaN(stats.supply)) 
        r.supply = stats.supply
      else 
        r.supply = 0
      if (!isNaN(stats.last_price))
        r.lastPrice = stats.last_price
      else {
        r.lastPrice = 0
      }

      if (!isNaN(stats.nethash))
        r.hashrate = stats.nethash

      algos.forEach((algo) => {
        if (!isNaN(stats['nethash_' + algo.algo]))
          r['hashrate_' + algo.algo] = stats['nethash_' + algo.algo]
      })

      if (!isNaN(stats.difficulty))
        r.difficulty = stats.difficulty
      else
        r.difficulty = stats.difficulty_ghostrider

      algos.forEach((algo) => {
        if (!isNaN(stats['difficulty_' + algo.algo]))
          r['difficulty_' + algo.algo] = stats['difficulty_' + algo.algo]
      })

      debug("Got summary '%s' %o - mem: %o", net, r, util.memoryUsage(process))
      res.send(r)
    }, net)
  } else
    res.end(METHOD_DISABLED)
})

app.use('/ext/getnetworkpeers/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  if ((api_page.enabled == true && api_page.public_apis.ext.getnetworkpeers.enabled == true) || isInternalRequest(req)) {
    const r = db.peersCache.get(net)
    if (r == undefined) {
      db.get_peers(function(peers) {
       
        if (peers.msg) {
          if (debugPeers.enabled) debugPeers("Waiting for upstream peers.")
          res.json(peers)
          return  
        }

        // sort ip6 addresses to the bottom
        peers.sort(function(a, b) {
          const address1 = a.address.indexOf(':') > -1
          const address2 = b.address.indexOf(':') > -1
          if (address1 < address2)
            return -1;
          else if (address1 > address2)
            return 1;
          else
            return 0;
        });

        // return peer data
        db.peersCache.set (net, peers)
        debug("Cached peers '%s' %o - mem: %o", net, peers, util.memoryUsage(process))
        res.json(peers)
      }, net);
    } else {
      debug("Get peers by cache '%s' ...", net)
      res.send(r)
    }
  } else
    res.end(METHOD_DISABLED);
});

// get the list of masternodes from local collection
app.use('/ext/getmasternodelist/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const api_page = settings.get(net, 'api_page')
  if ((api_page.enabled == true && api_page.public_apis.ext.getmasternodelist.enabled == true) || isInternalRequest(req)) {
    db.get_masternodes(function(masternodes) {
      // loop through masternode list and remove the mongo _id and __v keys
      // for (i = 0; i < masternodes.length; i++) {
      //   delete masternodes[i]['_doc']['_id'];
      //   delete masternodes[i]['_doc']['__v'];
      // }
      // db.masternodesCache.set(net, masternodes)
      debug("Got masternodes '%s' %o - mem: %o", net, masternodes, util.memoryUsage(process))
      res.send(masternodes)
    }, net)
  } else
    res.end(METHOD_DISABLED)
})

// returns a list of masternode reward txs for a single masternode address from a specific block height
app.use('/ext/getmasternoderewards/:hash/:since/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  // check if the getmasternoderewards api is enabled
  if (api_page.enabled == true && api_page.public_apis.ext.getmasternoderewards.enabled == true) {
    db.get_masternode_rewards(req.params.hash, req.params.since, function(rewards) {
      if (rewards != null) {
        // loop through the tx list to fix vout values and remove unnecessary data such as the always empty vin array and the mongo _id and __v keys
        for (i = 0; i < rewards.length; i++) {
          // remove unnecessary data keys
          delete rewards[i]['vin'];
          delete rewards[i]['_id'];
          delete rewards[i]['__v'];
          // convert amounts from satoshis
          rewards[i]['total'] = rewards[i]['total'] / 100000000;
          rewards[i]['vout']['amount'] = rewards[i]['vout']['amount'] / 100000000;
        }

        // return list of masternode rewards
        res.json(rewards);
      } else
        res.send({error: "failed to retrieve masternode rewards", hash: req.params.hash, since: req.params.since});
    }, net);
  } else
    res.end(METHOD_DISABLED);
});

// returns the total masternode rewards received for a single masternode address from a specific block height
app.use('/ext/getmasternoderewardstotal/:hash/:since/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true && api_page.public_apis.ext.getmasternoderewardstotal.enabled == true) {
    db.get_masternode_rewards_totals(req.params.hash, req.params.since, function(total_rewards) {
      if (total_rewards != null) {
        // return the total of masternode rewards
        res.json(total_rewards)
      } else
        res.send({error: "failed to retrieve masternode rewards", hash: req.params.hash, since: req.params.since})
    }, net)
  } else
    res.end(METHOD_DISABLED)
});

app.use('/ext/getnetworkchartdata/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  db.get_network_chart_data(function(data) {
    if (data) {
      if (debugChart.enabled) debugChart("Got network chart '%s' %o - mem: %o", net, data, util.memoryUsage(process))
      res.send(data)
    } else {
      res.send()
    }
  }, net)
})

const allnet_modes = ['markets']

/* Net APIs by DB / cache */

app.use('/net/getallnet/:mode?', function(req, res) {
  const net = settings.getDefaultNet()
  const mode = req.params['mode']
  const api_page = settings.get(net, 'api_page')

  if (api_page.enabled == true && api_page.public_apis.net.getallnet.enabled == true) {
    if (mode) {
      if (!allnet_modes.includes(mode)) {
        res.end('This mode is not supported')
      }
    } else {
      const r = foreverCache.get('allnet')
      if (r == undefined) {
        const allnet = settings.getAllNet()
        foreverCache.set(net, allnet)
        res.send(allnet)
      } else {
        res.send(r)
      }
    }
  } else
    res.end(METHOD_DISABLED)
})

// peer connector API
app.use('/peers/getpeers/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true && api_page.public_apis.peers.getpeers.enabled == true) {
    const allowed_ips = api_page.public_apis.peers.allowed_ips
    const ip = settings.getRemoteIp(req)
    if (!allowed_ips.includes(ip)) {
      res.end('403: Access with IP ' + ip + ' is denied.')
      return
    }
    const r = xpeersCache.get(net)
    if (r == undefined) {
      // db.get_xpeers(function(peers) {
      //   xpeersCache.set (net, peers)
      //   debug("Cached xpeers '%s' %o - mem: %o", net, peers, util.memoryUsage(process))
      //   res.json(peers)
      // }, net)
      const clientsSet = wsInstance.getWss().clients
      const clientsValues = clientsSet.values()
      const json = []
      for (let i=0; i < clientsSet.size; i++) {
        const client = clientsValues.next().value
        // console.log(client._sender._socket._peername)
        json[i] = client._sender._socket._peername
      }
      xpeersCache.get(net,  json)
      res.json(json)
    } else {
      debug("Get xpeers by cache %o for net '%s' ...", r, net)
      res.json(r)
    }
  } else
    res.end(METHOD_DISABLED)
})

function isPeerUpstreamAllowed(net) {
  const db =  settings.getDbOrNull(net)
  const api_page = settings.get(net, 'api_page')
  return api_page.enabled == true && api_page.public_apis.peers.subscribe_upstream.enabled == true && db && db.peers.enabled == true && db.peers.mode == 'upstream'
}

app.ws('/peers/subscribe/upstream/:net?', function(ws, req) {
  const net = req.params['net']
  const ip = settings.getRemoteIp(req)

  // TODO: Peers: Check peer IP allowed.
  // An upstream peer (client) connects to us (we are the server) - 0
  if (isPeerUpstreamAllowed(net)) {
    console.log("Upstream peer '%s' for net '%s' requested.", ip, net)

    ws.on('message', function(msg) {
      // TODO: Peers: Fix balance is null with upstream peer.

      const obj = JSON.parse(msg)

      if (obj && obj.event && obj.event == Peers.UPSTREAM_HANDSHAKE) {
        const version = obj.data
        const clientsSet = wsInstance.getWss().clients

        console.log("Received upstream handshake for net '%s', peer version %d, number of peers %d.", obj.net, obj.data, clientsSet.size)
        if (version != Peers.PEER_VERSION) {
          console.log("Upstream peer version for net '%s' mismatch: received %d != %d", net, version, Peers.PEER_VERSION)
          // TODO: Peers: Disconnect peer.
          // https://stackoverflow.com/questions/19304157/getting-the-reason-why-websockets-closed-with-close-code-1006/19305172#19305172
          // ws.close(1006, 'Abnormal Closure')
        }
        
        const clientsValues = clientsSet.values()
        for(let i=0; i < clientsSet.size; i++) {
          const peer = clientsValues.next().value
          if (debugPeers.enabled) 
            debugPeers("Available peers(%d): %o", i + 1, peer._sender._socket._peername)
          if (i == clientsSet.size - 1) {
            db.push_upstream_peer_server(peer, net)
          }
        }

        ws.send(JSON.stringify({ 'type': 'handshake', 'message': 'Completed' }))
      } else {
        if (debugPeers.enabled) 
          debugPeers("Got upstream response: %o", obj)
        if (obj && obj.event && obj.event == Peers.UPSTREAM_GET_PEERS + net) {
          db.peersCache.set(obj.event, obj.data)
        } else if (obj && obj.event && obj.event.startsWith(Peers.UPSTREAM_GET_BLOCK_BY_HASH + net)) {
          db.blocksCache.set(obj.event, obj.data)
        } else if (obj && obj.event && obj.event.startsWith(Peers.UPSTREAM_GET_BLOCK_BY_HEIGHT + net)) {
          db.blocksCache.set(obj.event, obj.data)
        } else if (obj && obj.event && obj.event.startsWith(Peers.UPSTREAM_GET_ADDRESS + net)) {
          db.addressCache.set(obj.event, obj.data)
        } else if (obj && obj.event && obj.event.startsWith(Peers.UPSTREAM_GET_ADDRESS_TXES + net)) {
          db.addressTxCache.set(obj.event, obj.data)
        } else if (obj && obj.event && obj.event.startsWith(Peers.UPSTREAM_GET_TXES_BY_BLOCKHASH + net)) {
          db.txsCache.set(obj.event, obj.data)
        } else if (obj && obj.event && obj.event.startsWith(Peers.UPSTREAM_GET_LAST_TXES + net)) {
          db.txsCache.set(obj.event, obj.data)
        } else if (obj && obj.event && obj.event.startsWith(Peers.UPSTREAM_GET_TX + net)) {
          db.txsCache.set(obj.event, obj.data)
        } else if (obj && obj.event && obj.event == Peers.UPSTREAM_GET_MASTERNODES + net) {
          db.masternodesCache.set(obj.event, obj.data)
        } else if (obj && obj.event && obj.event == Peers.UPSTREAM_GET_COINSTATS + net) {
          db.statsCache.set(obj.event, obj.data)
        } else if (obj && obj.event && obj.event == Peers.UPSTREAM_GET_DBINDEX + net) {
          db.dbindexCache.set(obj.event, obj.data)
        } else if (obj && obj.event && obj.event == Peers.UPSTREAM_GET_RICHLIST + net) {
          db.richlistCache.set(obj.event, obj.data)
        } else if (obj && obj.event && obj.event.startsWith(Peers.UPSTREAM_GET_NETWORK_CHART + net)) {
          db.networkChartCache.set(obj.event, obj.data)
        } else if (obj && obj.event && obj.event.startsWith(Peers.UPSTREAM_GET_MARKET + net)) {
          db.marketsCache.set(obj.event, obj.data)
        } else if (obj && obj.event && obj.event.startsWith(Peers.UPSTREAM_GET_MARKETS + net)) {
          db.marketsCache.set(obj.event, obj.data)
        } else if (obj && obj.event && obj.event.startsWith(Peers.UPSTREAM_GET_MARKET_SUMMARY + net)) {
          db.marketsCache.set(obj.event, obj.data)
        } else if (obj && obj.event && obj.event.startsWith(Peers.UPSTREAM_GET_MARKET_HISTORY + net)) {
          db.marketsCache.set(obj.event, obj.data)
        } else if (obj && obj.event && obj.event.startsWith(Peers.UPSTREAM_GET_BUY_ORDER_AGGR + net)) {
          db.marketsCache.set(obj.event, obj.data)
        } else if (obj && obj.event && obj.event.startsWith(Peers.UPSTREAM_GET_SELL_ORDER_AGGR + net)) {
          db.marketsCache.set(obj.event, obj.data)
        }

        ws.send(JSON.stringify({ 'type': 'Cache', 'message': 'Cached ' + obj.event }))
      }
    })

    ws.on('error', msg => {
      console.error('ERROR: %s', msg)
    })
    // ws.on('connection', msg => {
    //   console.info('Connected: %s', msg)
    // })
    ws.on('close', (obj) => {
      const clientsSet = wsInstance.getWss().clients
      console.log('Upstream peer connection closed %o, number of peers %d.', obj, clientsSet.size)
      db.update_upstream_peer_servers(wsInstance)
    })
  }
})

app.use('/system/restartexplorer', function(req, res, next) {
  // check to ensure this special cmd is only executed by the local server
  if (req._remoteAddress != null && req._remoteAddress.indexOf('127.0.0.1') > -1) {
    // send a msg to the cluster process telling it to restart
    process.send('restart');
    res.end();
  } else {
    // show the error page
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
  }
});

var market_data = {};
var market_count = {};

networks.forEach( function(item, index) {
  market_count[item] = 0
  var tmparray = []
  const markets_page = settings.get(item, 'markets_page')
  // check if markets are enabled
  if (markets_page.enabled == true) {
    // dynamically populate market data
    Object.keys(markets_page.exchanges).forEach(function (key, index, map) {
      // check if market is enabled via settings
      if (markets_page.exchanges[key].enabled == true) {
        // check if market is installed/supported
        if (db.fs.existsSync('./lib/markets/' + key + '.js')) {
          // load market file
          var exMarket = require('./lib/markets/' + key);
          // save market_name and market_logo from market file to settings
          const tmp = {
            id: key,
            name: exMarket.market_name == null ? '' : exMarket.market_name,
            alt_name: exMarket.market_name_alt == null ? '' : exMarket.market_name_alt,
            logo: exMarket.market_logo == null ? '' : exMarket.market_logo,
            alt_logo: exMarket.market_logo_alt == null ? '' : exMarket.market_logo_alt,
            trading_pairs : []                        
          }
          tmparray.push(tmp)
          // loop through all trading pairs for this market
          for (var i = 0; i < markets_page.exchanges[key].trading_pairs.length; i++) {
            var pair = markets_page.exchanges[key].trading_pairs[i].toUpperCase(); // ensure trading pair setting is always uppercase
            var coin_symbol = pair.split('/')[0];
            var pair_symbol = pair.split('/')[1];

            // add trading pair to market_data
            tmparray[tmparray.length - 1].trading_pairs.push({
              pair: pair
            });
            market_count[item]++;
          }
        }
      }
    });
  
    // sort market data by market name
    tmparray.sort(function(a, b) {
      var name1 = a.name.toLowerCase();
      var name2 = b.name.toLowerCase();

      if (name1 < name2)
        return -1;
      else if (name1 > name2)
        return 1;
      else
        return 0;
    });

    var ex = markets_page.exchanges;
    var ex_keys = Object.keys(ex);
    var ex_error = '';

    // check if there was an error msg
    if (ex_error != '') {
      // there was an error, so find the next available market from settings.json
      var new_default_index = -1;

      // find the first enabled exchange with at least one trading pair
      for (var i = 0; i < ex_keys.length; i++) {
        if (ex[ex_keys[i]]['enabled'] === true && ex[ex_keys[i]]['trading_pairs'].length > 0) {
          // found a match so save the index
          new_default_index = i;
          // stop looking for more matches
          break;
        }
      }

      // Disable the markets page for this session if no active market and trading pair was found or set the new default market.
      if (new_default_index == -1) {
        console.log('WARNING: ' + ex_error + '. ' + 'No valid or enabled markets found in settings.json. The markets feature will be temporarily disabled. To restore markets functionality, please enable at least 1 market and ensure at least 1 valid trading pair is added. Finally, restart X to resolve the problem');
        settings.markets_page.enabled = false;
      } else {
        console.log('WARNING: ' + ex_error + '. ' + 'Default exchange will be set to' + ': ' + ex_keys[new_default_index] + ' (' + ex[ex_keys[new_default_index]].trading_pairs[0] + ')');
        markets_page.default_exchange.exchange_name = ex_keys[new_default_index];
        markets_page.default_exchange.trading_pair = ex[ex_keys[new_default_index]].trading_pairs[0];
      }
    }
  }
  
  if (tmparray.length > 0) {
    market_data[item] = tmparray
  }
});

// locals
app.set('app_name',                       package_metadata.name)
app.set('app_version',                    package_metadata.version)
app.set('locale',                         locale)
app.set('anyHeader',                      settings.anyHeader)
app.set('allHeaders',                     settings.allHeaders)
app.set('get',                            settings.get)
app.set('getWallet',                      settings.getWallet)
app.set('getRemoteIp',                    settings.getRemoteIp)
app.set('isMultiAlgo',                     settings.isMultiAlgo)
app.set('isPepew',                        settings.isPepew)
app.set('isVkax',                         settings.isVkax)
app.set('isMagpie',                       settings.isMagpie)
app.set('getLogo',                        settings.getLogo)
app.set('getTitleLogo',                   settings.getTitleLogo)
app.set('formatDateTime',                 settings.formatDateTime)
app.set('formatCurrency',                 settings.formatCurrency)
app.set('formatDecimal',                  settings.formatDecimal)
app.set('formatInt',                      settings.formatInt)
app.set('formatUnixtime',                 settings.formatUnixtime)
app.set('panelOffset',                    settings.panelOffset)
app.set('panel',                          settings.panel)
app.set('panels',                         settings.panels)
app.set('coins',                          settings.coins)
app.set('wallets',                        settings.wallets)
app.set('default_wallet',                 settings.wallets[0].id)
app.set('currencies',                     settings.currencies)
app.set('cache',                          settings.cache)
app.set('labels',                         settings.labels)
app.set('blockchain_specific',            settings.blockchain_specific)
app.set('market_data',                    market_data)
app.set('market_count',                   market_count)
app.set('hasUpstream',                    settings.hasUpstream)
app.set('needsUpstream',                  settings.needsUpstream)

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found')
    err.status = 404
    next(err)
})

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use(function(err, req, res, next) {
    const net = settings.getNet(req.params['net'])
    const coin = settings.getCoin(net)
    const shared_pages = settings.get(net, 'shared_pages')
    const error_page = settings.get(net, 'error_page')
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err,
      shared_pages: shared_pages,
      error_page: error_page,
      coin: coin,
      net: net
    });
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const shared_pages = settings.get(net, 'shared_pages')
  const error_page = settings.get(net, 'error_page')
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: {},
    shared_pages: shared_pages,
    error_page: error_page,
    coin: coin,
    net: net
  });
});

// determine if tls features should be enabled
if (settings.webserver.tls.enabled == true) {
  try {
    var tls_options = {
      key: db.fs.readFileSync(settings.webserver.tls.key_file),
      cert: db.fs.readFileSync(settings.webserver.tls.cert_file),
      ca: db.fs.readFileSync(settings.webserver.tls.chain_file)
    };
  } catch(e) {
    console.warn('There was a problem reading tls certificates. Check that the certificate, chain and key paths are correct.');
  }

  var https = require('https');
  https.createServer(tls_options, app).listen(settings.webserver.tls.port);
}

// get the latest git commit id (if exists)
exec('git rev-parse HEAD', (err, stdout, stderr) => {
  // check if the commit id was returned
  if (stdout != null && stdout != '') {
    // set but-x revision code based on the git commit id
    app.set('revision', stdout.substring(0, 7))
  }
})

module.exports = app