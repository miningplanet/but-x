const debug = require('debug')('debug')
const debugChart = require('debug')('chart')
const express = require('express')
const path = require('path')
const nodeapi = require('./lib/nodeapi')
const favicon = require('serve-favicon')
const serveStatic = require('serve-static')
const logger = require('morgan')
const cookieParser = require('cookie-parser')
const bodyParser = require('body-parser')
const settings = require('./lib/settings')
const routes = require('./routes/index')
const lib = require('./lib/x')
const db = require('./lib/database')
const package_metadata = require('./package.json')
const locale = require('./lib/locale')
const TTLCache = require('@isaacs/ttlcache')
const app = express()
const apiAccessList = []
const { exec } = require('child_process')
const networks = settings.getAllNet()
const request = require('postman-request')
const base_server = 'http://127.0.0.1:' + settings.webserver.port + "/"
const base_url = base_server + '' // api/

// application cache
const wlength = settings.wallets.length
const foreverCache = new TTLCache({ max: 10, ttl: Infinity, updateAgeOnGet: false, noUpdateTTL: false })
const summaryCache = new TTLCache({ max: wlength, ttl: settings.cache.summary * 1000, updateAgeOnGet: false, noUpdateTTL: false })
const networkChartCache = new TTLCache({ max: wlength, ttl: settings.cache.network_chart * 1000, updateAgeOnGet: false, noUpdateTTL: false })
const statsCache = new TTLCache({ max: wlength, ttl: settings.cache.stats * 1000, updateAgeOnGet: false, noUpdateTTL: false })
const supplyCache = new TTLCache({ max: wlength, ttl: settings.cache.supply * 1000, updateAgeOnGet: false, noUpdateTTL: false })
const pricesCache = new TTLCache({ max: wlength * 2, ttl: settings.cache.prices * 1000, updateAgeOnGet: false, noUpdateTTL: false })
const tickerCache = new TTLCache({ max: wlength, ttl: settings.cache.ticker * 1000, updateAgeOnGet: false, noUpdateTTL: false })
const balancesCache = new TTLCache({ max: 100, ttl: settings.cache.balances * 1000, updateAgeOnGet: false, noUpdateTTL: false })
const distributionCache = new TTLCache({ max: wlength, ttl: settings.cache.distribution * 1000, updateAgeOnGet: false, noUpdateTTL: false })
const peersCache = new TTLCache({ max: wlength, ttl: settings.cache.peers * 1000, updateAgeOnGet: false, noUpdateTTL: false })
const masternodesCache = new TTLCache({ max: wlength, ttl: settings.cache.masternodes * 1000, updateAgeOnGet: false, noUpdateTTL: false })
const allnetCache = new TTLCache({ max: 10, ttl: settings.cache.allnet, updateAgeOnGet: false, noUpdateTTL: false })

// pass wallet rpc connections info to nodeapi
nodeapi.setWalletDetails(settings.wallets)

// dynamically build the nodeapi cmd access list by adding all non-blockchain-specific api cmds that have a value
networks.forEach( function(item, index) {
  const api_cmds = settings.get(item, 'api_cmds')
  Object.keys(api_cmds).forEach(function(key, index, map) {
    if (key != 'use_rpc' && api_cmds[key] != null && api_cmds[key] != '')
      apiAccessList.push(item + "@" + key);
  });
});

// dynamically find and add additional blockchain_specific api cmds
Object.keys(settings.blockchain_specific).forEach(function(key, index, map) {
  // check if this feature is enabled and has api cmds
  if (settings.blockchain_specific[key].enabled == true && Object.keys(settings.blockchain_specific[key]).indexOf('api_cmds') > -1) {
    // add all blockchain specific api cmds that have a value
    Object.keys(settings.blockchain_specific[key]['api_cmds']).forEach(function(key2, index, map) {
      if (settings.blockchain_specific[key]['api_cmds'][key2] != null && settings.blockchain_specific[key]['api_cmds'][key2] != '')
        apiAccessList.push(key2);
    });
  }
});
// whitelist the cmds in the nodeapi access list
nodeapi.setAccess('only', apiAccessList);

