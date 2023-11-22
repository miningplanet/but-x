const express = require('express')
const router = express.Router()
const settings = require('../lib/settings')
const locale = require('../lib/locale')
const db = require('../lib/database')
const lib = require('../lib/explorer')
const qr = require('qr-image')
const networks = settings.getAllNet()

function route_get_block(res, blockhash, coin, net) {
  lib.get_block(blockhash, function (block) {
    const shared_pages = settings.get(net, 'shared_pages')
    const block_page = settings.get(net, 'block_page')
    const api_page = settings.get(net, 'api_page')
    if (block && block != 'There was an error. Check your console.') {
      if (blockhash == block_page.genesis_block) {
        const p = blockParam('block', coin, net, db, settings, block, 'GENESIS', coin.name + ' Genesis Block')
        res.render('block', p)
      } else {
        db.get_txs(block, function(txs) {
          if (txs.length > 0) {
            const p = blockParam('block', coin, net, db, settings, block, txs, coin.name + ' Block ' + block.height)
            res.render('block', p)
          } else {
            // cannot find block in local database so get the data from the wallet directly
            var ntxs = []
            lib.syncLoop(block.tx.length, function (loop) {
              var i = loop.iteration()

              lib.get_rawtransaction(block.tx[i], function(tx) {
                if (tx && tx != 'There was an error. Check your console.') {
                  lib.prepare_vin(net, tx, function(vin, tx_type_vin) {
                    lib.prepare_vout(net, tx.vout, block.tx[i], vin, ((!settings.blockchain_specific.zksnarks.enabled || typeof tx.vjoinsplit === 'undefined' || tx.vjoinsplit == null) ? [] : tx.vjoinsplit), function(vout, nvin, tx_type_vout) {
                      lib.calculate_total(vout, function(total) {
                        ntxs.push({
                          txid: block.tx[i],
                          vout: vout,
                          total: total.toFixed(8)
                        })
                        loop.next()
                      })
                    })
                  })
                } else
                  loop.next()
              }, net)
            }, function() {
              const p = blockParam('block', coin, net, db, settings, block, ntxs, coin.name + ' Block ' + block.height)
              res.render('block', p)
            })
          }
        }, net)
      }
    } else {
      if (!isNaN(blockhash)) {
        lib.get_blockhash(blockhash, function(hash) {
          if (hash && hash != 'There was an error. Check your console.')
            res.redirect('/block/' + hash + '/' + net)
          else
            route_get_index(res, 'Block not found: ' + blockhash, net)
        }, net)
      } else
        route_get_index(res, 'Block not found: ' + blockhash, net)
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

function route_get_tx(res, txid, coin, net) {
  const transaction_page = settings.get(net, 'transaction_page')
  if (txid == transaction_page.genesis_tx) {
    const block_page = settings.get(net, 'block_page')
    route_get_block(res, block_page.genesis_block, coin, net)
  } else {
    db.get_tx(txid, function(tx) {
      if (tx) {
        lib.get_blockcount(function(blockcount) {
          if (settings.get(net, 'claim_address_page').enabled == true) {
            db.populate_claim_address_names(tx, function(tx) {
              const p = txParam('tx', coin, net, db, settings, tx, (blockcount ? blockcount : 0), coin.name + ' Transaction ' + tx.txid)
              res.render('tx', p)
            }, net)
          } else {
            const p = txParam('tx', coin, net, db, settings, tx, (blockcount ? blockcount : 0), coin.name + ' Transaction ' + tx.txid)
            res.render('tx', p)
          }
        }, net)
      } else {
        lib.get_rawtransaction(txid, function(rtx) {
          if (rtx && rtx.txid) {
            lib.prepare_vin(net, rtx, function(vin, tx_type_vin) {
              lib.prepare_vout(net, rtx.vout, rtx.txid, vin, ((!settings.blockchain_specific.zksnarks.enabled || typeof rtx.vjoinsplit === 'undefined' || rtx.vjoinsplit == null) ? [] : rtx.vjoinsplit), function(rvout, rvin, tx_type_vout) {
                lib.calculate_total(rvout, function(total) {
                  if (!rtx.confirmations > 0) {
                    var utx = {
                      txid: rtx.txid,
                      vin: rvin,
                      vout: rvout,
                      total: total.toFixed(8),
                      timestamp: rtx.time,
                      blockhash: '-',
                      blockindex: -1
                    }

                    if (settings.get(net, 'claim_address_page').enabled == true) {
                      db.populate_claim_address_names(utx, function(utx) {
                        const p = txParam('tx', coin, net, db, settings, utx, -1, coin.name + ' Transaction ' + tx.txid)
                        res.render('tx', p)
                      }, net)
                    } else {
                      const p = txParam('tx', coin, net, db, settings, utx, -1, coin.name + ' Transaction ' + utx.txid)
                      res.render('tx', p)
                    }
                  } else {
                    // check if blockheight exists
                    if (!rtx.blockheight && rtx.blockhash) {
                      // blockheight not found so look up the block
                      lib.get_block(rtx.blockhash, function(block) {
                        if (block && block != 'There was an error. Check your console.') {
                          // create the tx object before rendering
                          var utx = {
                            txid: rtx.txid,
                            vin: rvin,
                            vout: rvout,
                            total: total.toFixed(8),
                            timestamp: rtx.time,
                            blockhash: rtx.blockhash,
                            blockindex: block.height
                          }

                          lib.get_blockcount(function(blockcount) {
                            if (settings.get(net, 'claim_address_page').enabled == true) {
                              db.populate_claim_address_names(utx, function(utx) {
                                const p = txParam('tx', coin, net, db, settings, utx, (blockcount ? blockcount : 0), coin.name + ' Transaction ' + utx.txid)
                                res.render('tx', p)
                              }, net)
                            } else {
                              const p = txParam('tx', coin, net, db, settings, utx, (blockcount ? blockcount : 0), coin.name + ' Transaction ' + utx.txid)
                              res.render('tx', p)
                            }
                          }, net)
                        } else {
                          // cannot load tx
                          route_get_index(res, null, net)
                        }
                      }, net)
                    } else {
                      // create the tx object before rendering
                      var utx = {
                        txid: rtx.txid,
                        vin: rvin,
                        vout: rvout,
                        total: total.toFixed(8),
                        timestamp: rtx.time,
                        blockhash: rtx.blockhash,
                        blockindex: rtx.blockheight
                      }

                      lib.get_blockcount(function(blockcount) {
                        if (settings.get(net, 'claim_address_page').enabled == true) {
                          db.populate_claim_address_names(utx, function(utx) {
                            const p = txParam('tx', coin, net, db, settings, utx, (blockcount ? blockcount : 0), coin.name + ' Transaction ' + utx.txid)
                            res.render('tx', p)
                          }, net)
                        } else {
                          const p = txParam('tx', coin, net, db, settings, utx, (blockcount ? blockcount : 0), coin.name + ' Transaction ' + utx.txid)
                          res.render('tx', p)
                        }
                      }, net)
                    }
                  }
                })
              })
            })
          } else
            route_get_index(res, null, net)
        }, net)
      }
    }, net)
  }
}

function route_get_index(res, error, net=settings.getDefaultNet()) {
  const coin = settings.getCoin(net)
  const index_page = settings.get(net, 'index_page')
  const api_page = settings.get(net, 'api_page')
  const p = param('home', coin, net, db, settings, coin.name + ' Explorer')
  p.error = error
  p.last_updated = null
  p.index_page = index_page
  p.api_page = api_page

  if (index_page.page_header.show_last_updated == true) {
    db.get_stats(coin.name, function (stats) {
      p.last_updated = stats.network_last_updated
      res.render('index', p)
    }, net)
  } else {
    res.render('index', p)
  }
}

function route_get_address(res, hash, coin, net=settings.getDefaultNet()) {
  net = settings.getNet(net)
  const address_page = settings.get(net, 'address_page')
  const claim_address_page = settings.get(net, 'claim_address_page')
  // check if trying to load a special address
  if (hash != null && hash.toLowerCase() != 'coinbase' && ((hash.toLowerCase() == 'hidden_address' && address_page.enable_hidden_address_view == true) || (hash.toLowerCase() == 'unknown_address' && address_page.enable_unknown_address_view == true) || (hash.toLowerCase() != 'hidden_address' && hash.toLowerCase() != 'unknown_address'))) {
    // lookup address in local collection
    db.get_address(hash, false, function(address) {
      const api_page = settings.get( net, 'api_page')
      if (address) {
        const p = param('address', coin, net, db, settings, coin.name + ' Address ' + (address['name'] == null || address['name'] == '' ? address.a_id : address['name']))
        p.address = address
        p.address_page = address_page
        p.api_page = api_page
        p.claim_address_page = claim_address_page
        res.render('address', p)
      }
      else
        route_get_index(res, hash + ' not found', net)
    }, net)
  } else
    route_get_index(res, hash + ' not found', net)
}

function route_get_claim_form(res, hash, coin, net=settings.getDefaultNet()) {
  net = settings.getNet(net)
  const address_page = settings.get(net, 'address_page')
  const claim_address_page = settings.get(net, 'claim_address_page')
  
  if (claim_address_page.enabled == true) {
    // check if a hash was passed in
    if (hash == null || hash == '') {
      // no hash so just load the claim page without an address
      const p = param('claim-address', coin, net, db, settings, coin.name + ' Claim Wallet Address')
      p.hash = hash,
      p.claim_name = ''
      p.address_page = address_page
      p.claim_address_page = claim_address_page
      res.render('claim_address', p)
    } else {
      db.get_address(hash, false, function(address) {
        // load the claim page regardless of whether the address exists or not
        const p = param('claim-address', coin, net, db, settings, coin.name + ' Claim Wallet Address ' + hash)
        p.hash = hash,
        p.claim_name = (address == null || address.name == null ? '' : address.name)
        p.address_page = address_page
        p.claim_address_page = claim_address_page
        res.render('claim_address', p)
      }, net)
    }
  } else
    route_get_address(res, hash, coin, net)
}

/* GET home page(s). */

router.get('/', function(req, res) {
  route_get_index(res, null, 'mainnet')
})

networks.forEach( function(net, index) {
  const enabled = settings.getDbOrNull(net).enabled
  if (enabled) {
    router.get('/' + net, function(req, res) {
      route_get_index(res, null, net)
    })
  }
})

router.get('/info/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true) {  
    const markets_page = settings.get(net, 'markets_page')
    const p = param('info', coin, net, db, settings, coin.name + ' Public API ' + net)
    p.address = 'https://explorer.butkoin.com'
    p.markets_page = markets_page
    p.api_page = api_page
    p.api_cmds = settings.get(net, 'api_cmds')
    p.isButkoin = settings.isButkoin(net)
    p.isMainnet = net == 'mainnet'
    res.render('info', p)
  } else {
    route_get_index(res, null, net)
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

    if (exchange != null && exchange.enabled == true && exchange.trading_pairs.findIndex(p => p.toLowerCase() == coin_symbol.toLowerCase() + '/' + pair_symbol.toLowerCase()) > -1) {
      db.get_markets_summary(function(mmdata) {
        db.get_market(market_id, coin_symbol, pair_symbol, function(data) {
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
          const p = param('markets', coin, net, db, settings, locale.mkt_title.replace('{1}', market_data.market_name + ' (' + coin_symbol + '/' + pair_symbol + ')'))
          p.marketdata =  {
            market_name: market_data.market_name,
            market_logo: market_data.market_logo,
            ext_market_url: ext_market_url,
            referal: referal,
            coin: coin_symbol,
            exchange: pair_symbol,
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
    } else {
      // selected market does not exist or is not enabled so default to the index page
      route_get_index(res, null, net)
    }
  } else {
    // markets page is not enabled so default to the index page
    route_get_index(res, null, net)
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
          db.get_distribution(richlist, stats, function(distribution) {
            const p = param('richlist', coin, net, db, settings, 'Top ' + coin.name + ' Holders, Received and Transactions.')
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
          route_get_index(res, null, net)
        }
      }, net)
    }, net)
  } else {
    // richlist page is not enabled so default to the index page
    route_get_index(res, null, net)
  }
})

// movements page
router.get('/movement/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const movement_page = settings.get(net, 'movement_page')
  if (movement_page.enabled == true) {
    const p = param('movement', coin, net, db, settings, coin.name + ' - Coin Movements')
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
    route_get_index(res, null, net)
  }
})

// network page
router.get('/network/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const network_page = settings.get(net, 'network_page')
  if (network_page.enabled == true) {
    const p = param('network', coin, net, db, settings, coin.name + ' - Network Peers')
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
    route_get_index(res, null, net)
  }
})

// masternode list page
router.get('/masternodes/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const masternodes_page = settings.get(net, 'masternodes_page')
  if (masternodes_page.enabled == true) {
    const p = param('masternodes', coin, net, db, settings, coin.name + ' - Smartnodes')
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
    route_get_index(res, null, net)
  }
})

router.get('/reward/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
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

        const p = param('reward', coin, net, db, settings, coin.name + ' - Reward/Voting Details')
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
    route_get_index(res, null, net)
  }
})

