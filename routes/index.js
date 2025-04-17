const debug = require('debug')('debug')
const express = require('express')
const router = express.Router()
const settings = require('../lib/settings')
const locale = require('../lib/locale')
const db = require('../lib/database')
const datautil = require('../lib/datautil')
const lib = require('../lib/x')
const qr = require('qr-image')
const TTLCache = require('@isaacs/ttlcache')
const networks = settings.getAllNet()
const fs = require('fs')
const bcrypt = require('bcrypt')

const infoCache = new TTLCache({ max: settings.cache.info.size, ttl: settings.cache.info.ttl * 1000, updateAgeOnGet: false, noUpdateTTL: false })

const styleHash = get_file_timestamp('./public/css/style.scss')
const themeHash = get_file_timestamp('./public/css/themes/darkly/bootstrap.min.css')

const customHash = {}
networks.forEach( function(net, index) {
  const file = './public/css/' + net + '.scss'
  if (fs.existsSync(file)) {
    customHash[net] = get_file_timestamp(file)
  } else {
    console.warn("Custom CSS for net '%s' not found.", net)
  }
})

function route_get_block(req, res, blockhash) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)

  db.get_block_by_hash(blockhash, function (block) {
    const block_page = settings.get(net, 'block_page')

    if (block && block != 'There was an error. Check your console.') {
      db.get_stats(coin.name, function(stats) {

        if (blockhash == block_page.genesis_block) {
          const p = blockParam(req, stats, 'block', block_page, net, db, settings, block, 'GENESIS', coin.name + ' Genesis Block')
          res.render('block', p)
        } else {
          db.find_txs_by_blockhash(block.hash, function(txs) {
            if (txs && txs.length > 0) {
              const p = blockParam(req, stats, 'block', block_page, net, db, settings, block, txs, coin.name + ' Block ' + block.height)
              res.render('block', p)
            } else
              res.send({ error: 'txes for block not found.', hash: txid, coin: coin, net: net})
          }, net)
        }
      }, net)
    } else {
      if (!isNaN(blockhash)) {
        lib.get_blockhash(blockhash, function(hash) {
          if (hash && hash != 'There was an error. Check your console.')
            res.redirect('/block/' + hash + '/' + net)
          else
            route_get_index(req, res, 'Block not found: ' + blockhash)
        }, net)
      } else
        route_get_index(req, res, 'Block not found: ' + blockhash)
    }
  }, net)
}

function route_get_asset(req, res, name) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const asset_page = settings.get(net, 'asset_page')

  name = name.replace('asset:', '')
  name = name.replace('+', '/')
  name = name.replace('*', '#')
  if (debug.enabled)
    debug("Search for asset: " + name)
  
  db.get_asset_by_name_local(name, function (asset) {
    if (asset) {
      asset.name = name
      db.get_stats(coin.name, function(stats) {
        if (stats) {
          if (asset.tx_count > 0) {
            db.get_latest_asset_tx_by_name_local(name, function (latesttx) {
              asset.latesttx = latesttx
              const p = assetParam(req, stats, 'asset', asset_page, net, db, settings, asset, coin.name + ' Asset ' + name)
              res.render('asset', p)
            }, net)
          } else {
            asset.latesttx = []
              const p = assetParam(req, stats, 'asset', asset_page, net, db, settings, asset, coin.name + ' Asset ' + name)
              res.render('asset', p)
          }
        } else {
          route_get_index(req, res, 'Asset search unexpected error: ' + name)
        }
      }, net)
    } else {
      route_get_index(req, res, 'Asset not found: ' + name)
    }
  }, net)
}

function get_file_timestamp(file_name) {
  if (db.fs.existsSync(file_name))
    return parseInt(db.fs.statSync(file_name).mtimeMs / 1000)
  else
    return null
}

/* GET functions */

