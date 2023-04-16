var express = require('express'),
    router = express.Router(),
    settings = require('../lib/settings'),
    locale = require('../lib/locale'),
    db = require('../lib/database'),
    lib = require('../lib/explorer'),
    qr = require('qr-image');

function route_get_block(res, blockhash, coin, net) {
  lib.get_block(blockhash, function (block) {
    if (block && block != 'There was an error. Check your console.') {
      if (blockhash == settings.block_page.genesis_block)
        res.render(
          'block', 
          {
            active: 'block',
            block: block,
            confirmations: settings.shared_pages.confirmations,
            txs: 'GENESIS',
            showSync: db.check_show_sync_message(),
            customHash: get_file_timestamp('./public/css/custom.scss'),
            styleHash: get_file_timestamp('./public/css/style.scss'),
            themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
            page_title_logo: settings.getTitleLogo(net),
            page_title_prefix: coin.name + ' Genesis Block',
            coin: coin,
            net: net
          }
        );
      else {
        db.get_txs(block, function(txs) {
          if (txs.length > 0)
            res.render(
              'block',
              {
                active: 'block',
                block: block,
                confirmations: settings.shared_pages.confirmations,
                txs: txs,
                showSync: db.check_show_sync_message(),
                customHash: get_file_timestamp('./public/css/custom.scss'),
                styleHash: get_file_timestamp('./public/css/style.scss'),
                themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
                page_title_logo: settings.getTitleLogo(net),
                page_title_prefix: coin.name + ' Block ' + block.height,
                coin: coin,
                net: net
              }
            );
          else {
            // cannot find block in local database so get the data from the wallet directly
            var ntxs = [];

            lib.syncLoop(block.tx.length, function (loop) {
              var i = loop.iteration();

              lib.get_rawtransaction(block.tx[i], function(tx) {
                if (tx && tx != 'There was an error. Check your console.') {
                  lib.prepare_vin(net, tx, function(vin, tx_type_vin) {
                    lib.prepare_vout(net, tx.vout, block.tx[i], vin, ((!settings.blockchain_specific.zksnarks.enabled || typeof tx.vjoinsplit === 'undefined' || tx.vjoinsplit == null) ? [] : tx.vjoinsplit), function(vout, nvin, tx_type_vout) {
                      lib.calculate_total(vout, function(total) {
                        ntxs.push({
                          txid: block.tx[i],
                          vout: vout,
                          total: total.toFixed(8)
                        });

                        loop.next();
                      });
                    });
                  });
                } else
                  loop.next();
              }, net);
            }, function() {
              res.render(
                'block',
                {
                  active: 'block',
                  block: block,
                  confirmations: settings.shared_pages.confirmations,
                  txs: ntxs,
                  showSync: db.check_show_sync_message(),
                  customHash: get_file_timestamp('./public/css/custom.scss'),
                  styleHash: get_file_timestamp('./public/css/style.scss'),
                  themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
                  page_title_logo: settings.getTitleLogo(net),
                  page_title_prefix: coin.name + ' Block ' + block.height,
                  coin: coin,
                  net: net
                }
              );
            });
          }
        }, net);
      }
    } else {
      if (!isNaN(blockhash)) {
        var height = blockhash;

        lib.get_blockhash(height, function(hash) {
          if (hash && hash != 'There was an error. Check your console.')
            res.redirect('/block/' + hash);
          else
            route_get_index(res, 'Block not found: ' + blockhash, net);
        }, net);
      } else
        route_get_index(res, 'Block not found: ' + blockhash, net);
    }
  }, net);
}

function get_file_timestamp(file_name) {
  if (db.fs.existsSync(file_name))
    return parseInt(db.fs.statSync(file_name).mtimeMs / 1000);
  else
    return null;
}

/* GET functions */

