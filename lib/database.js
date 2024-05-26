const debug = require('debug')('debug')
const settings = require('./settings')
const mongoose = require('mongoose')
const lib = require('./x')
const fs = require('fs')
const coingecko = require('./apis/coingecko')
const datautil = require('./datautil')

const StatsDb = []
const DbIndexDb = []
const MarketsDb = []
const MarketOrderDb = []
const MarketTradeDb = []
const AddressDb = []
const AddressTxDb = [] 
const BlockDb = []
const TxDb = [] 
const PeersDb = []
const MasternodeDb = []
const RichlistDb = []
const NetworkHistoryDb = []
const TokenDb = []
const HeavyDb = []

function find_address(hash, caseSensitive, cb, net=settings.getDefaultNet()) {
  if (caseSensitive) {
    // faster search but only matches exact string including case
    AddressDb[net].findOne({a_id: hash}).then((address) => {
      if (address)
        return cb(address)
      else
        return cb()
    }).catch((err) => {
      console.error("Failed to find address '%s' for chain '%s': %s", address, net, err)
      return cb()
    })
  } else {
    // slower search but matches exact string ignoring case
    AddressDb[net].findOne({a_id: {$regex: '^' + hash + '$', $options: 'i'}}).then((address) => {
      if (address)
        return cb(address)
      else
        return cb()
    }).catch((err) => {
      console.error("Failed to find address '%s' for chain '%s': %s", "<not found>", net, err)
      return cb()
    });
  }
}

// unused
function find_address_tx(address, hash, cb, net=settings.getDefaultNet()) {
  AddressTxDb[net].findOne({a_id: address, txid: hash}).then((address_tx) => {
    if (address_tx)
      return cb(address_tx);
    else
      return cb();
  }).catch((err) => {
    console.error("Failed to find address '%s' tx for chain '%s': %s", address, net, err)
    return cb();
  });
}

function find_richlist(coin, cb, net=settings.getDefaultNet()) {
  RichlistDb[net].findOne({coin: coin}).then((richlist) => {
    if (richlist)
      return cb(richlist)
    else
      return cb()
  }).catch((err) => {
    console.error("Failed to find richlist for chain '%s': %s", net, err)
    return cb()
  })
}

function find_tx(txid, cb, net=settings.getDefaultNet()) {
  TxDb[net].findOne({txid: txid}).then((tx) => {
    if (tx)
      return cb(tx)
    else
      return cb(null)
    }).catch((err) => {
      console.error("Failed to find tx '%s' for chain '%s': %s", txid, net, err)
      return cb(null)
  });
}

function get_market_data(market, coin_symbol, pair_symbol, reverse, cb, net=settings.getDefaultNet()) {
  if (fs.existsSync('./lib/markets/' + market + '.js')) {
    exMarket = require('./markets/' + market);
    exMarket.get_data({net: net, coin: coin_symbol, exchange: pair_symbol, reverse: reverse}, function(err, obj) {
      return cb(err, obj);
    });
  } else
    return cb(null);
}

// unused
function check_add_db_field(model_obj, field_name, default_value, cb, net=settings.getDefaultNet()) {
  // determine if a particular field exists in a db collection
  model_obj.findOne({[field_name]: {$exists: false}}).then((model_data) => {
    // check if field exists
    if (model_data) {
      // add field to all documents in the collection
      model_obj.updateMany({}, {
        $set: { [field_name]: default_value }
      }).then(() => {
        return cb(true)
      }).catch((err) => {
        console.error("Failed to update model '%s' field '%s' for chain '%s': %s", model_obj, field_name, net, err)
        return cb(false)
      });
    } else
      return cb(false)
  }).catch((err) => {
    console.error("Failed to find missing model '%s' field '%s' for chain '%s': %s", model_obj, field_name, net, err)
    return cb(false)
  });
}