function route_get_tx(req, res, txid) {
  const net = req.params['net']
  const coin = settings.getCoin(net)
  const transaction_page = settings.get(net, 'transaction_page')
  if (txid == transaction_page.genesis_tx) {
    const block_page = settings.get(net, 'block_page')
    route_get_block(req, res, block_page.genesis_block)
  } else {
    db.get_tx(txid, function(tx) {
      if (tx) {
        // TODO: yerbas: Add assets to vin. Could be solved with the yerbas-cli.
        if (net == 'yerbas') {
          for (i = 0; i < tx.vin.length; i++) {
            if (tx.vin[i]) {
              console.log("TXVIN: %O", tx.vin)
            }
          }
        }
        // TODO: yerbas: tx type
        if (tx.tx_type == 8 || tx.tx_type == 9) {
          db.get_token({ "height": tx.blockindex, "txid": tx.txid }, function(tokens) {
            if (debug.enabled)
              debug("Got tokens %o with TX %s at index %d for chain '%s'.", tokens, tx.txid, tx.blockindex, net)
            if (settings.get(net, 'claim_address_page').enabled == true) {
              db.populate_claim_address_names(tx, function(tx) {
                const p = txParam(req, 'tx', transaction_page, net, db, settings, tx, (tx.blockindex ? tx.blockindex : 0), coin.name + ' Transaction ' + tx.txid)
                p.tokens = tokens
                res.render('tx', p)
              }, net)
            } else {
              const p = txParam(req, 'tx', transaction_page, net, db, settings, tx, (tx.blockindex ? tx.blockindex : 0), coin.name + ' Transaction ' + tx.txid)
              p.tokens = tokens
              res.render('tx', p)
            }
          }, net)
        } else {
          if (settings.get(net, 'claim_address_page').enabled == true) {
            db.populate_claim_address_names(tx, function(tx) {
              const p = txParam(req, 'tx', transaction_page, net, db, settings, tx, (tx.blockindex ? tx.blockindex : 0), coin.name + ' Transaction ' + tx.txid)
              res.render('tx', p)
            }, net)
          } else {
            const p = txParam(req, 'tx', transaction_page, net, db, settings, tx, (tx.blockindex ? tx.blockindex : 0), coin.name + ' Transaction ' + tx.txid)
            res.render('tx', p)
          }
        }
      } else {
        res.send({ error: 'tx not found.', hash: txid, coin: coin, net: net})
      }
    }, net)
  }
}

function route_get_index(req, res, error) {
  const net = req.params['net']
  const coin = settings.getCoin(net)
  const index_page = settings.get(net, 'index_page')
  const api_page = settings.get(net, 'api_page')
  const shared_pages = settings.get(net, 'shared_pages')
  const p = param('home', index_page, req, db, settings, coin.name + ' X')
  p.error = error
  p.last_updated = null
  p.index_page = index_page
  p.api_page = api_page
  p.net = net
  
  if (index_page.page_header.show_last_updated == true) {
    db.get_stats(coin.name, function (stats) {
      p.last_updated = stats.network_last_updated
      res.render('index', p)
    }, net)
  } else {
    res.render('index', p)
  }
}

router.get('/assets/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const assets_page = settings.get(net, 'assets_page')
  db.get_stats(coin.name, function(stats) {
    if (stats) {
      const p = assetsParam(req, 'assets', assets_page, net, db, settings, 'assets')
      p.assets_page = assets_page
      res.render('assets', p)
    } else {
      route_get_index(req, res, 'Assets page unexpected error 1: ')
    }
  }, net)
})

router.get('/info/:net?', function(req, res) {
  const net = req.params['net']
  const coin = settings.getCoin(net)
  
  db.get_stats(coin.name, function (stats) {
    db.get_dbindex(coin.name, function (dbindex) {
      db.get_markets(function(markets) {

        const shared_pages = settings.get(net, 'shared_pages')
        const info_page = settings.get(net, 'info_page')
        const algos = settings.get(net, 'algos')
        const count_tx_by_type = dbindex.count_tx_by_type
        const tx_types = settings.get(net, 'tx_types')
        
        let i = 0
        if (Array.isArray(count_tx_by_type)) {
          while (i < count_tx_by_type.length) {
              count_tx_by_type[i].type = tx_types[i]
              i++
          }
        }

        const trading_pairs = []
        if (markets && markets.forEach) {
          markets.forEach((e) => {
            if (!trading_pairs.includes(e.pair_symbol))
              trading_pairs.push(e.pair_symbol)
          })
        }

        const p = param('info', info_page, req, db, settings, coin.name + ' X')
        p.last_updated = null
        p.shared_pages = shared_pages
        p.algos = algos
        // shared_pages.page_header.network_charts.algos.size
        p.info_page = info_page
        p.count_blocks_by_algorithm = dbindex.count_blocks_by_algorithm
        p.tx_types = settings.get(net, 'tx_types')
        var txes = 0
        p.count_tx_by_type = count_tx_by_type
        if (count_tx_by_type) {
          for (i = 0; i < count_tx_by_type.length; i++) {
            if (!isNaN(count_tx_by_type[i].count))
              txes += count_tx_by_type[i].count
          }
        }
        p.txes = txes
        p.addresses = dbindex.count_addresses
        p.assets = dbindex.count_assets
        p.latest_coinbase_tx = dbindex.latest_coinbase_tx
        p.markets = markets
        p.trading_pairs = trading_pairs
        p.sell_order_aggregation = dbindex.sell_order_aggregation
        p.buy_order_aggregation = dbindex.buy_order_aggregation
        p.count_masternodes_by_country = dbindex.count_masternodes_by_country
        
        if (stats) {
          p.stats = stats
          p.last_updated = stats.network_last_updated
        }
        res.render('info', p)
      }, net)
    }, net)
  }, net)
})