// determine if cors should be enabled
if (settings.webserver.cors.enabled == true) {
  app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", settings.webserver.cors.corsorigin);
    res.header('Access-Control-Allow-Methods', 'DELETE, PUT, GET, POST');
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
  });
}

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// security
app.disable('x-powered-by')

function setCustomCacheControl (res, path) {
  if (serveStatic.mime.lookup(path) === 'text/html') {
    // Cache HTML files.
    res.setHeader('Cache-Control', 'public, max-age=30')
  }
}

// Always use Butkoin favicon.
app.use(favicon(path.join('./public', settings.shared_pages.favicons.favicon32)));
app.use(serveStatic(path.join(__dirname, 'public'), {
  maxAge: '1d',
  setHeaders: setCustomCacheControl
}))
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// // RPC API by DB.
// // -> get_difficulty  // only sync.js
// app.use('/api/getblockchaininfo/:net?', function(req, res) {
//   const net = settings.getNet(req.params['net'])
//   const coin = settings.getCoin(net)
//   db.get_stats(coin.name, function(stats) {
//     if (stats)
//       return res.end("HOHO1")
//     else
//       return res.end("ERROR")
//   })
// })

// // RPC API by DB.
// only API
// app.use('/api/getmininginfo/:net?', function(req, res) {
//   const net = settings.getNet(req.params['net'])
//   const coin = settings.getCoin(net)
//   db.get_stats(coin.name, function(stats) {
//     if (stats)
//       return res.end("HOHO2")
//     else
//       return res.end("ERROR")
//   })
// })

// routes
app.use('/api', nodeapi.app);
// app.use('/:net?', routes);
app.use('/', routes);

// post method to claim an address using verifymessage functionality
app.post('/claim/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  // check if the bad-words filter is enabled
  if (settings.get(net, 'claim_address_page').enable_bad_word_filter == true) {
    // initialize the bad-words filter
    var bad_word_lib = require('bad-words');
    var bad_word_filter = new bad_word_lib();

    // clean the message (Display name) of bad words
    var message = (req.body.message == null || req.body.message == '' ? '' : bad_word_filter.clean(req.body.message));
  } else {
    // Do not use the bad word filter
    var message = (req.body.message == null || req.body.message == '' ? '' : req.body.message);
  }

  // check if the message was filtered
  if (message == req.body.message) {
    // call the verifymessage api
    lib.verify_message(net, req.body.address, req.body.signature, req.body.message, function(body) {
      if (body == false)
        res.json({'status': 'failed', 'error': true, 'message': 'Invalid signature'});
      else if (body == true) {
        db.update_label(req.body.address, req.body.message, function(val) {
          // check if the update was successful
          if (val == '')
            res.json({'status': 'success'});
          else if (val == 'no_address')
            res.json({'status': 'failed', 'error': true, 'message': 'Wallet address ' + req.body.address + ' is not valid or does not have any transactions'});
          else
            res.json({'status': 'failed', 'error': true, 'message': 'Wallet address or signature is invalid'});
        }, net);
      } else
        res.json({'status': 'failed', 'error': true, 'message': 'Wallet address or signature is invalid'});
    });
  } else {
    // message was filtered which would change the signature
    res.json({'status': 'failed', 'error': true, 'message': 'Display name contains bad words and cannot be saved: ' + message});
  }
});

// extended apis
app.use('/ext/getmoneysupply/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true && api_page.public_apis.ext.getmoneysupply.enabled == true) {
    const coin = settings.getCoin(net)
    const r = supplyCache.get(net);
    if (r == undefined) {
      db.get_stats(coin.name, function (stats) {
        supplyCache.set(net, stats.supply);
        debug("Cached supply '%s' %o - mem: %o", net, stats, process.memoryUsage());
        res.setHeader('content-type', 'text/plain');
        res.end((stats && stats.supply ? stats.supply.toString() : '0'));
      }, net);
    } else {
      debug("Get supply by cache '%s' %o ...", net, r.supply);
      res.setHeader('content-type', 'text/plain');
      res.end((r ? r.toString() : '0'));
    }
  } else
    res.end('This method is disabled');
});