// unused
function check_rename_db_field(model_obj, old_field_name, new_field_name, cb, net=settings.getDefaultNet()) {
  // determine if a particular field exists in a db collection
  model_obj.findOne({[old_field_name]: {$exists: false}}).then((model_data) => {
    // check if old field exists
    if (model_data) {
      // rename field
      model_obj.updateMany({}, {
        $rename: { [old_field_name]: new_field_name }
      }, { multi: true, strict: false }).then(() => {
        return cb(true)
      }).catch((err) => {
        console.error("Failed to rename model '%s' field '%s' for chain '%s': %s", model_obj, field_name, net, err)
        return cb(false)
      });
    } else
      return cb(false)
  }).catch((err) => {
    console.error("Failed to rename model '%s' field '%s' for chain '%s': %s", model_obj, field_name, net, err)
    return cb(false)
  })
}

function hex_to_ascii(hex) {
    var str = '';
    for (var i = 0; i < hex.length; i += 2)
      str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    return str;
}

function init_heavy(cb, net=settings.getDefaultNet()) {
  if (settings.blockchain_specific.heavycoin.enabled == true) {
    const coin = settings.getCoin(net)
    module.exports.check_heavy(coin.name, function(exists) {
      if (exists == false) {
        console.log('No heavycoin entry found. Creating new entry now..');
        module.exports.create_heavy(coin.name, function() {
          return cb();
        }, net);
      } else
        return cb();
    }, net);
  } else
    return cb();
}

function copyHistoryParam(data, market, coin_symbol, pair_symbol, now) {
  data['ex'] = market
  data['market'] = coin_symbol
  data['trade'] = pair_symbol
  data['type'] = (("SELL".toString() === data.ordertype || "sell".toString() === data.ordertype) ? 1 : 0)
  delete data.orderType
  data['date'] = now
}

function find_token(query, cb, net=settings.getDefaultNet()) {
  TokenDb[net].find(query).then((token) => {
    if (token)
      return cb(token)
    else
      return cb(null)
    }).catch((err) => {
      console.error("Failed to find token for query '%s' and chain '%s': %s", query, net, err)
      return cb(null)
  })
}