function route_get_address(req, res, hash) {
  const net = req.params['net']
  const coin = settings.getCoin(net)
  const address_page = settings.get(net, 'address_page')
  const claim_address_page = settings.get(net, 'claim_address_page')
  // check if trying to load a special address
  if (hash != null && hash.toLowerCase() != 'coinbase' && ((hash.toLowerCase() == 'hidden_address' && address_page.enable_hidden_address_view == true) || (hash.toLowerCase() == 'unknown_address' && address_page.enable_unknown_address_view == true) || (hash.toLowerCase() != 'hidden_address' && hash.toLowerCase() != 'unknown_address'))) {
    // lookup address in local collection
    db.get_address(hash, function(address) {
      const api_page = settings.get( net, 'api_page')
      if (address) {
        const p = param('address', address_page, req, db, settings, coin.name + ' Address ' + (address['name'] == null || address['name'] == '' ? address.a_id : address['name']))
        p.address = address
        p.address_page = address_page
        p.api_page = api_page
        p.claim_address_page = claim_address_page
        res.render('address', p)
      }
      else
        route_get_index(req, res, hash + ' not found')
    }, net)
  } else
    route_get_index(req, res, hash + ' not found')
}

function route_get_claim_form(req, res, hash) {
  const net = req.params['net']
  const coin = settings.getCoin(net)
  const address_page = settings.get(net, 'address_page')
  const claim_address_page = settings.get(net, 'claim_address_page')
  
  if (claim_address_page.enabled == true) {
    // check if a hash was passed in
    if (hash == null || hash == '') {
      // no hash so just load the claim page without an address
      const p = param('claim-address', claim_address_page, req, db, settings, coin.name + ' Claim Wallet Address')
      p.hash = hash
      p.claim_name = ''
      p.address_page = address_page
      p.claim_address_page = claim_address_page
      res.render('claim_address', p)
    } else {
      db.get_address(hash, function(address) {
        // load the claim page regardless of whether the address exists or not
        const p = param('claim-address', claim_address_page, req, db, settings, coin.name + ' Claim Wallet Address ' + hash)
        p.hash = hash,
        p.claim_name = (address == null || address.name == null ? '' : address.name)
        p.address_page = address_page
        p.claim_address_page = claim_address_page
        p.show_panels = claim_address_page.show_panels
        p.showNethashChart = claim_address_page.show_nethash_chart
        p.showDifficultyChart = claim_address_page.show_difficulty_chart
        res.render('claim_address', p)
      }, net)
    }
  } else
    route_get_address(req, res, hash)
}

/* GET home page(s). */

router.get('/', function(req, res) {
  req.params['net'] = settings.getDefaultNet()
  route_get_index(req, res, null)
})

networks.forEach( function(net, index) {
  const enabled = settings.getDbOrNull(net).enabled
  if (enabled) {
    router.get('/' + net, function(req, res) {
      req.params['net'] = net
      route_get_index(req, res, null)
    })
  }
})

function isApiEndpointEnabled(api_page, api_cmds, key) {
  return api_page.public_apis.rpc[key].enabled == true && api_cmds[key] != null && api_cmds[key] != ''
}