app.use('/ext/getaddress/:hash/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true && api_page.public_apis.ext.getaddress.enabled == true) {
    db.get_address(req.params.hash, false, function(address) {
      db.get_address_txs_ajax(req.params.hash, 0, api_page.public_apis.ext.getaddresstxs.max_items_per_query, function(txs, count) {
        if (address) {
          var last_txs = [];

          for (i = 0; i < txs.length; i++) {
            if (typeof txs[i].txid !== "undefined") {
              var out = 0,
                  vin = 0,
                  tx_type = 'vout',
                  row = {};

              txs[i].vout.forEach(function (r) {
                if (r.addresses == req.params.hash)
                  out += r.amount;
              });

              txs[i].vin.forEach(function (s) {
                if (s.addresses == req.params.hash)
                  vin += s.amount;
              });

              if (vin > out)
                tx_type = 'vin';

              row['addresses'] = txs[i].txid;
              row['type'] = tx_type;
              last_txs.push(row);
            }
          }

          var a_ext = {
            address: address.a_id,
            sent: (address.sent / 100000000),
            received: (address.received / 100000000),
            balance: (address.balance / 100000000).toString().replace(/(^-+)/mg, ''),
            last_txs: last_txs,
            coin: coin,
            net: net
          };

          res.send(a_ext);
        } else
          res.send({ error: 'address not found.', hash: req.params.hash, coin: coin, net: net});
      }, net);
    }, net);
  } else
    res.end('This method is disabled');
});

app.use('/ext/gettx/:txid/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true && api_page.public_apis.ext.gettx.enabled == true) {
    var txid = req.params.txid;

    db.get_tx(txid, function(tx) {
      const shared_pages = settings.get(net, 'shared_pages')
      if (tx && tx != null) {
        db.get_stats(coin.name, function (stats) {
          res.send({ active: 'tx', tx: tx, confirmations: shared_pages.confirmations, blockcount: (stats && !isNaN(stats.count) ? stats.count : 0), coin: coin, net: net})
        }, net)
      } else {
        // TODO: Only get by DB.
        lib.get_rawtransaction(txid, function(rtx) {
          if (rtx && rtx != null && rtx.txid) {
            lib.prepare_vin(net, rtx, function(vin, tx_type_vin) {
              lib.prepare_vout(rtx.vout, rtx.txid, vin, ((typeof rtx.vjoinsplit === 'undefined' || rtx.vjoinsplit == null) ? [] : rtx.vjoinsplit), function(rvout, rvin, tx_type_vout) {
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

                    res.send({ active: 'tx', tx: utx, confirmations: shared_pages.confirmations, blockcount:-1, coin: coin, net: net});
                  } else {
                    var utx = {
                      txid: rtx.txid,
                      vin: rvin,
                      vout: rvout,
                      total: total.toFixed(8),
                      timestamp: rtx.time,
                      blockhash: rtx.blockhash,
                      blockindex: rtx.blockheight
                    };

                    db.get_stats(coin.name, function (stats) {
                      res.send({ active: 'tx', tx: utx, confirmations: shared_pages.confirmations, blockcount: (stats && !isNaN(stats.count) ? stats.count : 0), coin: coin, net: net});
                    }, net);
                  }
                });
              });
            });
          } else
            res.send({ error: 'tx not found.', hash: txid, coin: coin, net: net});
        }, net);
      }
    }, net);
  } else
    res.end('This method is disabled');
});

app.use('/ext/getbalance/:hash/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true && api_page.public_apis.ext.getbalance.enabled == true) {
    const hash = req.params.hash
    const coin = settings.getCoin(net)
    const r = balancesCache.get(net + '_' + hash);
    if (r == undefined) {
      db.get_address(hash, false, function(address) {
        if (address) {
          balancesCache.set(net + '_' + hash, address.balance)
          debug("Cached balance '%s' '%s' %o - mem: %o", net, hash, address.balance, process.memoryUsage());
          res.setHeader('content-type', 'text/plain');
          res.end((address.balance / 100000000).toString().replace(/(^-+)/mg, ''));
        } else
          res.send({ error: 'address not found.', hash: hash, coin: coin, net: net });
      }, net);
    } else {
      debug("Get balance by cache '%s' '%s' %o", net, hash, r);
      res.setHeader('content-type', 'text/plain');
      res.end((r / 100000000).toString().replace(/(^-+)/mg, ''));
    }
  } else
    res.end('This method is disabled');
});

