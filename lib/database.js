const debug = require('debug')('debug');
var mongoose = require('mongoose'),
    lib = require('./explorer'),
    settings = require('./settings'),
    fs = require('fs'),
    coingecko = require('./apis/coingecko');

var StatsDb = [];
var MarketsDb = [];
var AddressDb = [];
var AddressTxDb = []; 
var TxDb = []; 
var PeersDb = [];
var MasternodeDb = [];
var RichlistDb = [];
var NetworkHistoryDb = [];
var HeavyDb = []; 

function find_address(hash, caseSensitive, cb, net='mainnet') {
  if (caseSensitive) {
    // faster search but only matches exact string including case
    AddressDb[net].findOne({a_id: hash}, function(err, address) {
      if (address)
        return cb(address);
      else
        return cb();
    });
  } else {
    // slower search but matches exact string ignoring case
    AddressDb[net].findOne({a_id: {$regex: '^' + hash + '$', $options: 'i'}}, function(err, address) {
      if (address)
        return cb(address);
      else
        return cb();
    });
  }
}

// unused
function find_address_tx(address, hash, cb, net='mainnet') {
  AddressTxDb[net].findOne({a_id: address, txid: hash}, function(err, address_tx) {
    if (address_tx)
      return cb(address_tx);
    else
      return cb();
  });
}

function find_richlist(coin, cb, net='mainnet') {
  RichlistDb[net].findOne({coin: coin}, function(err, richlist) {
    if (richlist)
      return cb(richlist);
    else
      return cb();
  });
}

function update_address(hash, blockheight, txid, amount, type, cb, net='mainnet') {
  var to_sent = false;
  var to_received = false;
  var addr_inc = {}

  if (hash == 'coinbase')
    addr_inc.sent = amount;
  else {
    if (type == 'vin') {
      addr_inc.sent = amount;
      addr_inc.balance = -amount;
    } else {
      addr_inc.received = amount;
      addr_inc.balance = amount;
    }
  }

  AddressDb[net].findOneAndUpdate({a_id: hash}, {
    $inc: addr_inc
  }, {
    new: true,
    upsert: true
  }, function (err, address) {
    if (err)
      return cb(err);
    else {
      if (hash != 'coinbase') {
        AddressTxDb[net].findOneAndUpdate({a_id: hash, txid: txid}, {
          $inc: {
            amount: addr_inc.balance
          },
          $set: {
            a_id: hash,
            blockindex: blockheight,
            txid: txid
          }
        }, {
          new: true,
          upsert: true
        }, function (err,addresstx) {
          if (err)
            return cb(err);
          else
            return cb();
        });
      } else
        return cb();
    }
  });
}

function find_tx(txid, cb, net='mainnet') {
  TxDb[net].findOne({txid: txid}, function(err, tx) {
    if (tx)
      return cb(tx);
    else
      return cb(null);
  });
}

function get_market_data(market, coin_symbol, pair_symbol, cb) {
  if (fs.existsSync('./lib/markets/' + market + '.js')) {
    exMarket = require('./markets/' + market);

    exMarket.get_data({coin: coin_symbol, exchange: pair_symbol}, function(err, obj) {
      return cb(err, obj);
    });
  } else
    return cb(null);
}

function check_add_db_field(model_obj, field_name, default_value, cb) {
  // determine if a particular field exists in a db collection
  model_obj.findOne({[field_name]: {$exists: false}}, function(err, model_data) {
    // check if field exists
    if (model_data) {
      // add field to all documents in the collection
      model_obj.updateMany({}, {
        $set: { [field_name]: default_value }
      }, function() {
        return cb(true);
      });
    } else
      return cb(false);
  });
}

function check_rename_db_field(model_obj, old_field_name, new_field_name, cb) {
  // determine if a particular field exists in a db collection
  model_obj.findOne({[old_field_name]: {$exists: false}}, function(err, model_data) {
    // check if old field exists
    if (model_data) {
      // rename field
      model_obj.updateMany({}, {
        $rename: { [old_field_name]: new_field_name }
      }, { multi: true, strict: false }, function() {
        return cb(true);
      });
    } else
      return cb(false);
  });
}

function hex_to_ascii(hex) {
    var str = '';
    for (var i = 0; i < hex.length; i += 2)
      str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    return str;
}

function init_markets(cb, net='mainnet') {
  // check if markets/exchanges feature is enabled
  const markets_page = settings.get(net, 'markets_page');

  if (markets_page.enabled == true) {
    var marketCounter = 0;

    // loop through and test all exchanges defined in the settings.json file
    Object.keys(markets_page.exchanges).forEach(function (key, index, map) {
      // check if market is enabled via settings
      if (markets_page.exchanges[key].enabled == true) {
        // check if exchange is installed/supported
        if (module.exports.fs.existsSync('./lib/markets/' + key + '.js')) {
          var exMarket = require('./markets/' + key);
          var pairCounter = 0;

          // loop through all trading pairs
          markets_page.exchanges[key].trading_pairs.forEach(function (pair_key, pair_index, pair_map) {
            // split the pair data
            var split_pair = pair_key.split('/');
            // check if this is a valid trading pair
            if (split_pair.length == 2) {
              // lookup the exchange in the market collection
              module.exports.check_market(key, split_pair[0], split_pair[1], function(market, exists) {
                // check if exchange trading pair exists in the market collection
                if (!exists) {
                  // exchange doesn't exist in the market collection so add a default definition now
                  console.log('No %s: %s entry found. Creating new entry now..', market, pair_key);
                  module.exports.create_market(split_pair[0], split_pair[1], market, exMarket.ext_market_url, exMarket.referal, function() {
                    pairCounter++;

                    // check if all pairs have been tested
                    if (pairCounter == markets_page.exchanges[key].trading_pairs.length)
                      marketCounter++;

                    // check if all exchanges have been tested
                    if (marketCounter == Object.keys(markets_page.exchanges).length) {
                      // finished initializing markets
                      return cb();
                    }
                  }, net);
                } else {
                  pairCounter++;

                  // check if all pairs have been tested
                  if (pairCounter == markets_page.exchanges[key].trading_pairs.length)
                    marketCounter++;
                }

                // check if all exchanges have been tested
                if (marketCounter == Object.keys(markets_page.exchanges).length) {
                  // finished initializing markets
                  return cb();
                }
              }, net);
            } else {
              pairCounter++;

              // check if all pairs have been tested
              if (pairCounter == markets_page.exchanges[key].trading_pairs.length)
                marketCounter++;
            }
          });
        } else
          marketCounter++;
      } else
        marketCounter++;
    });

    // check if all exchanges have been tested
    if (marketCounter == Object.keys(markets_page.exchanges).length) {
      // finished initializing markets
      return cb();
    }
  } else
    return cb();
}