function route_get_tx(res, txid, coin, net) {
  if (txid == settings.transaction_page.genesis_tx)
    route_get_block(res, settings.block_page.genesis_block, coin, net);
  else {
    db.get_tx(txid, function(tx) {
      if (tx) {
        lib.get_blockcount(function(blockcount) {
          if (settings.get(net, 'claim_address_page').enabled == true) {
            db.populate_claim_address_names(tx, function(tx) {
              res.render(
                'tx',
                {
                  active: 'tx',
                  tx: tx,
                  confirmations: settings.shared_pages.confirmations,
                  blockcount: (blockcount ? blockcount : 0),
                  showSync: db.check_show_sync_message(),
                  customHash: get_file_timestamp('./public/css/custom.scss'),
                  styleHash: get_file_timestamp('./public/css/style.scss'),
                  themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
                  page_title_logo: settings.getTitleLogo(net),
                  page_title_prefix: coin.name + ' Transaction ' + tx.txid,
                  coin: coin,
                  net: net
                }
              );
            }, net);
          } else
            res.render(
              'tx',
              {
                active: 'tx',
                tx: tx,
                confirmations: settings.shared_pages.confirmations,
                blockcount: (blockcount ? blockcount : 0),
                showSync: db.check_show_sync_message(),
                customHash: get_file_timestamp('./public/css/custom.scss'),
                styleHash: get_file_timestamp('./public/css/style.scss'),
                themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
                page_title_logo: settings.getTitleLogo(net),
                page_title_prefix: coin.name + ' Transaction ' + tx.txid,
                coin: coin,
                net: net
              }
            );
        }, net);
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
                    };

                    if (settings.get(net, 'claim_address_page').enabled == true) {
                      db.populate_claim_address_names(utx, function(utx) {
                        res.render(
                          'tx',
                          {
                            active: 'tx',
                            tx: utx,
                            confirmations: settings.shared_pages.confirmations,
                            blockcount: -1,
                            showSync: db.check_show_sync_message(),
                            customHash: get_file_timestamp('./public/css/custom.scss'),
                            styleHash: get_file_timestamp('./public/css/style.scss'),
                            themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
                            page_title_logo: settings.getTitleLogo(net),
                            page_title_prefix: coin.name + ' Transaction ' + utx.txid,
                            coin: coin,
                            net: net
                          }
                        );
                      }, net);
                    } else
                      res.render(
                        'tx',
                        {
                          active: 'tx',
                          tx: utx,
                          confirmations: settings.shared_pages.confirmations,
                          blockcount: -1,
                          showSync: db.check_show_sync_message(),
                          customHash: get_file_timestamp('./public/css/custom.scss'),
                          styleHash: get_file_timestamp('./public/css/style.scss'),
                          themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
                          page_title_logo: settings.getTitleLogo(net),
                          page_title_prefix: coin.name + ' Transaction ' + utx.txid,
                          coin: coin,
                          net: net
                        }
                      );
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
                          };

                          lib.get_blockcount(function(blockcount) {
                            if (settings.get(net, 'claim_address_page').enabled == true) {
                              db.populate_claim_address_names(utx, function(utx) {
                                res.render(
                                  'tx',
                                  {
                                    active: 'tx',
                                    tx: utx,
                                    confirmations: settings.shared_pages.confirmations,
                                    blockcount: (blockcount ? blockcount : 0),
                                    showSync: db.check_show_sync_message(),
                                    customHash: get_file_timestamp('./public/css/custom.scss'),
                                    styleHash: get_file_timestamp('./public/css/style.scss'),
                                    themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
                                    page_title_logo: settings.getTitleLogo(net),
                                    page_title_prefix: coin.name + ' Transaction ' + utx.txid,
                                    coin: coin,
                                    net: net
                                  }
                                );
                              }, net);
                            } else
                              res.render(
                                'tx',
                                {
                                  active: 'tx',
                                  tx: utx,
                                  confirmations: settings.shared_pages.confirmations,
                                  blockcount: (blockcount ? blockcount : 0),
                                  showSync: db.check_show_sync_message(),
                                  customHash: get_file_timestamp('./public/css/custom.scss'),
                                  styleHash: get_file_timestamp('./public/css/style.scss'),
                                  themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
                                  page_title_logo: settings.getTitleLogo(net),
                                  page_title_prefix: coin.name + ' Transaction ' + utx.txid,
                                  coin: coin,
                                  net: net
                                }
                              );
                          }, net);
                        } else {
                          // cannot load tx
                          route_get_index(res, null, net);
                        }
                      }, net);
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
                      };

                      lib.get_blockcount(function(blockcount) {
                        if (settings.get(net, 'claim_address_page').enabled == true) {
                          db.populate_claim_address_names(utx, function(utx) {
                            res.render(
                              'tx',
                              {
                                active: 'tx',
                                tx: utx,
                                confirmations: settings.shared_pages.confirmations,
                                blockcount: (blockcount ? blockcount : 0),
                                showSync: db.check_show_sync_message(),
                                customHash: get_file_timestamp('./public/css/custom.scss'),
                                styleHash: get_file_timestamp('./public/css/style.scss'),
                                themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
                                page_title_logo: settings.getTitleLogo(net),
                                page_title_prefix: coin.name + ' Transaction ' + utx.txid,
                                coin: coin,
                                net: net
                              }
                            );
                          }, net);
                        } else
                          res.render(
                            'tx',
                            {
                              active: 'tx',
                              tx: utx,
                              confirmations: settings.shared_pages.confirmations,
                              blockcount: (blockcount ? blockcount : 0),
                              showSync: db.check_show_sync_message(),
                              customHash: get_file_timestamp('./public/css/custom.scss'),
                              styleHash: get_file_timestamp('./public/css/style.scss'),
                              themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
                              page_title_logo: settings.getTitleLogo(net),
                              page_title_prefix: coin.name + ' Transaction ' + utx.txid,
                              coin: coin,
                              net: net
                            }
                          );
                      }, net);
                    }
                  }
                });
              });
            });
          } else
            route_get_index(res, null, net);
        }, net);
      }
    }, net);
  }
}