router.get('/apidocs/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true) {  
    const markets_page = settings.get(net, 'markets_page')
    const p = param('apidocs', api_page, req, db, settings, coin.name + ' Public API ' + net)
    p.address = settings.webserver.url
    p.markets_page = markets_page
    p.api_page = api_page
    p.api_cmds = settings.get(net, 'api_cmds')
    p.isMainnet = net == 'mainnet'
    p.isApiEndpointEnabled = isApiEndpointEnabled
    p.algos = settings.get(net, 'algos')
    p.tx_types = settings.get(net, 'tx_types')
    res.render('apidocs', p)
  } else {
    route_get_index(req, res, null)
  }
})

router.get('/markets/:market/:coin_symbol/:pair_symbol/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const markets_page = settings.get(net, 'markets_page')

  if (markets_page.enabled == true) {
    const market_id = req.params['market']
    const coin_symbol = req.params['coin_symbol']
    const pair_symbol = req.params['pair_symbol']
    const exchange = markets_page.exchanges[market_id]
    const reverse = coin.symbol != coin_symbol

    if (exchange != null && exchange.enabled == true && exchange.trading_pairs.findIndex(p => p.toLowerCase() == coin_symbol.toLowerCase() + '/' + pair_symbol.toLowerCase()) > -1) {
      db.get_markets_summary(function(mmdata) {
        db.get_market(market_id, coin_symbol, pair_symbol, function(data) {
          if (!data) {
            data = {}
            // TODO: Fix this in a better way.
            // data ? data.reverse : false
            // route_get_index(res, merr, net)
          }
          db.get_market_trade_history(market_id, coin_symbol, pair_symbol, function(trade_history_data) {
            if (trade_history_data)
              data.history = trade_history_data
            db.get_buy_order_aggregation(market_id, coin_symbol, pair_symbol, data ? data.reverse : false, function(buy_orders) {
              if (buy_orders)
                data.buys = buy_orders
              db.get_sell_order_aggregation(market_id, coin_symbol, pair_symbol, data ? data.reverse : false, function(sell_orders) {
                if (sell_orders)
                  data.sells = sell_orders

                const market_data = require('../lib/markets/' + market_id)
                var url = ''
                // build the external exchange url link and determine if using the alt name + logo
                const tpl = market_data.market_url_template
                if (tpl != null && tpl != '') {
                  switch ((market_data.market_url_case == null || market_data.market_url_case == '' ? 'l' : market_data.market_url_case.toLowerCase())) {
                    case 'l':
                    case 'lower':
                      url = tpl.replace('{base}', pair_symbol.toLowerCase()).replace('{coin}', coin_symbol.toLowerCase()).replace('{url_prefix}', (market_data.market_url != null ? market_data.market_url({coin: coin_symbol.toLowerCase(), exchange: pair_symbol.toLowerCase()}) : ''))
                      break
                    case 'u':
                    case 'upper':
                      url = tpl.replace('{base}', pair_symbol.toUpperCase()).replace('{coin}', coin_symbol.toUpperCase()).replace('{url_prefix}', (market_data.market_url != null ? market_data.market_url({coin: coin_symbol.toUpperCase(), exchange: pair_symbol.toUpperCase()}) : ''))
                      break
                    default:
                  }
                }

                const ext_market_url = market_data.ext_market_url == null ? '' : market_data.ext_market_url
                const referal = market_data.referal == null ? '' : market_data.referal

                const p = param('markets', markets_page, req, db, settings, locale.mkt_title.replace('{1}', market_data.market_name + ' (' + coin_symbol + '/' + pair_symbol + ')'))
                p.marketdata =  {
                  market_name: market_data.market_name,
                  market_logo: market_data.market_logo,
                  ext_market_url: ext_market_url,
                  referal: referal,
                  coin: coin_symbol,
                  exchange: pair_symbol,
                  reverse: reverse,
                  data: data,
                  url: url
                },
                p.mmdata = mmdata
                p.market = market_id
                p.markets_page = markets_page

                if (markets_page.page_header.show_last_updated == true) {
                  db.get_stats(coin.name, function (stats) {
                    p.last_updated = stats.network_last_updated
                    res.render('./market', p)
                  }, net)
                } else {
                  res.render('./market', p)
                }
              }, net)  
            }, net)
          }, net)
        }, net)
      }, net)
    } else {
      // selected market does not exist or is not enabled so default to the index page
      route_get_index(req, res, null)
    }
  } else {
    // markets page is not enabled so default to the index page
    route_get_index(req, res, null)
  }
})