function init_heavy(cb, net='mainnet') {
  if (settings.blockchain_specific.heavycoin.enabled == true) {
    module.exports.check_heavy(settings.coin.name, function(exists) {
      if (exists == false) {
        console.log('No heavycoin entry found. Creating new entry now..');
        module.exports.create_heavy(settings.coin.name, function() {
          return cb();
        }, net);
      } else
        return cb();
    }, net);
  } else
    return cb();
}

module.exports = {
  StatsDb: StatsDb,
  AddressDb: AddressDb,
  AddressTxDb: AddressTxDb,
  TxDb: TxDb,
  RichlistDb: RichlistDb,
  lib: lib,
  // initialize DB
  connect: function(database, cb) {
    mongoose.set('strictQuery', true);

    mongoose.connect(database, function(err) {
      if (err) {
        console.log('Error: Unable to connect to database: %s', database);
        process.exit(999);
      }

      return cb();
    });
  },

  connection_factory: function(net, dbstring, cb) {
    mongoose.set('strictQuery', true)
    const con = mongoose.createConnection(dbstring)
    
    StatsDb[net] = con.model('coinstats', require('../models/stats'));
    MarketsDb[net] = con.model('Markets', require('../models/markets'));
    AddressDb[net] = con.model('Address', require('../models/address'));
    AddressTxDb[net] = con.model('AddressTx', require('../models/addresstx'));
    TxDb[net] = con.model('Tx', require('../models/tx'));
    PeersDb[net] = con.model('Peers', require('../models/peers'));
    MasternodeDb[net] = con.model('Masternode', require('../models/masternode'));
    RichlistDb[net] = con.model('Richlist', require('../models/richlist'));
    NetworkHistoryDb[net] = con.model('NetworkHistory', require('../models/networkhistory'));
    HeavyDb[net] = con.model('Heavy', require('../models/heavy'));

    return cb(con);
  },

  check_show_sync_message: function(net='mainnet') {
    return fs.existsSync('./tmp/show_sync_message-' + net + '.tmp');
  },

  update_label: function(hash, claim_name, cb, net='mainnet') {
    find_address(hash, false, function(address) {
      if (address) {
        AddressDb[net].updateOne({a_id: hash}, {
          name: claim_name
        }, function() {
          // update claim name in richlist
          module.exports.update_richlist_claim_name(hash, claim_name, function() {
            // update claim name in masternode list
            module.exports.update_masternode_claim_name(hash, claim_name, function() {
              return cb('');
            }, net);
          }, net);
        });
      } else {
        // address is not valid or does not have any transactions
        return cb('no_address');
      }
    }, net);
  },

  update_richlist_claim_name: function(hash, claim_name, cb, net='mainnet') {
    const richlist_page = settings.get(net, 'richlist_page')
    if (richlist_page.enabled == true) {
      // ensure that if this address exists in the richlist that it displays the new alias
      module.exports.get_richlist(settings.coin.name, function(richlist) {
        var updated = false;

        // loop through received addresses
        for (r = 0; r < richlist.received.length; r++) {
          // check if this is the correct address
          if (richlist.received[r].a_id == hash) {
            // update the claim name
            richlist.received[r]['name'] = claim_name;
            // mark as updated
            updated = true;
          }
        }

        // loop through balance addresses
        for (b = 0; b < richlist.balance.length; b++) {
          // check if this is the correct address
          if (richlist.balance[b].a_id == hash) {
            // update the claim name
            richlist.balance[b]['name'] = claim_name;
            // mark as updated
            updated = true;
          }
        }

        // check if the address was updated in the richlist
        if (updated) {
          // save the richlist back to collection
          RichlistDb[net].updateOne({coin: settings.coin.name}, {
            received: richlist.received,
            balance: richlist.balance
          }, function() {
            // finished updating the claim label
            return cb('');
          });
        } else {
          // finished updating the claim label
          return cb('');
        }
      }, net);
    } else {
      // richlist is not enabled so nothing to update
      return cb('');
    }
  },

  update_masternode_claim_name: function(hash, claim_name, cb, net='mainnet') {
    const masternodes_page = settings.get(net, 'masternodes_page')
    if (masternodes_page.enabled == true) {
      // ensure that if this address exists in the masternode that it displays the new alias
      module.exports.get_masternodes(function(masternodes) {
        var updated = false;

        // loop through masternode addresses
        for (m = 0; m < masternodes.length; m++) {
          // check if this is the correct address
          if ((masternodes[m].proTxHash != null ? masternodes[m].payee : masternodes[m].addr) == hash) {
            // update the claim name
            masternodes[m]['claim_name'] = claim_name;
            // mark as updated
            updated = true;
          }
        }

        // check if the address was updated in the masternode list
        if (updated) {
          // save the updated masternode back to collection
          MasternodeDb[net].updateOne({addr: hash}, {
            claim_name: claim_name
          }, function() {
            // finished updating the claim label
            return cb('');
          });
        } else {
          // finished updating the claim label
          return cb('');
        }
      }, net);
    } else {
      // masternode list is not enabled so nothing to update
      return cb('');
    }
  },

  check_txes_and_upgrade_schema: function(cb, net='mainnet') {
    TxDb[net].count({}, function(err, count) {
        if (err) {
          console.error("Failed to check TX database: %s", err)
          return cb(-1);
        } else
          return cb(count);
  1 });
  },

  check_stats: function(coinName, cb, net='mainnet') {
    StatsDb[net].findOne({coin: coinName}, function(err, stats) {
      if (err) {
        console.log('DB error getting stats: %s', err);
      }
      if (stats) {
        return cb(true);
      } else
        return cb(false);
    });
  },

  get_stats: function(coinName, cb, net='mainnet') {
    StatsDb[net].findOne({coin: coinName}, function(err, stats) {
      if (stats)
        return cb(stats);
      else
        return cb(null);
    });
  },

  create_stats: function(coinName, skip, cb, net='mainnet') {
    // check if stats need to be created
    if (!skip) {
      console.log("Try to init Initial stats");
      const dto = StatsDb[net].create({
        coin: coinName,
        last: 0
      });
      if (dto) {
          console.log("Initial stats entry created for %s", coinName);   
      }
      return cb();
    } else
      return cb();
  },

  get_address: function(hash, caseSensitive, cb, net='mainnet') {
    find_address(hash, caseSensitive, function(address) {
      return cb(address);
    }, net);
  },

  get_richlist: function(coin, cb, net='mainnet') {
    find_richlist(coin, function(richlist) {
      return cb(richlist);
    }, net);
  },

  // 'list' variable can be either 'received' or 'balance'
  update_richlist: function(list, cb, net='mainnet') {
    // number of addresses to lookup
    var total_addresses = 100;
    // create the burn address array so that we omit burned coins from the rich list
    const richlist_page = settings.get(net, 'richlist_page')
    var burn_addresses = richlist_page.burned_coins.addresses;

    // always omit special addresses used by the explorer from the richlist (coinbase, hidden address and unknown address)
    burn_addresses.push('coinbase');
    burn_addresses.push('hidden_address');
    burn_addresses.push('unknown_address');

    if (list == 'received') {
      // update 'received' richlist data
      AddressDb[net].find({a_id: { $nin: burn_addresses }}, 'a_id name balance received').sort({received: 'desc'}).limit(total_addresses).exec(function(err, addresses) {
        RichlistDb[net].updateOne({coin: settings.coin.name}, {
          received: addresses
        }, function() {
          return cb();
        });
      });
    } else {
      // update 'balance' richlist data
      // check if burned addresses are in use and if it is necessary to track burned balances
      if (richlist_page.burned_coins.addresses == null || richlist_page.burned_coins.addresses.length == 0 || !richlist_page.burned_coins.include_burned_coins_in_distribution) {
        // update 'balance' richlist data by filtering burned coin addresses immidiately
        AddressDb[net].find({a_id: { $nin: burn_addresses }}, 'a_id name balance received').sort({balance: 'desc'}).limit(total_addresses).exec(function(err, addresses) {
          RichlistDb[net].updateOne({coin: settings.coin.name}, {
            balance: addresses
          }, function() {
            return cb();
          });
        });
      } else {
        // do not omit burned addresses from database query. instead, increase the limit of returned addresses and manually remove each burned address that made it into the rich list after recording the burned balance
        AddressDb[net].find({}, 'a_id name balance received').sort({balance: 'desc'}).limit(total_addresses + burn_addresses.length).exec(function(err, addresses) {
          var return_addresses = [];
          var burned_balance = 0.0;

          // loop through all richlist addresses
          addresses.forEach(function (address) {
            // check if this is a burned coin address
            if (burn_addresses.findIndex(p => p.toLowerCase() == address.a_id.toLowerCase()) > -1) {
              // this is a burned coin address so save the balance, not the address
              burned_balance += address.balance;
            } else if (return_addresses.length < total_addresses) {
              // this is not a burned address so add it to the return list
              return_addresses.push(address);
            }
          });

          // update the rich list collection
          RichlistDb[net].updateOne({coin: settings.coin.name}, {
            balance: return_addresses,
            burned: burned_balance
          }, function() {
            return cb();
          });
        });
      }
    }
  },

  get_tx: function(txid, cb, net='mainnet') {
    find_tx(txid, function(tx) {
      return cb(tx);
    }, net);
  },

  get_txs: function(block, cb, net='mainnet') {
    var txs = [];

    lib.syncLoop(block.tx.length, function (loop) {
      var i = loop.iteration();

      find_tx(block.tx[i], function(tx) {
        if (tx) {
          txs.push(tx);
          loop.next();
        } else
          loop.next();
      }, net);
    }, function() {
      return cb(txs);
    });
  },

  get_last_txs: function(start, length, min, internal, cb, net='mainnet') {
    this.get_last_txs_ajax(start, length, min, function(txs, count) {
      var data = [];

      for (i = 0; i < txs.length; i++) {
        if (internal) {
          var row = [];

          row.push(txs[i].blockindex);
          row.push(txs[i].blockhash);
          row.push(txs[i].txid);
          row.push(txs[i].vout.length);
          row.push((txs[i].total / 100000000));
          row.push(txs[i].timestamp);

          data.push(row);
        } else {
          data.push({
            blockindex: txs[i].blockindex,
            blockhash: txs[i].blockhash,
            txid: txs[i].txid,
            recipients: txs[i].vout.length,
            amount: (txs[i].total / 100000000),
            timestamp: txs[i].timestamp
          });
        }
      }

      return cb(data, count);
    }, net);
  },

  get_last_txs_ajax: function(start, length, min, cb, net='mainnet') {
    debug("Get last txes starting %d, length %d, min. amount %d for chain '%s'.", start, length, min, net);
    if (min > 0) {
      // min is greater than zero which means we must pull record count from the txes collection
      TxDb[net].find({'total': {$gte: min}}).countDocuments(function(err, count) {
        // get last transactions where there is at least 1 vout
        TxDb[net].find({'total': {$gte: min}, 'vout': { $gte: { $size: 1 }}}).sort({blockindex: -1}).skip(Number(start)).limit(Number(length)).exec(function(err, txs) {
          if (err)
            return cb(err);
          else
            return cb(txs, count);
        });
      });
    } else {
      // min is zero (shouldn't ever be negative) which means we must pull record count from the coinstats collection (pulling from txes could potentially take a long time because it would include coinbase txes)
      StatsDb[net].findOne({coin: settings.coin.name}, function(err, stats) {
        // Get last transactions where there is at least 1 vout
        TxDb[net].find({'total': {$gte: min}, 'vout': { $gte: { $size: 1 }}}).sort({blockindex: -1}).skip(Number(start)).limit(Number(length)).exec(function(err, txs) {
          if (err)
            return cb(err);
          else
            return cb(txs, stats ? stats.txes : 0);
        });
      });
    }
  },

  get_address_txs_ajax: function(hash, start, length, cb, net='mainnet') {
    var totalCount = 0;

    AddressTxDb[net].find({a_id: hash}).countDocuments(function(err, count) {
      if (err)
        return cb(err);
      else {
        totalCount = count;

        AddressTxDb[net].aggregate([
          { $match: { a_id: hash } },
          { $sort: {blockindex: -1} },
          { $skip: Number(start) },
          {
            $group: {
              _id: '',
              balance: { $sum: '$amount' }
            }
          },
          {
            $project: {
              _id: 0,
              balance: '$balance'
            }
          },
          { $sort: {blockindex: -1} }
        ], function (err,balance_sum) {
          if (err)
            return cb(err);
          else {
            AddressTxDb[net].find({a_id: hash}).sort({blockindex: -1}).skip(Number(start)).limit(Number(length)).exec(function (err, address_tx) {
              if (err)
                return cb(err);
              else {
                var txs = [];
                var count = address_tx.length;
                var running_balance = balance_sum.length > 0 ? balance_sum[0].balance : 0;
                var txs = [];

                lib.syncLoop(count, function (loop) {
                  var i = loop.iteration();

                  find_tx(address_tx[i].txid, function (tx) {
                    if (tx && !txs.includes(tx)) {
                      tx.balance = running_balance;
                      txs.push(tx);
                      loop.next();
                    } else if (!txs.includes(tx)) {
                      txs.push("1. Not found");
                      loop.next();
                    } else
                      loop.next();

                    running_balance = running_balance - address_tx[i].amount;
                  }, net);
                }, function () {
                  return cb(txs, totalCount);
                });
              }
            });
          }
        });
      }
    });
  },

  create_market: function(coin_symbol, pair_symbol, market, ext_market_url, referal, cb, net='mainnet') {
    const dto = MarketsDb[net].create({
      market: market,
      ext_market_url: ext_market_url,
      referal: referal,
      coin_symbol: coin_symbol,
      pair_symbol: pair_symbol
    });
    if (dto) {
      console.log("Initial market entry created for %s: %s, ext-url %s, referal %s", market, coin_symbol +'/' + pair_symbol, ext_market_url, referal);  
    }
    return cb();
  },

  // check if market data exists for a given market and trading pair
  check_market: function(market, coin_symbol, pair_symbol, cb, net='mainnet') {
    MarketsDb[net].findOne({market: market, coin_symbol: coin_symbol, pair_symbol: pair_symbol}, function(err, exists) {
      return cb(market, exists);
    });
  },

  // gets market data for given market and trading pair
  get_market: function(market, coin_symbol, pair_symbol, cb, net='mainnet') {
    MarketsDb[net].findOne({market: market, coin_symbol: coin_symbol, pair_symbol: pair_symbol}, function(err, data) {
      if (data)
        return cb(data);
      else
        return cb(null);
    });
  },

  // gets all markets without buys, sells and historical data.
  get_markets_summary: function(cb, net='mainnet') {
    MarketsDb[net].find({}, { _id: 0, market: 1, referal: 1, coin_symbol: 1, pair_symbol: 1, summary: 1, ext_market_url: 1, referal: 1 }, function(err, data) {
      if (data)
        return cb(data);
      else
        return cb(null);
    });
  },

  // gets all markets including buys, sells and historical data.
  get_markets: function(cb, net='mainnet') {
    MarketsDb[net].find({}, { _id: 0, market: 1, coin_symbol: 1, pair_symbol: 1, summary: 1, chartdata: 1, buys: 1, sells: 1, history: 1, ext_market_url: 1, referal: 1 }, function(err, data) {
      if (data)
        return cb(data);
      else
        return cb(null);
    });
  },

  // creates initial richlist entry in database; called on first launch of explorer + after restore or delete database
  create_richlist: function(coin, skip, cb, net='mainnet') {
    if (!skip) {
      var dto = RichlistDb[net].create({
        coin: coin
      });
      if (dto) {
        console.log("Initial richlist entry created for %s", coin);
      }
      return cb();
    } else
      return cb();
  },

  // drops richlist data for given coin
  delete_richlist: function(coin, cb, net='mainnet') {
    RichlistDb[net].findOneAndRemove({coin: coin}, function(err, exists) {
      if (exists)
        return cb(true);
      else
        return cb(false);
    });
  },

  // checks richlist data exists for given coin
  check_richlist_and_upgrade_schema: function(coin, cb, net='mainnet') {
    RichlistDb[net].findOne({coin: coin}, function(err, exists) {
      if (exists)
        return cb(true);
      else
        return cb(false);
    });
  },

  create_heavy: function(coin, cb, net='mainnet') {
    const dto = new HeavyDb[net].create({
      coin: coin
    });
    if (dto) {
      console.log("Initial heavycoin entry created for %s", coin);
    }
    return cb();
  },

  check_heavy: function(coin, cb, net='mainnet') {
    HeavyDb[net].findOne({coin: coin}, function(err, exists) {
      if (exists)
        return cb(true);
      else
        return cb(false);
    });
  },

  get_heavy: function(coin, cb, net='mainnet') {
    HeavyDb[net].findOne({coin: coin}, function(err, heavy) {
      if (heavy)
        return cb(heavy);
      else
        return cb(null);
    });
  },

  get_distribution: function(richlist, stats, cb, net='mainnet') {
    const richlist_page = settings.get(net, 'richlist_page')
    var distribution = {
      supply: stats.supply,
      t_1_25: {percent: 0, total: 0 },
      t_26_50: {percent: 0, total: 0 },
      t_51_75: {percent: 0, total: 0 },
      t_76_100: {percent: 0, total: 0 },
      t_101plus: {percent: 0, total: 0 }
    };
    lib.syncLoop(richlist.balance.length, function (loop) {
      var i = loop.iteration();
      var count = i + 1;
      var percentage = ((richlist.balance[i].balance / 100000000) / stats.supply) * 100;

      if (count <= 25 ) {
        distribution.t_1_25.percent = distribution.t_1_25.percent + percentage;
        distribution.t_1_25.total = distribution.t_1_25.total + (richlist.balance[i].balance / 100000000);
      }

      if (count <= 50 && count > 25) {
        distribution.t_26_50.percent = distribution.t_26_50.percent + percentage;
        distribution.t_26_50.total = distribution.t_26_50.total + (richlist.balance[i].balance / 100000000);
      }

      if (count <= 75 && count > 50) {
        distribution.t_51_75.percent = distribution.t_51_75.percent + percentage;
        distribution.t_51_75.total = distribution.t_51_75.total + (richlist.balance[i].balance / 100000000);
      }

      if (count <= 100 && count > 75) {
        distribution.t_76_100.percent = distribution.t_76_100.percent + percentage;
        distribution.t_76_100.total = distribution.t_76_100.total + (richlist.balance[i].balance / 100000000);
      }

      loop.next();
    }, function() {
      distribution.t_101plus.percent = parseFloat(100 - distribution.t_76_100.percent - distribution.t_51_75.percent - distribution.t_26_50.percent - distribution.t_1_25.percent - (richlist_page.burned_coins.include_burned_coins_in_distribution == true && richlist.burned > 0 ? ((richlist.burned / 100000000) / stats.supply) * 100 : 0)).toFixed(2);
      distribution.t_101plus.total = parseFloat(distribution.supply - distribution.t_76_100.total - distribution.t_51_75.total - distribution.t_26_50.total - distribution.t_1_25.total - (richlist_page.burned_coins.include_burned_coins_in_distribution == true && richlist.burned > 0 ? (richlist.burned / 100000000) : 0)).toFixed(8);
      distribution.t_1_25.percent = parseFloat(distribution.t_1_25.percent).toFixed(2);
      distribution.t_1_25.total = parseFloat(distribution.t_1_25.total).toFixed(8);
      distribution.t_26_50.percent = parseFloat(distribution.t_26_50.percent).toFixed(2);
      distribution.t_26_50.total = parseFloat(distribution.t_26_50.total).toFixed(8);
      distribution.t_51_75.percent = parseFloat(distribution.t_51_75.percent).toFixed(2);
      distribution.t_51_75.total = parseFloat(distribution.t_51_75.total).toFixed(8);
      distribution.t_76_100.percent = parseFloat(distribution.t_76_100.percent).toFixed(2);
      distribution.t_76_100.total = parseFloat(distribution.t_76_100.total).toFixed(8);

      return cb(distribution);
    });
  },

  // updates heavycoin stats
  // height: current block height, count: amount of votes to store
  update_heavy: function(coin, height, count, cb, net='mainnet') {
    var newVotes = [];

    lib.get_maxmoney(function (maxmoney) {
      lib.get_maxvote(function (maxvote) {
        lib.get_vote(function (vote) {
          lib.get_phase(function (phase) {
            lib.get_reward(function (reward) {
              module.exports.get_stats(settings.coin.name, function (stats) {
                lib.get_estnext(function (estnext) {
                  lib.get_nextin(function (nextin) {
                    lib.syncLoop(count, function (loop) {
                      var i = loop.iteration();
                      lib.get_blockhash(height - i, function (hash) {
                        lib.get_block(hash, function (block) {
                          newVotes.push({ count: height - i, reward: block.reward, vote: (block && block.vote ? block.vote : 0) });
                          loop.next();
                        }, net);
                      }, net);
                    }, function() {
                      HeavyDb[net].updateOne({coin: coin}, {
                        lvote: (vote ? vote : 0),
                        reward: (reward ? reward : 0),
                        supply: (stats && stats.supply ? stats.supply : 0),
                        cap: (maxmoney ? maxmoney : 0),
                        estnext: (estnext ? estnext : 0),
                        phase: (phase ? phase : 'N/A'),
                        maxvote: (maxvote ? maxvote : 0),
                        nextin: (nextin ? nextin : 'N/A'),
                        votes: newVotes
                      }, function() {
                        // update reward_last_updated value
                        module.exports.update_last_updated_stats(settings.coin.name, { reward_last_updated: Math.floor(new Date() / 1000) }, function (new_cb) {
                          console.log('Heavycoin update complete');
                          return cb();
                        }, net);
                      });
                    });
                  }, net);
                }, net);
              }, net);
            }, net);
          }, net);
        }, net);
      }, net);
    }, net);
  },

  // updates network history (nethash and difficulty) data
  // height: current block height
  update_network_history: function(height, cb, net='mainnet') {
    // lookup network history data for this block height
    NetworkHistoryDb[net].findOne({blockindex: height}, function(err, network_hist) {
      // check if there is already network history data for this block height
      if (!network_hist) {
        // lookup network hashrate
        lib.get_hashrate(function(hashps) {
          // lookup network difficulty
          lib.get_difficulty(net, function(difficulties) {
            var difficulty = difficulties.difficulty;
            var difficultyPOW = 0;
            var difficultyPOS = 0;
            const shared_pages = settings.get(net, 'shared_pages')
            if (difficulty && difficulty['proof-of-work']) {
              if (shared_pages.difficulty == 'Hybrid') {
                difficultyPOS = difficulty['proof-of-stake'];
                difficultyPOW = difficulty['proof-of-work'];
              } else if (shared_pages.difficulty == 'POW')
                difficultyPOW = difficulty['proof-of-work'];
              else
                difficultyPOS = difficulty['proof-of-stake'];
            } else if (shared_pages.difficulty == 'POW')
              difficultyPOW = difficulty;
            else
              difficultyPOS = difficulty;

            // create a new network history record
            var hashrate = hashps.nethash_butkscrypt;
            const dto = NetworkHistoryDb[net].create({
              blockindex: height,
              nethash: (hashrate == null || hashrate == '-' ? 0 : hashrate),
              difficulty_pow: difficultyPOW,
              difficulty_pos: difficultyPOS,
              difficulty_ghostrider: difficulties.pow_difficulties[0].diff,
              difficulty_yespower: difficulties.pow_difficulties[1].diff,
              difficulty_lyra2: difficulties.pow_difficulties[2].diff,
              difficulty_sha256d: difficulties.pow_difficulties[3].diff,
              difficulty_scrypt: difficulties.pow_difficulties[4].diff,
              difficulty_butkscrypt: difficulties.pow_difficulties[5].diff,
              nethash_ghostrider: hashps.nethash_ghostrider,
              nethash_yespower: hashps.nethash_yespower,
              nethash_lyra2: hashps.nethash_lyra2,
              nethash_sha256d: hashps.nethash_sha256d,
              nethash_scrypt: hashps.nethash_scrypt,
              nethash_butkscrypt: hashps.nethash_butkscrypt
            });

            if (dto) {
              // get the count of network history records
              NetworkHistoryDb[net].find({}).countDocuments(function(err, count) {
                // read maximum allowed records from settings
                const network_history = settings.get(net, 'network_history')
                let max_records = network_history.max_saved_records;

                // check if the current count of records is greater than the maximum allowed
                if (count > max_records) {
                  // prune network history records to keep collection small and quick to access
                  NetworkHistoryDb[net].find().select('blockindex').sort({blockindex: 1}).limit(count - max_records).exec(function(err, records) {
                    // create a list of the oldest network history ids that will be deleted
                    const ids = records.map((doc) => doc.blockindex);

                    // delete old network history records
                    NetworkHistoryDb[net].deleteMany({blockindex: {$in: ids}}, function(err) {
                      console.log('Network history update complete');
                      return cb();
                    });
                  });
                } else {
                  console.log('Network history update complete');
                  return cb();
                }
              });
            } else {
              console.log('Error updating network history: ' + err);
              return cb();
            }

            // TODO: Check this.
            // save the new network history record
            // newNetworkHistory.save(function(err) {
            //   // check for errors
            //   if (err) {
            //     console.log('Error updating network history: ' + err);
            //     return cb();
            //   } else {
            //     // get the count of network history records
            //     NetworkHistoryDb[net].find({}).countDocuments(function(err, count) {
            //       // read maximum allowed records from settings
            //       let max_records = settings.get(net, 'network_history').max_saved_records;

            //       // check if the current count of records is greater than the maximum allowed
            //       if (count > max_records) {
            //         // prune network history records to keep collection small and quick to access
            //         NetworkHistoryDb[net].find().select('blockindex').sort({blockindex: 1}).limit(count - max_records).exec(function(err, records) {
            //           // create a list of the oldest network history ids that will be deleted
            //           const ids = records.map((doc) => doc.blockindex);

            //           // delete old network history records
            //           NetworkHistoryDb[net].deleteMany({blockindex: {$in: ids}}, function(err) {
            //             console.log('Network history update complete');
            //             return cb();
            //           });
            //         });
            //       } else {
            //         console.log('Network history update complete');
            //         return cb();
            //       }
            //     });
            //   }
            // });
          }, net);
        }, net);
      } else {
        // skip saving network history data when the block hasn't moved since saving last time
        return cb();
      }
    });
  },

  // updates market data for given market; called by sync.js
  update_markets_db: function(market, coin_symbol, pair_symbol, cb, net='mainnet') {
    // check if market exists
    if (fs.existsSync('./lib/markets/' + market + '.js')) {
      get_market_data(market, coin_symbol, pair_symbol, function (err, obj) {
        // check if there was an error with getting market data
        if (err == null) {
          // update the market collection for the current market and trading pair combination
          MarketsDb[net].updateOne({market: market, coin_symbol: coin_symbol, pair_symbol: pair_symbol}, {
            chartdata: JSON.stringify(obj.chartdata),
            buys: obj.buys,
            sells: obj.sells,
            history: obj.trades,
            summary: obj.stats
          }, function() {
            const markets_page = settings.get(net, 'markets_page')
            // check if this is the default market and trading pair
            if (market == markets_page.default_exchange.exchange_name && markets_page.default_exchange.trading_pair.toUpperCase() == coin_symbol.toUpperCase() + '/' + pair_symbol.toUpperCase()) {
              // this is the default market so update the last price stats
              StatsDb[net].updateOne({coin: settings.coin.name}, {
                last_price: obj.stats.last
              }, function() {
                // finished updating market data
                return cb(null);
              });
            } else {
              // this is not the default market so we are finished updating market data
              return cb(null);
            }
          });
        } else {
          // an error occurred with getting market data so return the error msg
          return cb(err);
        }
      });
    } else {
      // market does not exist
      return cb('market is not installed');
    }
  },

  get_last_usd_price: function(cb, net='mainnet') {
    const markets_page = settings.get(net, 'markets_page')
    if (markets_page.exchanges[markets_page.default_exchange.exchange_name].enabled == true) {
      // get the list of coins from coingecko
      coingecko.get_coin_data(function (err, coin_list) {
        // check for errors
        if (err == null) {
          var symbol = markets_page.default_exchange.trading_pair.split('/')[1];
          var index = coin_list.findIndex(p => p.symbol.toLowerCase() == symbol.toLowerCase());

          // check if the default market pair is found in the coin list
          if (index > -1) {
            // get the usd value of the default market pair from coingecko
            coingecko.get_data(coin_list[index].id,  function (err, last_usd) {
              // check for errors
              if (err == null) {
                // get current stats
                StatsDb[net].findOne({coin: settings.coin.name}, function(err, stats) {
                  // update the last usd price
                  StatsDb[net].updateOne({coin: settings.coin.name}, {
                    last_usd_price: (last_usd * stats.last_price)
                  }, function() {
                    // last usd price updated successfully
                    return cb(null);
                  });
                });
              } else {
                // return error msg
                return cb(err);
              }
            });
          } else {
            // return error msg
            return cb('cannot find symbol ' + symbol + ' in the coingecko api');
          }
        } else {
          // return error msg
          return cb(err);
        }
      });
    } else {
      // default exchange is not enabled so just exit without updating last price for now
      return cb(null);
    }
  },

  coinbase_supply: function(cb, net='mainnet') {
    AddressDb[net].findOne({a_id: 'coinbase'}, function(err, address) {
      if (address)
        return cb(address.sent);
      else
        return cb(0);
    });
  },

  get_supply: function(net='mainnet', cb) {
  if (settings.sync.supply == 'COINBASE') {
    module.exports.coinbase_supply(function(supply) {
      return cb(supply/100000000);
    }, net);
    } else {
      lib.get_supply(net, function(supply) {
        return cb(supply/100000000);
      });
    }
  },

  // updates stats data for given coin; called by sync.js
  update_db: function(net='mainnet', coin, cb) {
    lib.get_blockcount(function (count) {
      // check to ensure count is a positive number
      if (!count || (count != null && typeof count === 'number' && count < 0)) {
        console.log('Error: Unable to connect to explorer API');

        return cb(false);
      }

      module.exports.get_supply(net, function (supply) {
        lib.get_connectioncount(net, function (connections) {
          StatsDb[net].findOne({coin: coin}, function(err, stats) {
            if (stats) {
              StatsDb[net].updateOne({coin: coin}, {
                coin: coin,
                count : count,
                supply: (supply ? supply : 0),
                connections: (connections ? connections : 0)
              }, function(err) {
                if (err)
                  console.log("Error during stats update: %s", err);

                return cb({
                  coin: coin,
                  count : count,
                  supply: (supply ? supply : 0),
                  connections: (connections ? connections : 0),
                  last: (stats.last ? stats.last : 0),
                  txes: (stats.txes ? stats.txes : 0)
                });
              });
            } else {
              console.log("Error during stats update: %s", (err ? err : 'Cannot find stats collection'));
              return cb(false);
            }
          });
        });
      });
    }, net);
  },

  create_peer: function(params, cb, net='mainnet') {
    const dto = PeersDb[net].create(params);
    if (dto) {
      return cb();
    } else {
      console.log(err);
      return cb();
    }
  },

  find_peer: function(address, port, cb, net='mainnet') {
    PeersDb[net].findOne({address: address, port: port}, function(err, peer) {
      if (err)
        return cb(null);
      else {
        if (peer)
          return cb(peer);
        else
          return cb (null)
      }
    });
  },

  drop_peer: function(address, port, cb, net='mainnet') {
    PeersDb[net].deleteOne({address: address, port: port}, function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else
        return cb();
    });
  },

  drop_peers: function(cb, net='mainnet') {
    PeersDb[net].deleteMany({}, function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else
        return cb();
    });
  },

  get_peers: function(cb, net='mainnet') {
    PeersDb[net].find().sort({address: 1, protocol: -1, port: 1}).exec(function (err, peers) {
      if (err) {
        return cb([]);
      } else {
        return cb(peers);
      }
    });
  },

  check_masternodes_and_upgrade_schema: function(cb, net='mainnet') {
    MasternodeDb[net].count({}, function(err, count) {
      if (err) {
        console.error("Failed to check masternode database: %s", err)
        return cb(-1);
      } else
        return cb(count);
    });
  },

  // determine if masternode exists and save masternode to collection
  save_masternode: function (raw_masternode, cb, net='mainnet') {
    // lookup masternode in local collection
    module.exports.find_masternode((raw_masternode.proTxHash != null ? raw_masternode.proTxHash : raw_masternode.txhash), function (masternode) {
      // determine if the claim address feature is enabled
      if (settings.get(net, 'claim_address_page').enabled == true) {
        // claim address is enabled so lookup the address claim name
        find_address((raw_masternode.proTxHash != null ? raw_masternode.payee : raw_masternode.addr), false, function(address) {
          if (address) {
            // save claim name to masternode obejct
            raw_masternode.claim_name = address.name;
          } else {
            // save blank claim name to masternode obejct
            raw_masternode.claim_name = '';
          }

          // add/update the masternode
          module.exports.add_update_masternode(raw_masternode, (masternode == null), function(success) {
            return cb(success);
          }, net);
        }, net);
      } else {
        // claim address is disabled so add/update the masternode
        module.exports.add_update_masternode(raw_masternode, (masternode == null), function(success) {
          return cb(success);
        }, net);
      }
    }, net);
  },

  // add or update a single masternode
  add_update_masternode(masternode, add, cb, net='mainnet') {
    if (masternode.proTxHash == null && masternode.txhash == null) {
      console.log('Masternode update error: Tx Hash is missing');
      return cb(false);
    } else {
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
        });
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
        });
      }
      if (dto) {
        return cb(true);
      } else {
        return cb(false);
      }

      } else {
        // update existing masternode in local collection
        MasternodeDb[net].updateOne({ txhash: (masternode.proTxHash != null ? masternode.proTxHash : masternode.txhash) }, masternode, function (err) {
          if (err) {
            console.log(err);
            return cb(false);
          } else
            return cb(true);
        });
      }
    }
  },

  // find masternode by txid
  find_masternode: function (txhash, cb, net='mainnet') {
    MasternodeDb[net].findOne({ txhash: txhash }, function (err, masternode) {
      if (err)
        return cb(null);
      else {
        if (masternode)
          return cb(masternode);
        else
          return cb(null);
      }
    });
  },

  // remove masternodes older than 24 hours
  remove_old_masternodes: function (cb, net='mainnet') {
    MasternodeDb[net].deleteMany({ lastseen: { $lte: (Math.floor(Date.now() / 1000) - 86400) } }, function (err) {
      if (err) {
        console.log(err);
        return cb();
      } else
        return cb();
    });
  },

  // get the list of masternodes from local collection
  get_masternodes: function (cb, net='mainnet') {
    MasternodeDb[net].find({}, function (err, masternodes) {
      if (err)
        return cb([]);
      else
        return cb(masternodes);
    });
  },

  // get the list of masternodes from local collection
  count_masternodes: function (cb, net='mainnet') {
    MasternodeDb[net].count({}, function (err, masternodes) {
      if (err)
        return cb({});
      else {
        MasternodeDb[net].count({ status: 'ENABLED'}, function (err, enabled) {
          if (err)
            return cb({});
          else 
            r = {}
            r.count = masternodes
            r.active = enabled
            return cb(r);
        });
      }
    });
  },

  get_masternode_rewards: function(mnPayees, since, cb, net='mainnet') {
    TxDb[net].aggregate([
      { $match: {
        "blockindex": { $gt: Number(since) },
        "vin": []
      }},
      { "$unwind": "$vout" },
      { $match: {
        "vout.addresses": { $in: [mnPayees] }
      }}
    ], function(err, data) {
      if (err) {
        console.log(err);
        return cb(null);
      } else
        return cb(data);
    });
  },

  get_masternode_rewards_totals: function(mnPayees, since, cb, net='mainnet') {
    TxDb[net].aggregate([
      { $match: {
        "blockindex": { $gt: Number(since) },
        "vin": []
      }},
      { "$unwind": "$vout" },
      { $match: {
        "vout.addresses": { $in: [mnPayees] }
      }},
      { $group: { _id: null, total: { $sum: "$vout.amount" } } }
    ], function(err, data) {
      if (err) {
        console.log(err);
        return cb(null);
      } else
        return cb((data.length > 0 ? data[0].total / 100000000 : 0));
    });
  },

  // updates last_updated stats; called by sync.js
  update_last_updated_stats: function (coin, param, cb, net='mainnet') {
    if (param.blockchain_last_updated) {
      // update blockchain last updated date
      StatsDb[net].updateOne({ coin: coin }, {
        blockchain_last_updated: param.blockchain_last_updated
      }, function () {
        return cb(true);
      });
    } else if (param.reward_last_updated) {
      // update reward last updated date
      StatsDb[net].updateOne({ coin: coin }, {
        reward_last_updated: param.reward_last_updated
      }, function () {
        return cb(true);
      });
    } else if (param.masternodes_last_updated) {
      // update masternode last updated date
      StatsDb[net].updateOne({ coin: coin }, {
        masternodes_last_updated: param.masternodes_last_updated
      }, function () {
        return cb(true);
      });
    } else if (param.network_last_updated) {
      // update network last updated date
      StatsDb[net].updateOne({ coin: coin }, {
        network_last_updated: param.network_last_updated
      }, function () {
        return cb(true);
      });
    } else if (param.richlist_last_updated) {
      // update richlist last updated date
      StatsDb[net].updateOne({ coin: coin }, {
        richlist_last_updated: param.richlist_last_updated
      }, function () {
        return cb(true);
      });
    } else if (param.markets_last_updated) {
      // update markets last updated date
      StatsDb[net].updateOne({ coin: coin }, {
        markets_last_updated: param.markets_last_updated
      }, function () {
        return cb(true);
      });
    } else {
      // invalid option
      return cb(false);
    }
  },

  populate_claim_address_names: function(tx, cb, net='mainnet') {
    var addresses = [];

    // loop through vin addresses
    tx.vin.forEach(function (vin) {
      // check if this address already exists
      if (addresses.indexOf(vin.addresses) == -1) {
        // add address to array
        addresses.push(vin.addresses);
      }
    });

    // loop through vout addresses
    tx.vout.forEach(function (vout) {
      // check if this address already exists
      if (addresses.indexOf(vout.addresses) == -1) {
        // add address to array
        addresses.push(vout.addresses);
      }
    });

    // loop through address array
    lib.syncLoop(addresses.length, function (loop) {
      var a = loop.iteration();

      module.exports.get_address(addresses[a], false, function(address) {
        if (address && address.name != null && address.name != '') {
          // look for address in vin
          for (v = 0; v < tx.vin.length; v++) {
            // check if this is the correct address
            if (tx.vin[v].addresses == address.a_id) {
              // add claim name to array
              tx.vin[v]['claim_name'] = address.name;
            }
          }

          // look for address in vout
          for (v = 0; v < tx.vout.length; v++) {
            // check if this is the correct address
            if (tx.vout[v].addresses == address.a_id) {
              // add claim name to array
              tx.vout[v]['claim_name'] = address.name;
            }
          }
        }

        loop.next();
      }, net);
    }, function() {
      // return modified tx object
      return cb(tx);
    });
  },

  get_network_chart_data: function(cb, net='mainnet') {
    // lookup all network history data for populating network charts
    NetworkHistoryDb[net].find().sort({blockindex: 1}).exec(function (err, data) {
      return cb(data);
    });
  },

  check_networkhistory_and_upgrade_schema: function(cb, net='mainnet') {
    NetworkHistoryDb[net].count({}, function(err, count) {
      if (err) {
        console.error("Failed to check network history: '%s'", err)
        return cb(-1);
      } else
        return cb(count);
  1 });
  },

  initialize_data_startup: function(cb, net='mainnet') {
    net = settings.getNet(net)
    if (net == null) {
      console.error("Failed to initialize DB for chain '%s'. Exit.", net)
      exit(1);
    }
    const coin = settings.getCoin(net)

    console.log('%s %s initialize DB...', net, coin.name);

    // check if stats collection is initialized
    module.exports.check_stats(coin.name, function(stats_exists) {
      var skip = true;
      // determine if stats collection already exists
      if (stats_exists == false) {
        console.log('No stats entry found. Creating new entry now...');
        skip = false;
      }
      // initialize the stats collection
      module.exports.create_stats(coin.name, skip, function() {
        // check and initialize the markets collection
        console.log("  * %s stats created. Init markets now...", net)
        init_markets(function() {
          module.exports.check_txes_and_upgrade_schema(function(countTx) {
            console.log("  * %s TX DB count %d.", net, countTx)
            module.exports.check_masternodes_and_upgrade_schema(function(countMn) {
              console.log("  * %s masternode DB count %d.", net, countMn)
              module.exports.check_networkhistory_and_upgrade_schema(function(countNh) {
                console.log("  * %s network history DB count %d.", net, countNh)
                module.exports.check_richlist_and_upgrade_schema(settings.coin.name, function(richlist_exists) {
                  console.log("  * %s richlist initialized: %s.", net, richlist_exists)
                  // initialize the richlist if required.
                  module.exports.create_richlist(settings.coin.name, richlist_exists, function() {
                    // check and initialize the heavycoin collection
                    init_heavy(function() {
                      // finished initializing startup data
                      console.log('%s DB initialization complete.', net);
                      return cb();
                    }, net);
                  }, net);
                }, net);
              }, net);
            }, net);
          }, net);
        }, net);
      }, net);
    }, net);
  },

  remove_sync_message: function(net='mainnet') {
    const filePath = './tmp/show_sync_message-' + net + '.tmp';
    // Check if the show sync stub file exists
    if (fs.existsSync(filePath)) {
      // File exists, so delete it now
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.log(err);
      }
    }
  },

  save_tx: function(net, txid, blockheight, cb) {
    lib.get_rawtransaction(txid, function(tx) {
      if (tx && tx != 'There was an error. Check your console.') {
        lib.prepare_vin(net, tx, function(vin, tx_type_vin) {
          lib.prepare_vout(net, tx.vout, txid, vin, ((!settings.blockchain_specific.zksnarks.enabled || typeof tx.vjoinsplit === 'undefined' || tx.vjoinsplit == null) ? [] : tx.vjoinsplit), function(vout, nvin, tx_type_vout) {
            lib.syncLoop(vin.length, function (loop) {
              var i = loop.iteration();

              // check if address is inside an array
              if (Array.isArray(nvin[i].addresses)) {
                // extract the address
                nvin[i].addresses = nvin[i].addresses[0];
              }

              update_address(nvin[i].addresses, blockheight, txid, nvin[i].amount, 'vin', function() {
                loop.next();
              }, net);
            }, function() {
              lib.syncLoop(vout.length, function (subloop) {
                var t = subloop.iteration();

                // check if address is inside an array
                if (Array.isArray(vout[t].addresses)) {
                  // extract the address
                  vout[t].addresses = vout[t].addresses[0];
                }

                if (vout[t].addresses) {
                  update_address(vout[t].addresses, blockheight, txid, vout[t].amount, 'vout', function() {
                    subloop.next();
                  }, net);
                } else
                  subloop.next();
              }, function() {
                lib.calculate_total(vout, function(total) {
                  var op_return = null;
                  // check if the op_return value should be decoded and saved
                  const transaction_page = settings.get(net, 'transaction_page')
                  if (transaction_page.show_op_return) {
                    // loop through vout to find the op_return value
                    tx.vout.forEach(function (vout_data) {
                      // check if the op_return value exists
                      if (vout_data.scriptPubKey != null && vout_data.scriptPubKey.asm != null && vout_data.scriptPubKey.asm.indexOf('OP_RETURN') > -1) {
                        // decode the op_return value
                        op_return = hex_to_ascii(vout_data.scriptPubKey.asm.replace('OP_RETURN', '').trim());
                      }
                    });
                  }
                  const dto = TxDb[net].create({
                    version: tx.version,
                    txid: tx.txid,
                    tx_type: tx.type,
                    size: tx.size,
                    locktime: tx.locktime,
                    instantlock: tx.instantlock,
                    chainlock: tx.chainlock,
                    vin: nvin,
                    vout: vout,
                    total: total.toFixed(8),
                    timestamp: tx.time,
                    blockhash: tx.blockhash,
                    blockindex: blockheight,
                    op_return: op_return
                  });
                  if (dto) {
                    return cb(null, vout.length > 0);
                  } else {
                    return cb("Failed to store TX.", false);
                  }
                });
              });
            });
          });
        });
      } else
        return cb('tx not found: ' + txid, false);
    }, net);
  },

  fs: fs
};