function route_get_index(res, error, net='mainnet') {
  const coin = settings.getCoin(net)
  if (settings.index_page.page_header.show_last_updated == true) {
    // lookup last updated date
    db.get_stats(coin.name, function (stats) {
      res.render(
        'index',
        {
          active: 'home',
          error: error,
          last_updated: stats.blockchain_last_updated,
          showSync: db.check_show_sync_message(),
          customHash: get_file_timestamp('./public/css/custom.scss'),
          styleHash: get_file_timestamp('./public/css/style.scss'),
          themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
          page_title_logo: settings.getTitleLogo(net),
          page_title_prefix: coin.name + ' Explorer',
          coin: coin,
          net: net
        }
      );
    }, net);
  } else {
    // skip lookup of the last updated date and display the page now
    res.render(
      'index',
      {
        active: 'home',
        error: error,
        last_updated: null,
        showSync: db.check_show_sync_message(),
        customHash: get_file_timestamp('./public/css/custom.scss'),
        styleHash: get_file_timestamp('./public/css/style.scss'),
        themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
        page_title_logo: settings.getTitleLogo(net),
        page_title_prefix: coin.name + ' Explorer',
        coin: coin,
        net: net
      }
    );
  }
}

function route_get_address(res, hash, coin, net='mainnet') {
  net = settings.getNet(net)
  // check if trying to load a special address
  if (hash != null && hash.toLowerCase() != 'coinbase' && ((hash.toLowerCase() == 'hidden_address' && settings.address_page.enable_hidden_address_view == true) || (hash.toLowerCase() == 'unknown_address' && settings.address_page.enable_unknown_address_view == true) || (hash.toLowerCase() != 'hidden_address' && hash.toLowerCase() != 'unknown_address'))) {
    // lookup address in local collection
    db.get_address(hash, false, function(address) {
      if (address)
        res.render(
          'address',
          {
            active: 'address',
            address: address,
            showSync: db.check_show_sync_message(),
            customHash: get_file_timestamp('./public/css/custom.scss'),
            styleHash: get_file_timestamp('./public/css/style.scss'),
            themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
            page_title_logo: settings.getTitleLogo(net),
            page_title_prefix: coin.name + ' Address ' + (address['name'] == null || address['name'] == '' ? address.a_id : address['name']),
            coin: coin,
            net: net
          }
        );
      else
        route_get_index(res, hash + ' not found', net);
    }, net);
  } else
    route_get_index(res, hash + ' not found', net);
}