router.get('/richlist/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const richlist_page = settings.get(net, 'richlist_page')
  if (richlist_page.enabled == true) {
    db.get_stats(coin.name, function (stats) {
      db.get_richlist(coin.name, function(richlist) {
        if (richlist) {
          datautil.get_distribution(settings, lib, richlist, stats, function(distribution) {
            const p = param('richlist', richlist_page, req, db, settings, 'Top ' + coin.name + ' Holders, Received and Transactions.')
            p.balance = richlist.balance
            p.received = richlist.received
            p.toptx = richlist.toptx
            p.burned = richlist.burned
            p.stats = stats
            p.dista = distribution.t_1_25
            p.distb = distribution.t_26_50
            p.distc = distribution.t_51_75
            p.distd = distribution.t_76_100
            p.diste = distribution.t_101plus
            p.last_updated = (richlist_page.page_header.show_last_updated == true ? stats.richlist_last_updated : null)
            p.claim_address_page = settings.get(net, 'claim_address_page')
            p.richlist_page = richlist_page
            res.render('richlist', p)
          }, net)
        } else {
          // richlist data not found so default to the index page
          route_get_index(req, res, null)
        }
      }, net)
    }, net)
  } else {
    // richlist page is not enabled so default to the index page
    route_get_index(req, res, null)
  }
})

// movements page
router.get('/movement/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const movement_page = settings.get(net, 'movement_page')
  if (movement_page.enabled == true) {
    const p = param('movement', movement_page, req, db, settings, coin.name + ' - Coin Movements')
    p.movement_page = movement_page
    p.api_page = settings.get(net, 'api_page')

    if (movement_page.page_header.show_last_updated == true) {
      db.get_stats(coin.name, function (stats) {
        p.last_updated = stats.network_last_updated
        res.render('movement', p)
      }, net)
    } else {
      res.render('movement', p)
    }
  } else {
    route_get_index(req, res, null)
  }
})

// network page
router.get('/network/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const network_page = settings.get(net, 'network_page')
  if (network_page.enabled == true) {
    const p = param('network', network_page, req, db, settings, coin.name + ' - Network Peers')
    p.network_page = network_page

    if (network_page.page_header.show_last_updated == true) {
      db.get_stats(coin.name, function (stats) {
        p.last_updated = stats.network_last_updated
        res.render( 'network', p)
      }, net)
    } else {
      res.render( 'network', p)
    }
  } else {
    route_get_index(req, res, null)
  }
})

// masternode list page
router.get('/masternodes/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const masternodes_page = settings.get(net, 'masternodes_page')
  if (masternodes_page.enabled == true) {
    const p = param('masternodes', masternodes_page, req, db, settings, coin.name + ' - Smartnodes')
    p.masternodes_page = masternodes_page
    p.claim_address_page = settings.get(net, 'claim_address_page')

    if (masternodes_page.page_header.show_last_updated == true) {
      db.get_stats(coin.name, function (stats) {
        p.last_updated = stats.network_last_updated
        res.render('masternodes', p)
      }, net)
    } else {
      res.render('masternodes', p)
    }
  } else {
    route_get_index(req, res, null)
  }
})

router.get('/reward/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  // TODO: Fix Heavy Coin reward page.
  const reward_page = settings.get(net, 'reward_page')
  if (settings.blockchain_specific.heavycoin.enabled == true && settings.blockchain_specific.heavycoin.reward_page.enabled == true) {
    db.get_stats(coin.name, function (stats) {
      db.get_heavy(coin.name, function (heavy) {
        if (!heavy)
          heavy = { coin: coin.name, lvote: 0, reward: 0, supply: 0, cap: 0, estnext: 0, phase: 'N/A', maxvote: 0, nextin: 'N/A', votes: [] }

        const votes = heavy.votes
        votes.sort(function (a, b) {
          if (a.count < b.count)
            return -1
          else if (a.count > b.count)
            return 1
          else
            return 0
        })

        const p = param('reward', reward_page, req, db, settings, coin.name + ' - Reward/Voting Details')
        p.stats = stats
        p.heavy = heavy
        p.votes = votes
        p.last_updated = (settings.blockchain_specific.heavycoin.reward_page.page_header.show_last_updated == true ? stats.reward_last_updated : null)
        p.masternodes_page = settings.get(net, 'masternodes_page')
        p.claim_address_page = settings.get(net, 'claim_address_page')

        res.render('reward', p)
      }, net)
    }, net)
  } else {
    // reward page is not enabled so default to the index page
    route_get_index(req, res, null)
  }
})