app.use('/ext/getdistribution/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true && api_page.public_apis.ext.getdistribution.enabled == true) {
    const coin = settings.getCoin(net)
    const r = distributionCache.get(net);
    if (r == undefined) {
      db.get_richlist(coin.name, function(richlist) {
        db.get_stats(coin.name, function(stats) {
          db.get_distribution(richlist, stats, function(dist) {
            debug("Cached distribution '%s' %o - mem: %o", net, dist, process.memoryUsage());
            distributionCache.set(net, dist);
            res.send(dist);
          }, net);
        }, net);
      }, net);
    } else {
      debug("Get distribution by cache '%s' %o ...", net, r.supply);
      res.send(r);
    }
  } else
    res.end('This method is disabled');
});

app.use('/ext/getcurrentprice/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true && api_page.public_apis.ext.getcurrentprice.enabled == true) {
    const defaultExchangeCurrencyPrefix = settings.get(net, 'markets_page').default_exchange.trading_pair.split('/')[1].toLowerCase();
    if (settings.cache.enabled == true) {
      const coin = settings.getCoin(net)
      var r = pricesCache.get(net);
      if (r == undefined) {
        db.get_stats(coin.name, function (stats) {
          r = {}
          r.last_updated=new Date().toUTCString().replace('GMT', 'UTC')
          r.rates = [];
          ratesPush(r.rates, settings.currencies, 'USD', stats.last_usd_price)
          ratesPush(r.rates, settings.currencies, 'USDT', stats.last_price)
          lib.get_exchange_rates(function(error, data) {
            if (error) {
              console.log(error);
            } else if (data == null || typeof data != 'object') {
              console.log('Error: exchange rates API did not return a valid object');
            } else {
              // Cache all exchange rates and add by config
              pricesCache.set(net + '_data', data);
              for (var item in settings.currencies) {
                if (data.rates && data.rates[item] && item.toLowerCase() != defaultExchangeCurrencyPrefix && item.toLowerCase() != 'usd') {
                  ratesPush(r.rates, settings.currencies, item, Number.parseFloat(stats.last_usd_price) * Number.parseFloat(data.rates[item]))
                }
              };
              pricesCache.set (net, r);
              debug("Cached prices '%s' %o - mem: %o", net, r, process.memoryUsage());
              res.send(r);
            }
          });
        }, net);
      } else {
        debug("Get prices by cache '%s' %o ...", net, r.last_updated);
        res.send(r);
      }
    } else {
      db.get_stats(coin.name, function (stats) {
        r = {}
        r.last_updated=new Date().toUTCString().replace('GMT', 'UTC')
        r.rates = [];
        ratesPush(r.rates, settings.currencies, 'USD', stats.last_usd_price)
        ratesPush(r.rates, settings.currencies, 'USDT', stats.last_price)
        lib.get_exchange_rates(function(error, data) {
          if (error) {
            console.log(error);
          } else if (data == null || typeof data != 'object') {
            console.log('Error: exchange rates api did not return a valid object');
          } else {
            for (var item in settings.currencies) {
              if (data.rates && data.rates[item] && item.toLowerCase() != defaultExchangeCurrencyPrefix && item.toLowerCase() != 'usd') {
                ratesPush(r.rates, settings.currencies, item, Number.parseFloat(stats.last_usd_price) * Number.parseFloat(data.rates[item]))
              }
            };
            debug("Get prices by cache '%s' %o ...", net, r.last_updated);
            res.send(r);
          }
        });
      }, net);
    }
  } else {
    res.end('This method is disabled');
  }
});

function ratesPush(rates, currencies, item, price) {
  rates.push({
    "code": currencies[item].code,
    "symbol": currencies[item].symbol,
    "rate": price,
    "name": currencies[item].name,
  });
}