function route_get_claim_form(res, hash, coin, net='mainnet') {
  net = settings.getNet(net)
  if (settings.get(net, 'claim_address_page').enabled == true) {
    // check if a hash was passed in
    if (hash == null || hash == '') {
      // no hash so just load the claim page without an address
      res.render(
        'claim_address',
        {
          active: 'claim-address',
          hash: hash,
          claim_name: '',
          showSync: db.check_show_sync_message(),
          customHash: get_file_timestamp('./public/css/custom.scss'),
          styleHash: get_file_timestamp('./public/css/style.scss'),
          themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
          page_title_logo: settings.getTitleLogo(net),
          page_title_prefix: coin.name + ' Claim Wallet Address',
          coin: coin,
          net: net
        }
      );
    } else {
      // lookup hash in the address collection
      db.get_address(hash, false, function(address) {
        // load the claim page regardless of whether the address exists or not
        res.render(
          'claim_address',
          {
            active: 'claim-address',
            hash: hash,
            claim_name: (address == null || address.name == null ? '' : address.name),
            showSync: db.check_show_sync_message(),
            customHash: get_file_timestamp('./public/css/custom.scss'),
            styleHash: get_file_timestamp('./public/css/style.scss'),
            themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
            page_title_logo: settings.getTitleLogo(net),
            page_title_prefix: coin.name + ' Claim Wallet Address ' + hash,
            coin: coin,
            net: net
          }
        );
      }, net);
    }
  } else
    route_get_address(res, hash, coin, net);
}

/* GET home page. */

// TODO: Fix index routes.
router.get('/', function(req, res) {
  route_get_index(res, null, 'mainnet');
});
router.get('/mainnet', function(req, res) {
  route_get_index(res, null, 'mainnet');
});
router.get('/testnet', function(req, res) {
  route_get_index(res, null, 'testnet');
});

router.get('/info/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  if (settings.api_page.enabled == true) {
    // load the api page
    res.render(
      'info',
      { // req.headers.host
        active: 'info',
        address: 'https://explorer.butkoin.com',
        showSync: db.check_show_sync_message(),
        customHash: get_file_timestamp('./public/css/custom.scss'),
        styleHash: get_file_timestamp('./public/css/style.scss'),
        themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
        page_title_logo: settings.getTitleLogo(net),
        page_title_prefix: coin.name + ' Public API ' + net,
        coin: coin,
        net: net
      }
    );
  } else {
    route_get_index(res, null, net);
  }
});