router.get('/tx/:txid/:net?', function(req, res) {
  route_get_tx(req, res, req.params.txid)
})

router.get('/block/:hash/:net?', function(req, res) {
  route_get_block(req, res, req.params.hash)
})

router.get('/asset/:name/:net?', function(req, res) {
  req.params.name.replace('+', '/')
  route_get_asset(req, res, req.params.name)
})

router.get('/register/:net?', function(req, res) {
  const net = req.params['net']
  const coin = settings.getCoin(net)
  const address_page = settings.get(net, 'address_page')
  const registration_page = settings.get(net, 'registration_page')
  
  if (registration_page.enabled == true) {
    const uuid = crypto.randomUUID()
    const p = param('register', registration_page, req, db, settings, coin.name + ' Register')
    p.registration_address = ''
    p.address_page = address_page
    p.registration_page = registration_page
    p.uuid = uuid
    res.render('register', p)
  } else
  route_get_index(req, res, 'Registration is disabled.')
})

router.get('/login/:net?', function(req, res) {
  const net = req.params['net']
  const coin = settings.getCoin(net)
  const login_page = settings.get(net, 'login_page')
  
  if (login_page.enabled == true) {
    const p = param('login', login_page, req, db, settings, coin.name + ' Login')
    p.registration_address = ''
    p.login_page = login_page
    res.render('login', p)
  } else
  route_get_index(req, res, 'Login is disabled.')
})

router.get('/user/:net/:address', function(req, res) {
  const net = req.params['net']
  const address = req.params['address']
  const coin = settings.getCoin(net)
  const user_page = settings.get(net, 'user_page')
  
  if (user_page.enabled == true) {
    if (req.session.isLoggedIn == true && req.session.username) {
      // TODO: User
      const p = param('user', user_page, req, db, settings, coin.name + ' User')
      p.address = address
      p.apiKey = req.session.apiKey
      p.user_page = user_page
      res.render('user', p)
    } else {
      res.redirect('/login/' + net)
    }
  } else
  route_get_index(req, res, 'User login is disabled.')
})

function route_to_user_page(req, res, address) {
  const net = req.params['net']
  const coin = settings.getCoin(net)
  const user_page = settings.get(net, 'user_page')
  
  if (user_page.enabled == true) {
    const p = param('user', user_page, req, db, settings, coin.name + ' User')
    p.address = address
    p.user_page = user_page
    res.render('user', p)
  } else
  route_get_index(req, res, 'User login is disabled.')
}

router.get('/claim/:net?', function(req, res) {
  route_get_claim_form(req, res, '')
})

router.get('/claim/:hash/:net?', function(req, res) {
  route_get_claim_form(req, res, req.params.hash)
})

router.get('/address/:hash/:net?', function(req, res) {
  route_get_address(req, res, req.params.hash)
})

router.post('/search/:net?', function(req, res) {
  const net = req.params['net']
  const shared_pages = settings.get(net, 'shared_pages')
  if (shared_pages.page_header.search.enabled == true) {
    var query = req.body.search.trim()
    if (query.length == 64) {
      const transaction_page = settings.get(net, 'transaction_page')
      if (query == transaction_page.genesis_tx) {
        const block_page = settings.get(net, 'block_page')
        res.redirect('/block/' + block_page.genesis_block + '/' + net)
      }
      else {
        db.get_tx(query, function(tx) {
          if (tx)
            res.redirect('/tx/' + tx.txid + '/' + net)
          else {
            lib.get_block(query, function(block) {
              if (block && block != 'There was an error. Check your console.')
                res.redirect('/block/' + query + '/' + net)
              else {
                // check wallet for transaction
                lib.get_rawtransaction(query, function(tx) {
                  if (tx && tx.txid)
                    res.redirect('/tx/' + tx.txid + '/' + net)
                  else {
                    // search found nothing so display the index page with an error msg
                    route_get_index(req, res, locale.ex_search_error + query)
                  }
                }, net)
              }
            }, net)
          }
        }, net)
      }
    } else {
      if (query.startsWith('asset:')) {
        route_get_asset(req, res, query)
      } else {
        console.log("Search address: '" + query + "' for net " + net + ".")
        db.get_address(query, function(address) {
          console.log("Search address: '" + address)
          if (address)
            res.redirect('/address/' + address.a_id + '/' + net)
          else {
            lib.get_blockhash(query, function(hash) {
              if (hash && hash != 'There was an error. Check your console.')
                res.redirect('/block/' + hash + '/' + net)
              else
                route_get_index(req, res, locale.ex_search_error + query)
            }, net)
          }
        }, net)
      }
    }
  } else {
    // Search is disabled so load the index page with an error msg
    route_get_index(req, res, 'Search is disabled')
  }
})