router.get('/tx/:txid/:net?', function(req, res) {
  const net = req.params['net']
  const coin = settings.getCoin(net)
  route_get_tx(res, req.params.txid, coin, net)
})

router.get('/block/:hash/:net?', function(req, res) {
  const net = req.params['net']
  const coin = settings.getCoin(net)
  route_get_block(res, req.params.hash, coin, net)
})

router.get('/claim/:net?', function(req, res) {
  const net = req.params['net']
  const coin = settings.getCoin(net)
  route_get_claim_form(res, '', coin, net)
})

router.get('/claim/:hash/:net?', function(req, res) {
  const net = req.params['net']
  const coin = settings.getCoin(net)
  route_get_claim_form(res, req.params.hash, coin, net)
})

router.get('/address/:hash/:net?', function(req, res) {
  const net = req.params['net']
  const coin = settings.getCoin(net)
  route_get_address(res, req.params.hash, coin, net)
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
                    route_get_index(res, locale.ex_search_error + query, net)
                  }
                }, net)
              }
            }, net)
          }
        }, net)
      }
    } else {
      db.get_address(query, false, function(address) {
        if (address)
          res.redirect('/address/' + address.a_id + '/' + net)
        else {
          lib.get_blockhash(query, function(hash) {
            if (hash && hash != 'There was an error. Check your console.')
              res.redirect('/block/' + hash + '/' + net)
            else
              route_get_index(res, locale.ex_search_error + query, net)
          }, net)
        }
      }, net)
    }
  } else {
    // Search is disabled so load the index page with an error msg
    route_get_index(res, 'Search is disabled', net)
  }
})