router.get('/markets/:market/:coin_symbol/:pair_symbol/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)

  // ensure markets page is enabled
  if (settings.markets_page.enabled == true) {
    var market_id = req.params['market'];
    var coin_symbol = req.params['coin_symbol'];
    var pair_symbol = req.params['pair_symbol'];

    // check if the market and trading pair exists and market is enabled in settings.json
    if (settings.markets_page.exchanges[market_id] != null && settings.markets_page.exchanges[market_id].enabled == true && settings.markets_page.exchanges[market_id].trading_pairs.findIndex(p => p.toLowerCase() == coin_symbol.toLowerCase() + '/' + pair_symbol.toLowerCase()) > -1) {
      // lookup market data
      db.get_market(market_id, coin_symbol, pair_symbol, function(data) {
        // load market data
        var market_data = require('../lib/markets/' + market_id);
        var isAlt = false;
        var url = '';

        // build the external exchange url link and determine if using the alt name + logo
        if (market_data.market_url_template != null && market_data.market_url_template != '') {
          switch ((market_data.market_url_case == null || market_data.market_url_case == '' ? 'l' : market_data.market_url_case.toLowerCase())) {
            case 'l':
            case 'lower':
              url = market_data.market_url_template.replace('{base}', pair_symbol.toLowerCase()).replace('{coin}', coin_symbol.toLowerCase()).replace('{url_prefix}', (market_data.market_url != null ? market_data.market_url({coin: coin_symbol.toLowerCase(), exchange: pair_symbol.toLowerCase()}) : ''));
              isAlt = (market_data.isAlt != null ? market_data.isAlt({coin: coin_symbol.toLowerCase(), exchange: pair_symbol.toLowerCase()}) : false);
              break;
            case 'u':
            case 'upper':
              url = market_data.market_url_template.replace('{base}', pair_symbol.toUpperCase()).replace('{coin}', coin_symbol.toUpperCase()).replace('{url_prefix}', (market_data.market_url != null ? market_data.market_url({coin: coin_symbol.toUpperCase(), exchange: pair_symbol.toUpperCase()}) : ''));
              isAlt = (market_data.isAlt != null ? market_data.isAlt({coin: coin_symbol.toUpperCase(), exchange: pair_symbol.toUpperCase()}) : false);
              break;
            default:
          }
        }

        var market_name = (isAlt ? (market_data.market_name_alt == null ? '' : market_data.market_name_alt) : (market_data.market_name == null ? '' : market_data.market_name));
        var market_logo = (isAlt ? (market_data.market_logo_alt == null ? '' : market_data.market_logo_alt) : (market_data.market_logo == null ? '' : market_data.market_logo));
        var ext_market_url = market_data.ext_market_url == null ? '' : market_data.ext_market_url;
        var referal = market_data.referal == null ? '' : market_data.referal;

        // check if markets page should show last updated date
        if (settings.markets_page.page_header.show_last_updated == true) {
          // lookup last updated date
          db.get_stats(coin.name, function (stats) {
            res.render(
              './market',
              {
                active: 'markets',
                marketdata: {
                  market_name: market_name,
                  market_logo: market_logo,
                  ext_market_url: ext_market_url,
                  referal: referal,
                  coin: coin_symbol,
                  exchange: pair_symbol,
                  data: data,
                  url: url
                },
                market: market_id,
                last_updated: stats.markets_last_updated,
                showSync: db.check_show_sync_message(),
                customHash: get_file_timestamp('./public/css/custom.scss'),
                styleHash: get_file_timestamp('./public/css/style.scss'),
                themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
                page_title_logo: settings.getTitleLogo(net),
                page_title_prefix: locale.mkt_title.replace('{1}', market_name + ' (' + coin_symbol + '/' + pair_symbol + ')'),
                coin: coin,
                net: net
              }
            );
          }, net);
        } else {
          // skip looking up the last updated date and display the page now
          res.render(
            './market',
            {
              active: 'markets',
              marketdata: {
                market_name: market_name,
                market_logo: market_logo,
                ext_market_url: ext_market_url,
                referal: referal,
                coin: coin_symbol,
                exchange: pair_symbol,
                data: data,
                url: url
              },
              market: market_id,
              last_updated: null,
              showSync: db.check_show_sync_message(),
              customHash: get_file_timestamp('./public/css/custom.scss'),
              styleHash: get_file_timestamp('./public/css/style.scss'),
              themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
              page_title_logo: settings.getTitleLogo(net),
              page_title_prefix: locale.mkt_title.replace('{1}', market_name + ' (' + coin_symbol + '/' + pair_symbol + ')'),
              coin: coin,
              net: net
            }
          );
        }
      }, net);
    } else {
      // selected market does not exist or is not enabled so default to the index page
      route_get_index(res, null, net);
    }
  } else {
    // markets page is not enabled so default to the index page
    route_get_index(res, null, net);
  }
});

router.get('/richlist/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  if (settings.richlist_page.enabled == true) {
    db.get_stats(coin.name, function (stats) {
      db.get_richlist(coin.name, function(richlist) {
        if (richlist) {
          db.get_distribution(richlist, stats, function(distribution) {
            res.render(
              'richlist',
              {
                active: 'richlist',
                balance: richlist.balance,
                received: richlist.received,
                burned: richlist.burned,
                stats: stats,
                dista: distribution.t_1_25,
                distb: distribution.t_26_50,
                distc: distribution.t_51_75,
                distd: distribution.t_76_100,
                diste: distribution.t_101plus,
                last_updated: (settings.richlist_page.page_header.show_last_updated == true ? stats.richlist_last_updated : null),
                showSync: db.check_show_sync_message(),
                customHash: get_file_timestamp('./public/css/custom.scss'),
                styleHash: get_file_timestamp('./public/css/style.scss'),
                themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
                page_title_logo: settings.getTitleLogo(net),
                page_title_prefix: 'Top ' + coin.name + ' Holders',
                coin: coin,
                net: net
              }
            );
          }, net);
        } else {
          // richlist data not found so default to the index page
          route_get_index(res, null, net);
        }
      }, net);
    }, net);
  } else {
    // richlist page is not enabled so default to the index page
    route_get_index(res, null, net);
  }
});