module.exports = {
  StatsDb: StatsDb,
  DbIndexDb: DbIndexDb,
  AddressDb: AddressDb,
  AddressTxDb: AddressTxDb,
  BlockDb: BlockDb,
  TxDb: TxDb,
  RichlistDb: RichlistDb,
  lib: lib,
  // initialize DB
  connect: function(database, cb) {
    mongoose.set('strictQuery', true);
    mongoose.connect(database.then(() => {
      return cb();
    }).catch((err) => {
      console.error('Failed to connect to db: %s', err);
      process.exit(999);
    }))
  },

  connection_factory: function(net, dbstring, cb) {
    mongoose.set('strictQuery', true)
    const con = mongoose.createConnection(dbstring)
    
    StatsDb[net] = con.model('coinstats', require('../models/stats'))
    DbIndexDb[net] = con.model('dbindex', require('../models/dbindex'))
    MarketsDb[net] = con.model('Markets', require('../models/markets'))
    MarketOrderDb[net] = con.model('MarketOrder', require('../models/marketorder'))
    MarketTradeDb[net] = con.model('MarketTrade', require('../models/markettrade'))
    AddressDb[net] = con.model('Address', require('../models/address'))
    AddressTxDb[net] = con.model('AddressTx', require('../models/addresstx'))
    BlockDb[net] = con.model('Block', require('../models/block'))
    TxDb[net] = con.model('Tx', require('../models/tx'))
    PeersDb[net] = con.model('Peers', require('../models/peers'))
    MasternodeDb[net] = con.model('Masternode', require('../models/masternode'))
    RichlistDb[net] = con.model('Richlist', require('../models/richlist'))
    NetworkHistoryDb[net] = con.model('NetworkHistory', require('../models/networkhistory'))
    TokenDb[net] = con.model('Token', require('../models/token'))
    HeavyDb[net] = con.model('Heavy', require('../models/heavy'))

    return cb(con);
  },

  check_show_sync_message: function(net=settings.getDefaultNet()) {
    return fs.existsSync('./tmp/show_sync_message-' + net + '.tmp');
  },

  find_txs_by_height: function(height, cb, net=settings.getDefaultNet()) {
    TxDb[net].find({height: height}).then((tx) => {
      if (tx)
        return cb(tx)
      else
        return cb(null)
      }).catch((err) => {
        console.error("Failed to find txs for height '%d' for chain '%s': %s", height, net, err)
        return cb(null)
    })
  },

  find_txs_by_blockhash: function(blockhash, cb, net=settings.getDefaultNet()) {
    TxDb[net].find({blockhash: blockhash}).then((tx) => {
      if (tx)
        return cb(tx)
      else
        return cb(null)
      }).catch((err) => {
        console.error("Failed to find txs for height '%d' for chain '%s': %s", height, net, err)
        return cb(null)
    })
  },

  update_label: function(hash, claim_name, cb, net=settings.getDefaultNet()) {
    find_address(hash, false, function(address) {
      if (address) {
        AddressDb[net].updateOne({a_id: hash}, {
          name: claim_name
        }).then(() => {
          // update claim name in richlist
          module.exports.update_richlist_claim_name(hash, claim_name, function() {
            // update claim name in masternode list
            module.exports.update_masternode_claim_name(hash, claim_name, function() {
              return cb('');
            }, net);
          }, net);
        }).catch((err) => {
          console.error("Failed to update address '%s' for chain '%s': %s", hash, net, err)
          return cb(err);
        });
      } else {
        // address is not valid or does not have any transactions
        return cb('no_address');
      }
    }, net);
  },

  update_richlist_claim_name: function(hash, claim_name, cb, net=settings.getDefaultNet()) {
    const richlist_page = settings.get(net, 'richlist_page')
    if (richlist_page.enabled == true) {
      const coin = settings.getCoin(net)
      // ensure that if this address exists in the richlist that it displays the new alias
      module.exports.get_richlist(coin.name, function(richlist) {
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
          RichlistDb[net].updateOne({coin: coin.name}, {
            received: richlist.received,
            balance: richlist.balance
          }).then(() => {
            return cb('');
          }).catch((err) => {
            console.error("Failed to update richlist name claim '%s' for address '%s' for chain '%s': %s", claim_name, hash, net, err)
            // return cb(err);
          })
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

  update_masternode_claim_name: function(hash, claim_name, cb, net=settings.getDefaultNet()) {
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
          }).then(() => {
            return cb('');
          }).catch((err) => {
            console.error("Failed to update masternode name claim '%s' for address '%s' for chain '%s': %s", claim_name, hash, net, err)
            // return cb(err);
          })
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

  check_stats: function(coinName, cb, net=settings.getDefaultNet()) {
    StatsDb[net].findOne({coin: coinName}).then((data) => {
      if (data) {
        return cb(true)
      } else
        return cb(false)
    }).catch((err) => {
      console.error("Failed to check stats for chain '%s': %s", net, err)
      // TODO: Fix this.
      // return cb(null)
    })
  },

  get_stats: function(coinName, cb, net=settings.getDefaultNet()) {
    StatsDb[net].findOne({coin: coinName}).then((data) => {
      return cb(data)
    }).catch((err) => {
      console.error("Failed to find stats for chain '%s': %s", net, err)
      return cb(null)
    })
  },

  create_stats: function(coinName, skip, cb, net=settings.getDefaultNet()) {
    // check if stats need to be created
    if (!skip) {
      console.log("Try to init initial stats.")
      const dto = StatsDb[net].create({
        coin: coinName,
        chain: net,
        last: 0
      });
      if (dto) {
          console.log("Initial stats entry created for %s.", coinName)
      }
      return cb(dto)
    } else
      return cb()
  },

  get_dbindex: function(coinName, cb, net=settings.getDefaultNet()) {
    DbIndexDb[net].findOne({coin: coinName}).then((data) => {
      return cb(data)
    }).catch((err) => {
      console.error("Failed to find dbindex for chain '%s': %s.", net, err)
      return cb(null)
    })
  },

  
  },

  get_tip_by_blocks: function(cb, net=settings.getDefaultNet()) {
    BlockDb[net].find().sort({ height: -1}).limit(1).then((tip) => {
      return cb(tip.height)
    }).catch((err) => {
      console.error("Failed to get current tip for chain '%s': %s. No blocks availble!", net, err)
      return cb(err)
    })
  },

  find_block_by_height: function(height, cb, net=settings.getDefaultNet()) {
    BlockDb[net].findOne({height: height}).then((block) => {
      return cb(block)
    }).catch((err) => {
      console.error("Failed to find block %d for chain '%s': %s", height, net, err)
      return cb(err)
    })
  },

  find_block_by_hash: function(hash, cb, net=settings.getDefaultNet()) {
    BlockDb[net].findOne({hash: hash}).then((block) => {
      return cb(block)
    }).catch((err) => {
      console.error("Failed to find block '%s' for chain '%s': %s", hash, net, err)
      return cb(err)
    })
  },

  get_richlist: function(coin, cb, net=settings.getDefaultNet()) {
    const r = richlistCache.get(net)
  },

  get_tx: function(txid, cb, net=settings.getDefaultNet()) {
    find_tx(txid, function(tx) {
      return cb(tx);
    }, net);
  },

  get_txs: function(block, cb, net=settings.getDefaultNet()) {
    var txs = [];

    // block.tx.length
    lib.syncLoop(block.numtx, function (loop) {
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

  get_last_txs: function(start, length, min, type, internal, cb, net=settings.getDefaultNet()) {
    this.get_last_txs_ajax(start, length, min, type, function(txs, count) {
      const tx_types = settings.get(net, 'tx_types')
      const data = []
      for (i = 0; i < txs.length; i++) {
        const amount = !isNaN(txs[i].total) ? txs[i].total / 100000000 : '-'
        const tx_type = !isNaN(txs[i].tx_type) ? tx_types[parseInt(txs[i].tx_type)] : '-'
        if (internal) {
          const row = []
          row.push(txs[i].blockindex)
          row.push(txs[i].blockhash)
          row.push(txs[i].txid)
          row.push(txs[i].vout.length)
          row.push(amount)
          row.push(txs[i].timestamp)
          data.push(row)
        } else {
          data.push({
            blockindex: txs[i].blockindex,
            blockhash: txs[i].blockhash,
            txid: txs[i].txid,
            type: tx_type,
            version: txs[i].version,
            senders: txs[i].vin.length,
            recipients: txs[i].vout.length,
            amount: (amount),
            size: txs[i].size,
            locktime: txs[i].locktime,
            instantlock: txs[i].instantlock,
            chainlock: txs[i].chainlock,
            timestamp: txs[i].timestamp,
            op_return: txs[i].op_return,
            extra: txs[i].extra
          })
        }
      }
      return cb(data, count)
    }, net)
  },

  get_last_txs_ajax: function(start, length, min=0, type, cb, net=settings.getDefaultNet()) {
    debug("Get last txes starting %d, length %d, min. amount %d, type %s for chain '%s'.", start, length, min, type, net)
    
    // get last transactions, optional by tx_type.
    var findCriteria = {'total': {$gte: min}}
    if (!isNaN(type) && type > -1) {
      findCriteria = {'total': {$gte: min}, 'tx_type': type}
    }

    if (min > 0) {
      // min is greater than zero which means we must pull record count from the txes collection.
      TxDb[net].find({'total': {$gte: min}}).countDocuments().then((count) => {   
        TxDb[net].find(findCriteria).sort({blockindex: -1}).skip(Number(start)).limit(Number(length)).exec().then((data) => {
          return cb(data, count)
        }).catch((err) => {
          console.error("Failed to find txes for chain '%s': %s", net, err)
          return cb(err)
        })
      }).catch((err) => {
        console.error("Failed to find txes for chain '%s': %s", net, err)
        return cb(null)
      })
    } else {
      // min is zero (shouldn't ever be negative) which means we must pull record count from the coinstats collection.
      const coin = settings.getCoin(net)
      StatsDb[net].findOne({coin: coin.name}).then((stats) => {
        TxDb[net].find(findCriteria).sort({blockindex: -1}).skip(Number(start)).limit(Number(length)).exec().then((txs) => {
          return cb(txs, stats ? stats.txes : 0)
        }).catch((err) => {
          console.error("Failed to find txes for chain '%s': %s", net, err)
          return cb(err)
        })
      }).catch((err) => {
        console.error("Failed to find chain stats for chain '%s': %s", net, err)
        return cb(err)
      })
    }
  },

  get_address_txs_ajax: function(hash, start, length, cb, net=settings.getDefaultNet()) {
    var totalCount = 0;

    AddressTxDb[net].find({a_id: hash}).countDocuments().then((count) => {
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
        ]).then((balance_sum) => {
          AddressTxDb[net].find({a_id: hash}).sort({blockindex: -1}).skip(Number(start)).limit(Number(length)).exec().then((address_tx) => {
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
            
          }).catch((err) => {
            console.error("Failed to find address '%s' tx for chain '%s': %s", hash, net, err)
            return cb(err)
          })
        }).catch((err) => {
          console.error("Failed to aggregate address '%s' tx for chain '%s': %s", hash, net, err)
          return cb(err)
        })
    }).catch((err) => {
      console.error("Failed to count address '%s' tx for chain '%s': %s", hash, net, err)
      return cb(err)
    })
  },

  // gets market data for given market and trading pair
  get_market: function(market, coin_symbol, pair_symbol, cb, net=settings.getDefaultNet()) {
    MarketsDb[net].findOne({market: market, coin_symbol: coin_symbol, pair_symbol: pair_symbol}).then((data) => {
      return cb(data ? data : null)
    }).catch((err) => {
      console.error("Failed to get market '%s' - '%s'/'%s' tx for chain '%s': %s", market, coin_symbol, pair_symbol, net, err)
      return cb(null)
    })
  },

  // gets market trade history data for given market and trading pair sorted by timestamp descending
  get_market_trade_history: function(market, coin_symbol, pair_symbol, cb, net=settings.getDefaultNet()) {
    MarketTradeDb[net].find({ex: market, market: coin_symbol, trade: pair_symbol}).sort({timestamp: -1}).then((data) => {
      return cb(data ? data : null)
    }).catch((err) => {
      console.error("Failed to get market trade history '%s' - '%s'/'%s' tx for chain '%s': %s", market, coin_symbol, pair_symbol, net, err)
      return cb(null)
    })
  },

  // gets market orders data for given market and trading pair ordered by price descending.
  get_market_order_aggregation: function(ex, market, trade, type, reverse, cb, net=settings.getDefaultNet()) {
    const order = type == 1 ? 1 : -1
    if (type == 0)
      type = -1
    if (type == -1)
      type = 0
    // market = reverse == true ? trade : market
    // trade = reverse == true ? market : trade
    MarketOrderDb[net].find({ex: ex, market: market, trade: trade, type: type}).sort({price: order}).then((data) => {
      return cb(data ? data : null)
    }).catch((err) => {
      console.error("Failed to get market orders '%s' - '%s'/'%s' for chain '%s': %s", ex, market, trade, net, err)
      return cb(null)
    })
  },

  // gets buy orders aggregation for a given market and trading pair ordered by price descending.
  get_buy_order_aggregation: function(ex, market, trade, reverse, cb, net=settings.getDefaultNet()) {
    const type = reverse == true ? 1 : 0
    const order = reverse == true ? 1 : -1
    MarketOrderDb[net].find({ex: ex, market: market, trade: trade, type: type}).sort({price: order}).then((data) => {
      return cb(data ? data : null)
    }).catch((err) => {
      console.error("Failed to get buy orders aggregation '%s' - '%s'/'%s' (reverse=%s) for chain '%s': %s", ex, market, trade, reverse, net, err)
      return cb(null)
    })
  },

  // gets sell orders aggregation for a given market and trading pair ordered by price ascending.
  get_sell_order_aggregation: function(ex, market, trade, reverse, cb, net=settings.getDefaultNet()) {
    const type = reverse == true ? 0 : 1
    MarketOrderDb[net].find({ex: ex, market: market, trade: trade, type: type}).sort({price: 1}).then((data) => {
      return cb(data ? data : null)
    }).catch((err) => {
      console.error("Failed to get sell orders aggregation '%s' - '%s'/'%s' (reverse=%s) for chain '%s': %s", ex, market, trade, reverse, net, err)
      return cb(null)
    })
  },

  // gets all markets without buys, sells and historical data.
  get_markets_summary: function(cb, net=settings.getDefaultNet()) {
    MarketsDb[net].find({}, { _id: 0, market: 1, referal: 1, coin_symbol: 1, pair_symbol: 1, reverse: 1, summary: 1, ext_market_url: 1, referal: 1, logo: 1 }).then((data) => {
      return cb(data ? data : null)
    }).catch((err) => {
      console.error("Failed to get market summary for chain '%s': %s", net, err)
      // return cb(null)
    })
  },

  // gets all markets including buys, sells and historical data.
  get_markets: function(cb, net=settings.getDefaultNet()) {
    MarketsDb[net].find({}, { _id: 0, market: 1, coin_symbol: 1, pair_symbol: 1, summary: 1, chartdata: 1, buys: 1, sells: 1, history: 1, ext_market_url: 1, referal: 1, logo: 1 }).then((data) => {
      return cb(data ? data : null)
    }).catch((err) => {
      console.error("Failed to find market for chain '%s': %s", net, err)
      // return cb(null)
    })
  },

  create_heavy: function(coin, cb, net=settings.getDefaultNet()) {
    const dto = new HeavyDb[net].create({
      coin: coin
    });
    if (dto) {
      console.log("Initial heavycoin entry created for %s", coin);
    }
    return cb();
  },

  check_heavy: function(coin, cb, net=settings.getDefaultNet()) {
    HeavyDb[net].findOne({coin: coin}, function(err, exists) {
      if (exists)
        return cb(true);
      else
        return cb(false);
    });
  },

  get_heavy: function(coin, cb, net=settings.getDefaultNet()) {
    HeavyDb[net].findOne({coin: coin}, function(err, heavy) {
      if (heavy)
        return cb(heavy);
      else
        return cb(null);
    });
  },

  get_distribution: function(richlist, stats, cb, net=settings.getDefaultNet()) {
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

  // unused
  coinbase_supply: function(cb, net=settings.getDefaultNet()) {
    AddressDb[net].findOne({a_id: 'coinbase'}).then((address) => {
      return cb(address ? address.sent : 0)
    }).catch((err) => {
      console.error("Failed to get coin base supply for chain '%s': %s", net, err)
      return cb(0);
    });
  },

      })
  },

  get_peers: function(cb, net=settings.getDefaultNet()) {
    PeersDb[net].find().sort({address: 1, protocol: -1, port: 1}).exec().then((peers) => {
      return cb(peers)
    }).catch((err) => {
      console.error("Failed to get peers for chain '%s': %s", net, err)
      return cb([])
    })
  },

      module.exports.get_masternodes_local(cb, net)
    }
  },

  // get the list of masternodes
  get_masternodes: function (cb, net=settings.getDefaultNet()) {
    MasternodeDb[net].find({}).then((dtos) => {
      return cb(dtos)
    }).catch((err) => {
      console.error("Failed to find masternodes for chain '%s': %s", net, err)
      return cb([])
    })
  },

  // count masternodes total + enabled
  count_masternodes: function (cb, net=settings.getDefaultNet()) {
    MasternodeDb[net].countDocuments({}).then((masternodes) => {
      MasternodeDb[net].countDocuments({ status: 'ENABLED'}).then((enabled) => {
        r = {}
        r.count = masternodes
        r.active = enabled
        return cb(r)
      }).catch((err) => {
        console.error("Failed to count masternodes for chain '%s': %s", net, err)
        return cb({})
      })
    }).catch((err) => {
      console.error("Failed to count masternodes for chain '%s': %s", net, err)
      return cb({})
    })
  },

  get_masternode_rewards: function(mnPayees, since, cb, net=settings.getDefaultNet()) {
    TxDb[net].aggregate([
      { $match: {
        "blockindex": { $gt: Number(since) },
        "vin": []
      }},
      { "$unwind": "$vout" },
      { $match: {
        "vout.addresses": { $in: [mnPayees] }
      }}
    ]).then((data) => {
      return cb(data)
    }).catch((err) => {
      console.error("Failed to aggregate masternodes rewards for chain '%s': %s", net, err)
      return cb(null)
    })
  },

  get_masternode_rewards_totals: function(mnPayees, since, cb, net=settings.getDefaultNet()) {
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
    ]).then((data) => {
      return cb((data.length > 0 ? data[0].total / 100000000 : 0))
    }).catch((err) => {
      console.error("Failed to aggregate masternodes rewards for chain '%s': %s", net, err)
      return cb(null)
    })
  },

  populate_claim_address_names: function(tx, cb, net=settings.getDefaultNet()) {
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

  get_latest_networkhistory: function(height, cb, net=settings.getDefaultNet()) {
    NetworkHistoryDb[net].findOne({blockindex: height}).then((data) => {
      return cb(data)
    }).catch((err) => {
      console.error("Failed to find latest network history for chain '%s': %s", net, err)
      return cb(null)
    })
  },

  get_network_chart_data: function(cb, net=settings.getDefaultNet()) {
    // lookup all network history data for populating network charts
    NetworkHistoryDb[net].find().sort({blockindex: 1}).exec().then((data) => {
      return cb(data)
    }).catch((err) => {
      console.error("Failed to find network chart for chain '%s': %s", net, err)
      return cb(null)
    })
  },

  initialize_data_startup: function(cb, net=settings.getDefaultNet()) {
    net = settings.getNet(net)
    if (net == null) {
      console.error("Failed to initialize DB for chain '%s'. Exit.", net)
      exit(1);
    }
    const coin = settings.getCoin(net)

    console.log('- %s %s initialize DB...', net, coin.name);

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
        debug("  * %s stats created. Init TX DB now...", net)
        module.exports.get_stats(coin.name, function(stats) {
          console.log('+ %s DB initialization complete. Block height %d', net, stats ? stats.count : -1)
          return cb(stats)
        }, net)
      }, net)
    }, net)
  },

  get_token: function(query, cb, net=settings.getDefaultNet()) {
    find_token(query, function(token) {
      return cb(token)
    }, net)
  },

  },
  
  find_tx: find_tx,
  fs: fs,
  PeersDb: PeersDb,
  MasternodeDb: MasternodeDb,
  RichlistDb: RichlistDb,
  MarketsDb: MarketsDb,
  MarketOrderDb: MarketOrderDb,
  MarketTradeDb: MarketTradeDb,
  get_market_data: get_market_data,
  NetworkHistoryDb: NetworkHistoryDb,
};