router.get('/qr/:string/:net?', function(req, res) {
  const coin = settings.getCoin(req.params['net'])
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

function param(page, coin, net, db, settings, prefix) {
  const shared_pages = settings.get(net, 'shared_pages')
  const r = {
    active: page,
    showSync: db.check_show_sync_message(net),
    customHash: get_file_timestamp('./public/css/custom.scss'),
    styleHash: get_file_timestamp('./public/css/style.scss'),
    themeHash: get_file_timestamp('./public/css/themes/' + shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
    logo: settings.getLogo(net),
    page_title_logo: settings.getTitleLogo(net),
    page_title_prefix: prefix,
    shared_pages: shared_pages,
    coin: coin,
    net: net
  }
  return r
}

function blockParam(page, coin, net, db, settings, block, txs, prefix) {
  const r = param(page, coin, net, db, settings, prefix)
  const shared_pages = settings.get(net, 'shared_pages')
  r.block = block
  r.confirmations = shared_pages.confirmations
  r.txs = txs
  r.block_page = settings.get(net, 'block_page') 
  r.api_page = settings.get(net, 'api_page') 
  return r
}

function txParam(page, coin, net, db, settings, tx, height, prefix) {
  const r = param(page, coin, net, db, settings, prefix)
  const shared_pages = settings.get(net, 'shared_pages')
  r.tx = tx
  r.confirmations = shared_pages.confirmations
  r.blockcount = height
  r.transaction_page = settings.get(net, 'transaction_page')
  r.address_page = settings.get(net, 'address_page')
  r.api_page = settings.get(net, 'api_page') 
  return r
}

module.exports = router