app.use('/ext/getbasicstats/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  if (api_page.enabled == true && api_page.public_apis.ext.getbasicstats.enabled == true) {
    const coin = settings.getCoin(net)
    const r = statsCache.get(net);
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

          // eval('var p_ext = {  "last_price_' + markets_page.default_exchange.trading_pair.split('/')[1].toLowerCase() + '":   }');
          statsCache.set(net, s);
          debug("Cached coin stats '%s' %o - mem: %o", net, s, process.memoryUsage());
          res.send(s);
        } else 
          res.end('This method is disabled')
      }, net);
    } else {
      debug("Get coin stats by cache '%s' %o ...", net, r.block_count);
      res.send(r);
    }
  } else
    res.end('This method is disabled');
});

app.use('/ext/getticker/:mode/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const api_page = settings.get(net, 'api_page')
  const algos = settings.algos
  if (api_page.enabled == true && api_page.public_apis.ext.getticker.enabled == true) {
    if (settings.cache.enabled == true) {
      var r = tickerCache.get(net);
      if (r == undefined) {
        db.get_stats(coin.name, function (stats) {
          db.count_masternodes(function(mn) {
            db.get_markets_summary(function(marketdata) {
              var markets = marketdata;
              if (typeof markets === 'string') {
                console.warn(markets);
                markets = [];
              }
              request({uri: base_url + 'ext/getcurrentprice/' + net, json: true}, function (error, response, ratesdata) {
                var rates = ratesdata;
                if (typeof rates === 'string') {
                  console.warn(rates);
                  rates = [];
                }
                request({uri: base_url + 'ext/getdistribution/' + net, json: true}, function (error, response, ddata) {
                  var distribution = ddata;
                  if (typeof distribution === 'string') {
                    console.warn(distribution);
                    distribution = {};
                  }
                  
                  db.get_latest_networkhistory(stats.count, function(networkhist) {
                    if (networkhist) {
                      for (i = 0; i < algos.length; i++) {
                        if ((!isNaN(networkhist['nethash_' + algos[i].algo.toLowerCase()]))) {
                          const algo = algos[i].algo.toLowerCase()
                          algos[i].hashps = networkhist['nethash_' + algo]
                          algos[i].diff = networkhist['difficulty_' + algo]
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
                    r.txes = stats.txes
                    r.markets = markets
                    r.rates = rates;
                    r.node_collateral = 15000000
                    r.node_count = mn.count;
                    r.node_active = mn.active;
                    r.distribution = distribution
                    r.pools = ["crimson-pool.com","cryptoverse.eu","kriptokyng.com","mecrypto.club","mining4people.com","mypool.sytes.net","suprnova.cc","zergpool.com","zpool.ca"]
                    r.algos = algos
                    tickerCache.set (net, r);
                    debug("Cached ticker '%s' '%s' %o - mem: %o", r.coin, net, r, process.memoryUsage());
                    res.send(r);
                   }, net);
                });
              });
            }, net);
          }, net);
        }, net);
      } else {
        debug("Get ticker by ćache '%s' '%s' % ...", r.coin, net, r.last_updated);

        res.send(r);
      }
    } else {
      res.end('This method is available only with caching enabled');
    }
  } else
    res.end('This method is disabled');
});

app.use('/ext/getmarkets/:mode/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
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
    res.end('This method is disabled');
  }
});

function isInternalRequest(req) {
  // TODO: Find secure solution.
  return req.headers['x-requested-with'] != null 
    && req.headers['x-requested-with'].toLowerCase() == 'xmlhttprequest' 
    && req.headers.referer != null 
    && req.headers.accept.indexOf('text/javascript') > -1 
    && req.headers.accept.indexOf('application/json') > -1
}