router.get('/movement/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  if (settings.movement_page.enabled == true) {
    if (settings.movement_page.page_header.show_last_updated == true) {
      // lookup last updated date
      db.get_stats(coin.name, function (stats) {
        res.render(
          'movement',
          {
            active: 'movement',
            last_updated: stats.blockchain_last_updated,
            showSync: db.check_show_sync_message(),
            customHash: get_file_timestamp('./public/css/custom.scss'),
            styleHash: get_file_timestamp('./public/css/style.scss'),
            themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
            page_title_logo: settings.getTitleLogo(net),
            page_title_prefix: coin.name + ' Coin Movements',
            coin: coin,
            net: net
          }
        );
      }, net);
    } else {
      // skip lookup of the last updated date and display the page now
      res.render(
        'movement',
        {
          active: 'movement',
          last_updated: null,
          showSync: db.check_show_sync_message(),
          customHash: get_file_timestamp('./public/css/custom.scss'),
          styleHash: get_file_timestamp('./public/css/style.scss'),
          themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
          page_title_logo: settings.getTitleLogo(net),
          page_title_prefix: coin.name + ' Coin Movements',
          coin: coin,
          net: net
        }
      );
    }
  } else {
    // movement page is not enabled so default to the index page
    route_get_index(res, null, net);
  }
});

router.get('/network/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  if (settings.network_page.enabled == true) {
    if (settings.network_page.page_header.show_last_updated == true) {
      // lookup last updated date
      db.get_stats(coin.name, function (stats) {
        res.render(
          'network',
          {
            active: 'network',
            last_updated: stats.network_last_updated,
            showSync: db.check_show_sync_message(),
            customHash: get_file_timestamp('./public/css/custom.scss'),
            styleHash: get_file_timestamp('./public/css/style.scss'),
            themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
            page_title_logo: settings.getTitleLogo(net),
            page_title_prefix: coin.name + ' Network Peers',
            coin: coin,
            net: net
          }
        );
      }, net);
    } else {
      // skip lookup of the last updated date and display the page now
      res.render(
        'network',
        {
          active: 'network',
          last_updated: null,
          showSync: db.check_show_sync_message(),
          customHash: get_file_timestamp('./public/css/custom.scss'),
          styleHash: get_file_timestamp('./public/css/style.scss'),
          themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
          page_title_logo: settings.getTitleLogo(net),
          page_title_prefix: coin.name + ' Network Peers',
          coin: coin,
          net: net
        }
      );
    }
  } else {
    // network page is not enabled so default to the index page
    route_get_index(res, null, net);
  }
});

// masternode list page
router.get('/masternodes/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  if (settings.masternodes_page.enabled == true) {
    if (settings.masternodes_page.page_header.show_last_updated == true) {
      // lookup last updated date
      db.get_stats(coin.name, function (stats) {
        res.render(
          'masternodes',
          {
            active: 'masternodes',
            last_updated: stats.masternodes_last_updated,
            showSync: db.check_show_sync_message(),
            customHash: get_file_timestamp('./public/css/custom.scss'),
            styleHash: get_file_timestamp('./public/css/style.scss'),
            themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
            page_title_logo: settings.getTitleLogo(net),
            page_title_prefix: coin.name + ' Smartnodes',
            coin: coin,
            net: net
          }
        );
      }, net);
    } else {
      // skip lookup of the last updated date and display the page now
      res.render(
        'masternodes',
        {
          active: 'masternodes',
          last_updated: null,
          showSync: db.check_show_sync_message(),
          customHash: get_file_timestamp('./public/css/custom.scss'),
          styleHash: get_file_timestamp('./public/css/style.scss'),
          themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
          page_title_logo: settings.getTitleLogo(net),
          page_title_prefix: coin.name + ' Smartnodes',
          coin: coin,
          net: net
        }
      );
    }
  } else {
    // masternode page is not enabled so default to the index page
    route_get_index(res, null, net);
  }
});