router.get('/qr/:string/:net?', function(req, res) {
  if (req.params.string) {
    var address = qr.image(req.params.string, {
      type: 'png',
      size: 4,
      margin: 1,
      ec_level: 'M'
    })

    res.type('png')
    address.pipe(res)
  }
})

function param(pageKey, page, req, db, settings, prefix) {
  const net = req.params['net']
  const coin = settings.getCoin(net)
  const shared_pages = settings.get(net, 'shared_pages')
  var ip = '-'
  if (shared_pages.page_header.menu_show_user_ip == true)
    ip = settings.getRemoteIp(req)
  const r = {
    active: pageKey,
    showSync: db.check_show_sync_message(net),
    customHash: customHash[net],
    styleHash: styleHash,
    themeHash: themeHash,
    logo: settings.getLogo(net),
    page_title_logo: settings.getTitleLogo(net),
    page_title_prefix: prefix,
    shared_pages: shared_pages,
    showPanels: page.show_panels,
    showPanelsPosition: page.show_panels_position,
    showNethashChart: page.show_nethash_chart,
    showDifficultyChart: page.show_difficulty_chart,
    coin: coin,
    net: net,
    remoteAddress: req._remoteAddress,
    remoteIp: ip
  }
  return r
}

function blockParam(req, stats, pageKey, page, net, db, settings, block, txs, prefix) {
  const r = param(pageKey, page, req, db, settings, prefix)
  r.block = block
  if (stats)
    r.confirmations = stats.count - block.height + 1
  r.txs = txs
  r.block_page = settings.get(net, 'block_page') 
  r.api_page = settings.get(net, 'api_page') 
  return r
}

function txParam(req, pageKey, page, net, db, settings, tx, height, prefix) {
  const r = param(pageKey, page, req, db, settings, prefix)
  const shared_pages = settings.get(net, 'shared_pages')
  r.tx = tx
  r.confirmations = shared_pages.confirmations
  r.blockcount = height
  r.transaction_page = settings.get(net, 'transaction_page')
  r.address_page = settings.get(net, 'address_page')
  r.api_page = settings.get(net, 'api_page') 
  return r
}

function assetsParam(req, pageKey, page, net, db, settings, prefix) {
  const r = param(pageKey, page, req, db, settings, prefix)
  const shared_pages = settings.get(net, 'shared_pages')
  r.assets_page = settings.get(net, 'assets_page')

  // r.tx = tx
  // r.confirmations = shared_pages.confirmations
  // r.blockcount = height
  // r.transaction_page = settings.get(net, 'transaction_page')
  // r.address_page = settings.get(net, 'address_page')
  // r.api_page = settings.get(net, 'api_page') 

  return r
}

function assetParam(req, stats, pageKey, page, net, db, settings, asset, prefix) {
  const shared_pages = settings.get(net, 'shared_pages')
  const r = param(pageKey, page, req, db, settings, prefix)
  r.asset = asset

  r.confirmations = shared_pages.confirmations
  r.blockcount = stats.count

  if (stats)
    r.confirmations = stats.count - asset.blockindex + 1
  // r.txs = txs
  r.asset_page = settings.get(net, 'asset_page') 
  const tx_types = settings.get(net, 'tx_types')
  r.tx_types = tx_types
  // r.api_page = settings.get(net, 'api_page') 
  return r
}

module.exports = router