app.use('/ext/getlasttxs/:net/:min', function(req, res) {
  // TODO: Add cache.
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const api_page = settings.get(net, 'api_page')
  if ((api_page.enabled == true && api_page.public_apis.ext.getlasttxs.enabled == true) || isInternalRequest(req)) {
    var min = req.params.min, start, length, internal = false;
    // split url suffix by forward slash and remove blank entries
    var split = req.url.split('/').filter(function(v) { return v; });
    // determine how many parameters were passed
    switch (split.length) {
      case 2:
        // capture start and length
        start = split[0];
        length = split[1];
        break;
      default:
        if (split.length == 1) {
          // capture start
          start = split[0];
        } else if (split.length >= 2) {
          // capture start and length
          start = split[0];
          length = split[1];
          // check if this is an internal request
          if (split.length > 2 && split[2] == 'internal')
            internal = true;
        }

        break;
    }

    if (typeof length === 'undefined' || isNaN(length) || length < 1 || length > api_page.public_apis.ext.getlasttxs.max_items_per_query)
      length = api_page.public_apis.ext.getlasttxs.max_items_per_query;
    if (typeof start === 'undefined' || isNaN(start) || start < 0)
      start = 0;
    if (typeof min === 'undefined' || isNaN(min) || min < 0)
      min  = 0;
    else
      min  = (min * 100000000);

    db.get_last_txs(start, length, min, internal, function(data, count) {
      // check if this is an internal request
      if (internal) {
        // display data formatted for internal datatable
        res.json({"data": data, "recordsTotal": count, "recordsFiltered": count});
      } else {
        // display data in more readable format for public api
        res.json(data);
      }
    }, net);
  } else
    res.end('This method is disabled');
});

app.use('/ext/getaddresstxs/:address/:net/:start/:length', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
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

    db.get_address_txs_ajax(req.params.address, start, length, function(txs, count) {
      var data = [];

      for (i = 0; i < txs.length; i++) {
        if (typeof txs[i].txid !== "undefined") {
          var out = 0;
          var vin = 0;

          txs[i].vout.forEach(function(r) {
            if (r.addresses == req.params.address)
              out += r.amount;
          });

          txs[i].vin.forEach(function(s) {
            if (s.addresses == req.params.address)
              vin += s.amount;
          });

          if (internal) {
            var row = [];

            row.push(txs[i].timestamp);
            row.push(txs[i].txid);
            row.push(Number(out / 100000000));
            row.push(Number(vin / 100000000));
            row.push(Number(txs[i].balance / 100000000));

            data.push(row);
          } else {
            data.push({
              timestamp: txs[i].timestamp,
              txid: txs[i].txid,
              sent: Number(out / 100000000),
              received: Number(vin / 100000000),
              balance: Number(txs[i].balance / 100000000)
            });
          }
        }
      }

      // check if this is an internal request
      if (internal) {
        // display data formatted for internal datatable
        res.json({"data": data, "recordsTotal": count, "recordsFiltered": count});
      } else {
        // display data in more readable format for public api
        res.json(data);
      }
    }, net);
  } else
    res.end('This method is disabled');
});

app.use('/ext/getsummary/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  if ((api_page.enabled == true && api_page.public_apis.ext.getsummary.enabled == true) || isInternalRequest(req)) {
    const coin = settings.getCoin(net)
    const summary = summaryCache.get(net)
    if (summary == undefined) {
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

        summaryCache.set (net, r)
        debug("Cached summary '%s' %o - mem: %o", net, r, process.memoryUsage())
        res.send(r)
      }, net)
    } else {
      debug("Get summary by cache '%s' %o ...", net, summary)
      res.send(summary)
    }
  } else
    res.end('This method is disabled')
})

app.use('/ext/getnetworkpeers/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const api_page = settings.get(net, 'api_page')
  if ((api_page.enabled == true && api_page.public_apis.ext.getnetworkpeers.enabled == true) || isInternalRequest(req)) {
    const coin = settings.getCoin(net)  
    const r = peersCache.get(net);
    if (r == undefined) {
      db.get_peers(function(peers) {
        // loop through peers list and remove the mongo _id and __v keys
        for (i = 0; i < peers.length; i++) {
          delete peers[i]['_doc']['_id'];
          delete peers[i]['_doc']['__v'];
        }

        var newPeers = [];
        for (i = 0; i < peers.length; i++) {
          if (peers[i].version != 'ButKoin Core Green:1.2.17.3') {
            newPeers.push(peers[i]);
          }
        }

        // sort ip6 addresses to the bottom
        newPeers.sort(function(a, b) {
          var address1 = a.address.indexOf(':') > -1;
          var address2 = b.address.indexOf(':') > -1;

          if (address1 < address2)
            return -1;
          else if (address1 > address2)
            return 1;
          else
            return 0;
        });

        // return peer data
        peersCache.set (net, newPeers);
        debug("Cached peers '%s' %o - mem: %o", net, newPeers, process.memoryUsage());
        res.json(newPeers);
      }, net);
    } else {
      debug("Get peers by cache '%s' ...", net);
      res.send(r);
    }
  } else
    res.end('This method is disabled');
});