router.get('/reward/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  if (settings.blockchain_specific.heavycoin.enabled == true && settings.blockchain_specific.heavycoin.reward_page.enabled == true) {
    db.get_stats(coin.name, function (stats) {
      db.get_heavy(coin.name, function (heavy) {
        if (!heavy)
          heavy = { coin: coin.name, lvote: 0, reward: 0, supply: 0, cap: 0, estnext: 0, phase: 'N/A', maxvote: 0, nextin: 'N/A', votes: [] };

        var votes = heavy.votes;

        votes.sort(function (a, b) {
          if (a.count < b.count)
            return -1;
          else if (a.count > b.count)
            return 1;
          else
            return 0;
        });

        res.render(
          'reward',
          {
            active: 'reward',
            stats: stats,
            heavy: heavy,
            votes: votes,
            last_updated: (settings.blockchain_specific.heavycoin.reward_page.page_header.show_last_updated == true ? stats.reward_last_updated : null),
            showSync: db.check_show_sync_message(),
            customHash: get_file_timestamp('./public/css/custom.scss'),
            styleHash: get_file_timestamp('./public/css/style.scss'),
            themeHash: get_file_timestamp('./public/css/themes/' + settings.shared_pages.theme.toLowerCase() + '/bootstrap.min.css'),
            page_title_logo: settings.getTitleLogo(net),
            page_title_prefix: coin.name + ' Reward/Voting Details',
            coin: coin,
            net: net
          }
        );
      }, net);
    }, net);
  } else {
    // reward page is not enabled so default to the index page
    route_get_index(res, null, net);
  }
});

router.get('/tx/:txid/:net?', function(req, res) {
  const net = req.params['net']
  const coin = settings.getCoin(net)
  route_get_tx(res, req.params.txid, coin, net);
});

router.get('/block/:hash/:net?', function(req, res) {
  const net = req.params['net']
  const coin = settings.getCoin(net)
  route_get_block(res, req.params.hash, coin, net);
});

router.get('/claim/:net?', function(req, res) {
  const net = req.params['net']
  const coin = settings.getCoin(net)
  route_get_claim_form(res, '', coin, net);
});

router.get('/claim/:hash/:net?', function(req, res) {
  const net = req.params['net']
  const coin = settings.getCoin(net)
  route_get_claim_form(res, req.params.hash, coin, net);
});

router.get('/address/:hash/:net?', function(req, res) {
  const net = req.params['net']
  const coin = settings.getCoin(net)
  route_get_address(res, req.params.hash, coin, net);
});

router.post('/search/:net?', function(req, res) {
  const net = req.params['net']
  const coin = settings.getCoin(net)
  if (settings.shared_pages.page_header.search.enabled == true) {
    var query = req.body.search.trim();

    if (query.length == 64) {
      if (query == settings.transaction_page.genesis_tx)
        res.redirect('/block/' + settings.block_page.genesis_block + '/' + net);
      else {
        db.get_tx(query, function(tx) {
          if (tx)
            res.redirect('/tx/' + tx.txid + '/' + net);
          else {
            lib.get_block(query, function(block) {
              if (block && block != 'There was an error. Check your console.')
                res.redirect('/block/' + query + '/' + net);
              else {
                // check wallet for transaction
                lib.get_rawtransaction(query, function(tx) {
                  if (tx && tx.txid)
                    res.redirect('/tx/' + tx.txid + '/' + net);
                  else {
                    // search found nothing so display the index page with an error msg
                    route_get_index(res, locale.ex_search_error + query, net);
                  }
                }, net);
              }
            }, net);
          }
        }, net);
      }
    } else {
      db.get_address(query, false, function(address) {
        if (address)
          res.redirect('/address/' + address.a_id + '/' + net);
        else {
          lib.get_blockhash(query, function(hash) {
            if (hash && hash != 'There was an error. Check your console.')
              res.redirect('/block/' + hash + '/' + net);
            else
              route_get_index(res, locale.ex_search_error + query, net);
          }, net);
        }
      }, net);
    }
  } else {
    // Search is disabled so load the index page with an error msg
    route_get_index(res, 'Search is disabled', net);
  }
});

router.get('/qr/:string/:net?', function(req, res) {
  const coin = settings.getCoin(req.params['net'])
  if (req.params.string) {
    var address = qr.image(req.params.string, {
      type: 'png',
      size: 4,
      margin: 1,
      ec_level: 'M'
    });

    res.type('png');
    address.pipe(res);
  }
});

module.exports = router;