// get the list of masternodes from local collection
app.use('/ext/getmasternodelist/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const api_page = settings.get(net, 'api_page')
  if ((api_page.enabled == true && api_page.public_apis.ext.getmasternodelist.enabled == true) || isInternalRequest(req)) {
    const r = masternodesCache.get(net);
    if (r == undefined) {
      db.get_masternodes(function(masternodes) {
        // loop through masternode list and remove the mongo _id and __v keys
        for (i = 0; i < masternodes.length; i++) {
          delete masternodes[i]['_doc']['_id'];
          delete masternodes[i]['_doc']['__v'];
        }
        masternodesCache.set(net, masternodes);
        debug("Cached masternodes '%s' %o - mem: %o", net, masternodes, process.memoryUsage());
        res.send(masternodes);
      }, net);
    } else {
      debug("Get masternodes by cache '%s' ...", net);
      res.send(r)
    }
  } else
    res.end('This method is disabled');
});

// returns a list of masternode reward txs for a single masternode address from a specific block height
app.use('/ext/getmasternoderewards/:hash/:since/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
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
    res.end('This method is disabled');
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
        res.json(total_rewards);
      } else
        res.send({error: "failed to retrieve masternode rewards", hash: req.params.hash, since: req.params.since});
    }, net);
  } else
    res.end('This method is disabled');
});

app.use('/ext/getnetworkchartdata/:net?', function(req, res) {
  const net = settings.getNet(req.params['net'])
  const coin = settings.getCoin(net)
  const r = networkChartCache.get(net);
  if (r == undefined) {
    db.get_network_chart_data(function(data) {
      if (data) {
        networkChartCache.set(net, data);
        debugChart("Cached network chart '%s' %o - mem: %o", net, data, process.memoryUsage());
        res.send(data);
      } else {
        res.send();
      }
    }, net);
  } else {
    debug("Get network chart by cache '%s' ...", net);
    res.send(r);
  }
});

const allnet_modes = ['markets']

// net apis
app.use('/net/getallnet/:mode?', function(req, res) {
  const net = settings.getDefaultNet()
  const mode = req.params['mode']
  const api_page = settings.get(net, 'api_page')

  if (api_page.enabled == true && api_page.public_apis.net.getallnet.enabled == true) {
    if (mode) {
      if (!allnet_modes.includes(mode)) {
        res.end('This mode is not supported');    
      }
    } else {
      const r = foreverCache.get('allnet');
      if (r == undefined) {
        const allnet = settings.getAllNet()
        foreverCache.set(net, allnet);
        res.send(allnet);
      } else {
        res.send(r);
      }
    }
  } else
    res.end('This method is disabled');
});

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
app.set('explorer_version', package_metadata.version)
app.set('locale', locale)
app.set('get', settings.get)
app.set('getWallet', settings.getWallet)
app.set('isButkoin', settings.isButkoin)
app.set('isPepew', settings.isPepew)
app.set('isVkax', settings.isVkax)
app.set('getLogo', settings.getLogo)
app.set('getTitleLogo', settings.getTitleLogo)
app.set('formatDateTime', settings.formatDateTime)
app.set('formatCurrency', settings.formatCurrency)
app.set('formatDecimal', settings.formatDecimal)
app.set('formatInt', settings.formatInt)
app.set('panelOffset', settings.panelOffset)
app.set('panel', settings.panel)
app.set('panels', settings.panels)
app.set('coins', settings.coins)
app.set('wallets', settings.wallets)
app.set('default_wallet', settings.wallets[0].id)
app.set('currencies', settings.currencies)
app.set('cache', settings.cache)
app.set('labels', settings.labels)
app.set('blockchain_specific', settings.blockchain_specific)
app.set('market_data', market_data)
app.set('market_count', market_count)

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

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
    app.set('revision', stdout.substring(0, 7));
  }
});

module.exports = app;