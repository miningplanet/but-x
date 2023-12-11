const debug = require('debug')('debug')
const settings = require('./settings')
const mongoose = require('mongoose')
const lib = require('./explorer')
const fs = require('fs')
const coingecko = require('./apis/coingecko')
const datautil = require('./datautil')

const StatsDb = []
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

function update_address(hash, blockheight, txid, amount, type, cb, net=settings.getDefaultNet()) {
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
  }).then((address) => {
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
      }).then(() => {
        return cb();
      }).catch((err) => {
        console.error("Failed to find address tx '%s' for chain '%s': %s", hash, net, err)
        return cb(err);
      })
    } else
      return cb();
  }).catch((err) => {
    console.error("Failed to find address '%s' for chain '%s': %s", hash, net, err)
    return cb(err);
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

function get_market_data(market, coin_symbol, pair_symbol, cb, net=settings.getDefaultNet()) {
  if (fs.existsSync('./lib/markets/' + market + '.js')) {
    exMarket = require('./markets/' + market);
    exMarket.get_data({net: net, coin: coin_symbol, exchange: pair_symbol}, function(err, obj) {
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

function copyOrderParam(data, market, coin_symbol, pair_symbol, type, now) {
  data['ex'] = market
  data['market'] = coin_symbol
  data['trade'] = pair_symbol
  data['type'] = type
  data['date'] = now
}

function copyHistoryParam(data, market, coin_symbol, pair_symbol, now) {
  data['ex'] = market
  data['market'] = coin_symbol
  data['trade'] = pair_symbol
  data['type'] = (("SELL".toString() === data.ordertype || "sell".toString() === data.ordertype) ? 1 : 0)
  delete data.orderType
  data['date'] = now
}

module.exports = {
  StatsDb: StatsDb,
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

  check_txes_and_upgrade_schema: function(cb, net=settings.getDefaultNet()) {
    TxDb[net].countDocuments({}).then((count) => {
      return cb(count)
    }).catch((err) => {
      console.error("Failed to update schema tx for chain '%s': %s", net, err)
      return cb(-1)
    })
  },

  check_stats: function(coinName, cb, net=settings.getDefaultNet()) {
    StatsDb[net].findOne({coin: coinName}).then((data) => {
      if (data) {
        return cb(true)
      } else
        return cb(false)
    }).catch((err) => {
      console.error("Failed to check stats for chain '%s': %s", net, err)
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

  get_address: function(hash, caseSensitive, cb, net=settings.getDefaultNet()) {
    find_address(hash, caseSensitive, function(address) {
      return cb(address);
    }, net);
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

  create_block: function(block, cb, net=settings.getDefaultNet()) {
    var cbtx = null
    const d = block.cbTx
    if (d) {
      cbtx = []
      cbtx[0] = d.version
      cbtx[1] = d.height
      cbtx[2] = d.version
      cbtx[3] = d.merkleRootMNList == '0000000000000000000000000000000000000000000000000000000000000000' ? '0' : d.merkleRootMNList
      cbtx[4] = d.merkleRootQuorums == '0000000000000000000000000000000000000000000000000000000000000000' ? '0' : d.merkleRootQuorums
    }
    const algo = settings.getAlgoFromBlock(block, net)
    const dto = BlockDb[net].create({
      hash: block.hash,
      pow_hash: block.pow_hash,
      algo: algo,
      size: block.size,
      height: block.height,
      version: block.version,
      merkle_root: block.merkleroot,
      numtx: block.tx ? block.tx.length : 0,
      time: block.time,
      mediantime: block.mediantime,
      nonce: block.nonce,
      bits: block.bits,
      difficulty: block.difficulty,
      chainwork: block.chainwork,
      prev_hash: block.previousblockhash,
      next_hash: block.nextblockhash,
      cbtx: cbtx
    })
    if (dto) {
        console.log("Block created for chain %s height %d", net, block.height)
    }
    return cb(block)
  },

  get_richlist: function(coin, cb, net=settings.getDefaultNet()) {
    find_richlist(coin, function(richlist) {
      return cb(richlist);
    }, net);
  },

  // 'list' variable can be either 'received' or 'balance'
  update_richlist: function(list, cb, net=settings.getDefaultNet()) {
    const coin = settings.getCoin(net)
    const cnt = 100
    // create the burn address array so that we omit burned coins from the rich list
    const richlist_page = settings.get(net, 'richlist_page')
    var burn_addresses = richlist_page.burned_coins.addresses;

    // always omit special addresses used by the explorer from the richlist (coinbase, hidden address and unknown address)
    burn_addresses.push('coinbase');
    burn_addresses.push('hidden_address');
    burn_addresses.push('unknown_address');

    if (list == 'received') {
      // update 'received' richlist data
      AddressDb[net].find({a_id: { $nin: burn_addresses }}, 'a_id name balance received').sort({received: 'desc'}).limit(cnt).exec().then((addresses) => {
        RichlistDb[net].updateOne({coin: coin.name}, {
          received: addresses
        }).then(() => {
          return cb()
        }).catch((err) => {
          console.error("Failed to update richlist address for chain '%s': %s", net, err)
          // return cb(null)
        })
      }).catch((err) => {
        console.error("Failed to find richlist address for chain '%s': %s", net, err)
        // return cb(null)
      })
    } else if (list == 'balance') {
      // update 'balance' richlist data
      // check if burned addresses are in use and if it is necessary to track burned balances
      if (richlist_page.burned_coins.addresses == null || richlist_page.burned_coins.addresses.length == 0 || !richlist_page.burned_coins.include_burned_coins_in_distribution) {
        // update 'balance' richlist data by filtering burned coin addresses immidiately
        AddressDb[net].find({a_id: { $nin: burn_addresses }}, 'a_id name balance received').sort({balance: 'desc'}).limit(cnt).exec().then((addresses) => {
          RichlistDb[net].updateOne({coin: coin.name}, {
            balance: addresses
          }).then(() => {
            return cb();
          })
        }).catch((err) => {
          console.error("Failed to find richlist address for chain '%s': %s", net, err)
          // return cb(null)
        })
      } else {
        // do not omit burned addresses from database query. instead, increase the limit of returned addresses and manually remove each burned address that made it into the rich list after recording the burned balance
        AddressDb[net].find({}, 'a_id name balance received').sort({balance: 'desc'}).limit(cnt + burn_addresses.length).exec().then((addresses) => {
          var return_addresses = [];
          var burned_balance = 0.0;

          // loop through all richlist addresses
          addresses.forEach(function (address) {
            // check if this is a burned coin address
            if (burn_addresses.findIndex(p => p.toLowerCase() == address.a_id.toLowerCase()) > -1) {
              // this is a burned coin address so save the balance, not the address
              burned_balance += address.balance;
            } else if (return_addresses.length < cnt) {
              // this is not a burned address so add it to the return list
              return_addresses.push(address);
            }
          });

          // update the rich list collection
          RichlistDb[net].updateOne({coin: coin.name}, {
            balance: return_addresses,
            burned: burned_balance
          }).then(() => {
            return cb()
          }).catch((err) => {
            console.error("Failed to update richlist address for chain '%s': %s", net, err)
          })
        }).catch((err) => {
          console.error("Failed to find richlist address for chain '%s': %s", net, err)
        })
      }
    } else if (list == 'toptx') {
      // db.txes.find({total: { $gte: 2500000000000000 }}, {total: 1, blockindex: 1}).sort({blockindex:-1})
      TxDb[net].find({}, 'txid total blockindex blockhash size timestamp tx_type').sort({total: 'desc'}).limit(cnt).exec().then((txes) => {
        RichlistDb[net].updateOne({coin: coin.name}, {
          toptx: txes
        }).then(() => {
          return cb();
        })
      }).catch((err) => {
        console.error("Failed to find richlist top tx for chain '%s': %s", net, err)
      })
    }
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

  get_last_txs: function(start, length, min, internal, cb, net=settings.getDefaultNet()) {
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

  get_last_txs_ajax: function(start, length, min, cb, net=settings.getDefaultNet()) {
    debug("Get last txes starting %d, length %d, min. amount %d for chain '%s'.", start, length, min, net);
    if (min > 0) {
      // min is greater than zero which means we must pull record count from the txes collection
      TxDb[net].find({'total': {$gte: min}}).countDocuments().then((count) => {
        // get last transactions where there is at least 1 vout
        TxDb[net].find({'total': {$gte: min}, 'vout': { $gte: { $size: 1 }}}).sort({blockindex: -1}).skip(Number(start)).limit(Number(length)).exec().then((data) => {
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
      // min is zero (shouldn't ever be negative) which means we must pull record count from the coinstats collection (pulling from txes could potentially take a long time because it would include coinbase txes)
      const coin = settings.getCoin(net)
      StatsDb[net].findOne({coin: coin.name}).then((stats) => {
        // Get last transactions where there is at least 1 vout
        TxDb[net].find({'total': {$gte: min}, 'vout': { $gte: { $size: 1 }}}).sort({blockindex: -1}).skip(Number(start)).limit(Number(length)).exec().then((txs) => {
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

  create_market: function(coin_symbol, pair_symbol, market, ext_market_url, referal, logo, cb, net=settings.getDefaultNet()) {
    const dto = MarketsDb[net].create({
      market: market,
      ext_market_url: ext_market_url,
      referal: referal,
      logo: logo,
      coin_symbol: coin_symbol,
      pair_symbol: pair_symbol
    });
    if (dto) {
      console.log("Initial market entry created for %s: %s, ext-url %s, referal %s", market, coin_symbol +'/' + pair_symbol, ext_market_url, referal);  
    }
    return cb();
  },

  // check if market data exists for a given market and trading pair
  check_market: function(market, coin_symbol, pair_symbol, cb, net=settings.getDefaultNet()) {
    MarketsDb[net].findOne({market: market, coin_symbol: coin_symbol, pair_symbol: pair_symbol}).then((data) => {
      return cb(market, data)
    }).catch((err) => {
      console.error("Failed to check market '%s' - '%s'/'%s' tx for chain '%s': %s", market, coin_symbol, pair_symbol, net, err)
      return cb(null)
    })
  },

  // gets market data for given market and trading pair
  get_market: function(market, coin_symbol, pair_symbol, cb, net=settings.getDefaultNet()) {
    MarketsDb[net].findOne({market: market, coin_symbol: coin_symbol, pair_symbol: pair_symbol}).then((data) => {
      return cb(data ? data : null)
    }).catch((err) => {
      console.error("Failed to get market '%s' - '%s'/'%s' tx for chain '%s': %s", market, coin_symbol, pair_symbol, net, err)
      // return cb(null)
    })
  },

  // gets market trade history data for given market and trading pair sorted by timestamp descending
  get_market_trade_history: function(market, coin_symbol, pair_symbol, cb, net=settings.getDefaultNet()) {
    MarketTradeDb[net].find({ex: market, coin_symbol: coin_symbol, pair_symbol: pair_symbol}).sort({timestamp: -1}).then((data) => {
      return cb(data ? data : null)
    }).catch((err) => {
      console.error("Failed to get market trade history '%s' - '%s'/'%s' tx for chain '%s': %s", market, coin_symbol, pair_symbol, net, err)
      // return cb(null)
    })
  },

  // gets market orders data for given market and trading pair ordered by price descending.
  get_market_order_aggregation: function(market, coin_symbol, pair_symbol, cb, net=settings.getDefaultNet()) {
    MarketOrderDb[net].find({ex: market, coin_symbol: coin_symbol, pair_symbol: pair_symbol}).sort({price: -1}).then((data) => {
      return cb(data ? data : null)
    }).catch((err) => {
      console.error("Failed to get market orders '%s' - '%s'/'%s' tx for chain '%s': %s", market, coin_symbol, pair_symbol, net, err)
      // return cb(null)
    })
  },

  // gets buy orders aggregation for a given market and trading pair ordered by price descending.
  get_buy_order_aggregation: function(market, coin_symbol, pair_symbol, cb, net=settings.getDefaultNet()) {
    MarketOrderDb[net].find({ex: market, coin_symbol: coin_symbol, pair_symbol: pair_symbol, type: 0}).sort({price: -1}).then((data) => {
      return cb(data ? data : null)
    }).catch((err) => {
      console.error("Failed to get buy orders aggregation '%s' - '%s'/'%s' tx for chain '%s': %s", market, coin_symbol, pair_symbol, net, err)
      // return cb(null)
    })
  },

  // gets sell orders aggregation for a given market and trading pair ordered by price ascending.
  get_sell_order_aggregation: function(market, coin_symbol, pair_symbol, cb, net=settings.getDefaultNet()) {
    MarketOrderDb[net].find({ex: market, coin_symbol: coin_symbol, pair_symbol: pair_symbol, type: 1}).sort({price: 1}).then((data) => {
      return cb(data ? data : null)
    }).catch((err) => {
      console.error("Failed to get sell orders aggregation '%s' - '%s'/'%s' tx for chain '%s': %s", market, coin_symbol, pair_symbol, net, err)
      // return cb(null)
    })
  },

  // gets all markets without buys, sells and historical data.
  get_markets_summary: function(cb, net=settings.getDefaultNet()) {
    MarketsDb[net].find({}, { _id: 0, market: 1, referal: 1, coin_symbol: 1, pair_symbol: 1, summary: 1, ext_market_url: 1, referal: 1, logo: 1 }).then((data) => {
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

  // creates initial richlist entry in database; called on first launch of explorer + after restore or delete database
  create_richlist: function(coin, skip, cb, net=settings.getDefaultNet()) {
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
  delete_richlist: function(coin, cb, net=settings.getDefaultNet()) {
    RichlistDb[net].findOneAndDelete({coin: coin}).then((data) => {
      return cb(data ? true : false)
    }).catch((err) => {
      console.error("Failed to delete richlist for chain '%s': %s", net, err)
      // return cb(null)
    })
  },

  // checks richlist data exists for given coin
  check_richlist_and_upgrade_schema: function(coin, cb, net=settings.getDefaultNet()) {
    RichlistDb[net].findOne({coin: coin}).then((data) => {
      return cb(data ? true : false)
    }).catch((err) => {
      console.error("Failed to richlist for chain '%s': %s", net, err)
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

  // updates heavycoin stats
  // height: current block height, count: amount of votes to store
  update_heavy: function(coin, height, count, cb, net=settings.getDefaultNet()) {
    var newVotes = [];

    lib.get_maxmoney(function (maxmoney) {
      lib.get_maxvote(function (maxvote) {
        lib.get_vote(function (vote) {
          lib.get_phase(function (phase) {
            lib.get_reward(function (reward) {
              module.exports.get_stats(coin.name, function (stats) {
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
                        module.exports.update_last_updated_stats(coin.name, { reward_last_updated: Math.floor(new Date() / 1000) }, function (new_cb) {
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
  update_network_history: function(coin, height, cb, net=settings.getDefaultNet()) {
    console.log("Update network history: %d", height)
    NetworkHistoryDb[net].findOne({blockindex: height}).then((network_hist) => {
      if (!network_hist) {
        lib.get_hashrate(function(hashps) {
          lib.get_difficulty(net, function(difficulties) {
            const isBut = settings.isButkoin(net)
            const difficulty = difficulties.difficulty
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
            var dto = null;
            if (isBut) {
              const hashrate = hashps.butkscrypt
              dto = NetworkHistoryDb[net].create({
                blockindex: height,
                nethash: (hashrate == null || hashrate == '-' ? 0 : hashrate),
                difficulty_pow: difficultyPOW,
                difficulty_pos: difficultyPOS,
                difficulty_ghostrider: difficulties.difficulty_ghostrider,
                difficulty_yespower: difficulties.difficulty_yespower,
                difficulty_lyra2: difficulties.difficulty_lyra2,
                difficulty_sha256d: difficulties.difficulty_sha256d,
                difficulty_scrypt: difficulties.difficulty_scrypt,
                difficulty_butkscrypt: difficulties.difficulty_butkscrypt,
                nethash_ghostrider: hashps.ghostrider,
                nethash_yespower: hashps.yespower,
                nethash_lyra2: hashps.lyra2,
                nethash_sha256d: hashps.sha256d,
                nethash_scrypt: hashps.scrypt,
                nethash_butkscrypt: hashps.butkscrypt
              });
            } else {
              dto = NetworkHistoryDb[net].create({
                blockindex: height,
                nethash: hashps,
                difficulty_pow: hashps,
                difficulty_pos: difficultyPOS,
                difficulty_ghostrider: difficulty,
                nethash_ghostrider: hashps
              });
            }

            if (dto) {
              var rr = {}
              if (isBut) {
                const hashrate = hashps.butkscrypt
                rr.last = height,
                rr.nethash = (hashrate == null || hashrate == '-' ? 0 : hashrate),
                rr.difficulty_pow = difficultyPOW,
                rr.difficulty_pos = difficultyPOS,
                rr.difficulty_ghostrider = difficulties.difficulty_ghostrider,
                rr.difficulty_yespower = difficulties.difficulty_yespower,
                rr.difficulty_lyra2 = difficulties.difficulty_lyra2,
                rr.difficulty_sha256d = difficulties.difficulty_sha256d,
                rr.difficulty_scrypt = difficulties.difficulty_scrypt,
                rr.difficulty_butkscrypt = difficulties.difficulty_butkscrypt,
                rr.nethash_ghostrider = hashps.ghostrider,
                rr.nethash_yespower = hashps.yespower,
                rr.nethash_lyra2 = hashps.lyra2,
                rr.nethash_sha256d = hashps.sha256d,
                rr.nethash_scrypt = hashps.scrypt,
                rr.nethash_butkscrypt = hashps.butkscrypt
              } else {
                rr.last = height,
                rr.nethash = hashps,
                rr.nethash_ghostrider = hashps,
                rr.difficulty_pow = hashps,
                rr.difficulty_pos = difficultyPOS,
                rr.difficulty = difficulties.difficulty,
                rr.difficulty_ghostrider = difficulty
              }
              StatsDb[net].updateOne({coin: coin}, rr).then(() => {
                console.log("Done update stats: %d", height)
                // get the count of network history records
                NetworkHistoryDb[net].find({}).countDocuments().then((count) => {
                  // read maximum allowed records from settings
                  const network_history = settings.get(net, 'network_history')
                  let max_records = network_history.max_saved_records;

                  // check if the current count of records is greater than the maximum allowed
                  if (count > max_records) {
                    // prune network history records to keep collection small and quick to access
                    NetworkHistoryDb[net].find().select('blockindex').sort({blockindex: 1}).limit(count - max_records).exec().then((records) => {
                      // create a list of the oldest network history ids that will be deleted
                      const ids = records.map((doc) => doc.blockindex);

                      // delete old network history records
                      NetworkHistoryDb[net].deleteMany({blockindex: {$in: ids}}).then(() => {
                        console.log('Network history update complete');
                        return cb();
                      })
                    })
                  } else {
                    console.log('Network history update complete');
                    return cb();
                  }
                }).catch((err) => {
                  console.error("Failed to network history for chain '%s': %s", net, err)
                  return cb(err);
                })
              }).catch((err) => {
                console.error("Failed to update stats database: %s", err)
              })
            } else {
              console.error("Failed to update network history for chain '%s': %s", net, err)
              return cb();
            }
          }, net);
        }, net);
      } else {
        // block hasn't moved. skip.
        return cb()
      }
    }).catch((err) => {
      console.error(err)
      return cb(err)
    })
  },

  // updates market data for given market; called by sync.js
  update_markets_db: function(market, coin_symbol, pair_symbol, cb, net=settings.getDefaultNet()) {
    const coin = settings.getCoin(net)
    if (fs.existsSync('./lib/markets/' + market + '.js')) {
      get_market_data(market, coin_symbol, pair_symbol, function (err, obj) {
        if (err == null) {
          MarketsDb[net].updateOne({market: market, coin_symbol: coin_symbol, pair_symbol: pair_symbol}, {
            chartdata: JSON.stringify(obj.chartdata),
            summary: obj.stats
          }).then(() => {
            const now = new Date().getTime()
            obj.buys.forEach((buy) => {
              copyOrderParam(buy, market, coin_symbol, pair_symbol, 0, now)
            })
            obj.sells.forEach((sell) => {
              copyOrderParam(sell, market, coin_symbol, pair_symbol, 1, now)
              obj.buys.push(sell)
            })
            // Renew offers.
            MarketOrderDb[net].insertMany(obj.buys).then(() => {
              MarketOrderDb[net].deleteMany({market: coin_symbol, trade: pair_symbol, date: { $ne: now }}).then(() => {
                obj.trades.forEach((trade) => {
                  copyHistoryParam(trade, market, coin_symbol, pair_symbol, now)
                })
                // Renew trade history.
                MarketTradeDb[net].insertMany(obj.trades).then(() => {
                  MarketTradeDb[net].deleteMany({market: coin_symbol, trade: pair_symbol, date: { $ne: now }}).then(() => {
                    const markets_page = settings.get(net, 'markets_page')
                    // check if this is the default market and trading pair
                    if (market == markets_page.default_exchange.exchange_name && markets_page.default_exchange.trading_pair.toUpperCase() == coin_symbol.toUpperCase() + '/' + pair_symbol.toUpperCase()) {
                      StatsDb[net].updateOne({coin: coin.name}, {
                        last_price: obj.stats.last
                      }).then(() => {
                        // finished updating market data
                        return cb(null)
                      })
                    } else {
                      // this is not the default market so we are finished updating market data
                      return cb(null)
                    }
                  })
                })
              })
            })
          })
        } else {
          return cb(err)
        }
      }, net)
    } else {
      return cb('market is not installed')
    }
  },

  get_last_usd_price: function(cb, net=settings.getDefaultNet()) {
    const coin = settings.getCoin(net)
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
                StatsDb[net].findOne({coin: coin.name}).then((stats) => {
                  StatsDb[net].updateOne({coin: coin.name}, {
                    last_usd_price: (last_usd * stats.last_price)
                  }).then(() => {
                    // last usd price updated successfully
                    return cb(null);
                  })
                })
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

  coinbase_supply: function(cb, net=settings.getDefaultNet()) {
    AddressDb[net].findOne({a_id: 'coinbase'}).then((address) => {
      return cb(address ? address.sent : 0)
    }).catch((err) => {
      console.error("Failed to get coin base supply for chain '%s': %s", net, err)
      return cb(0);
    });
  },

  get_supply: function(net=settings.getDefaultNet(), cb) {
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
  update_db: function(net=settings.getDefaultNet(), coin, cb) {
    lib.get_blockcount(function (count) {
      // Update DB needs access to the daemon.
      if (!count || (count != null && typeof count === 'number' && count < 0)) {
        console.log('Error: Unable to connect to explorer API.');
        return cb(false);
      }

      module.exports.get_supply(net, function (supply) {
        lib.get_connectioncount(net, function (connections) {
          StatsDb[net].findOne({coin: coin}).then((stats) => {
            if (stats) {
              StatsDb[net].updateOne({coin: coin}, {
                coin: coin,
                count : count,
                supply: (supply ? supply : 0),
                connections: (connections ? connections : 0)
              }).then(() => {
                return cb({
                  coin: coin,
                  count : count,
                  supply: (supply ? supply : 0),
                  connections: (connections ? connections : 0),
                  last: (stats.last ? stats.last : 0),
                  txes: (stats.txes ? stats.txes : 0)
                })
              }).catch((err) => {
                console.error("Failed to update coin stats for chain '%s': %s", net, err)
                // return cb(false);
              })
            } else {
              console.log("Error during stats update: %s", (err ? err : 'Cannot find stats collection'));
              return cb(false);
            }
          }).catch((err) => {
            console.error("Failed to find coin stats for chain '%s': %s", net, err)
            return cb(false);
          })
        })
      });
    }, net);
  },

  create_peer: function(params, cb, net=settings.getDefaultNet()) {
    PeersDb[net].create(params).then((peer) => {
      return cb()
    }).catch((err) => {
      console.error("Failed to insert peer for chain '%s': %s", net, err)
      return cb()
    })
  },

  find_peer: function(address, port, cb, net=settings.getDefaultNet()) {
    PeersDb[net].findOne({address: address, port: port}).then((peer) => {
      if (peer)
        return cb(peer)
      else
        return cb (null)
    }).catch((err) => {
      console.error("Failed to find peer address '%s' for chain '%s': %s", address, net, err)
      return cb(null)
    })
  },

  drop_peer: function(address, port, cb, net=settings.getDefaultNet()) {
    PeersDb[net].deleteOne({address: address, port: port}).then(() => {
      return cb()
    }).catch((err) => {
      console.error("Failed to drop peer address '%s' for chain '%s': %s", address, net, err)
      return cb()
    })
  },

  drop_peers: function(cb, net=settings.getDefaultNet()) {
    PeersDb[net].deleteMany({}).then(() => {
      return cb()
    }).catch((err) => {
      console.error("Failed to drop peers for chain '%s': %s", net, err)
      return cb()
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

  check_masternodes_and_upgrade_schema: function(cb, net=settings.getDefaultNet()) {
    MasternodeDb[net].countDocuments({}).then((count) => {
      return cb(count)
    }).catch((err) => {
      console.error("Failed to check masternodes for chain '%s': %s", net, err)
      return cb(-1)
    })
  },

  // determine if masternode exists and save masternode to collection
  save_masternode: function (raw_masternode, cb, net=settings.getDefaultNet()) {
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
  add_update_masternode(masternode, add, cb, net=settings.getDefaultNet()) {
    if (masternode.proTxHash == null && masternode.txhash == null) {
      console.log('Masternode update error: Tx Hash is missing');
      return cb(false);
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
  },

  // find masternode by txid
  find_masternode: function (txhash, cb, net=settings.getDefaultNet()) {
    MasternodeDb[net].findOne({ txhash: txhash }).then((dto) => {
      if (dto)
        return cb(dto)
      else
        return cb(null)
    }).catch((err) => {
      console.error("Failed to find masternode hash '%s' for chain '%s': %s", txhash, net, err)
      return cb(null)
    })
  },

  // remove masternodes older than 24 hours
  remove_old_masternodes: function (cb, net=settings.getDefaultNet()) {
    MasternodeDb[net].deleteMany({ lastseen: { $lte: (Math.floor(Date.now() / 1000) - 86400) } }).then(() => {
      return cb()
    }).catch((err) => {
      console.error("Failed to delete old masternode for chain '%s': %s", net, err)
      return cb()
    })
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

  // updates last_updated stats; called by sync.js
  update_last_updated_stats: function (coin, param, cb, net=settings.getDefaultNet()) {
    const dto = {}
    if (param.blockchain_last_updated) {
      dto.blockchain_last_updated = param.blockchain_last_updated
    } else if (param.reward_last_updated) {
      dto.reward_last_updated = param.reward_last_updated
    } else if (param.masternodes_last_updated) {
      dto.masternodes_last_updated = param.masternodes_last_updated
    } else if (param.network_last_updated) {
      dto.network_last_updated = param.network_last_updated
    } else if (param.richlist_last_updated) {
      dto.richlist_last_updated = param.richlist_last_updated
    } else if (param.markets_last_updated) {
      dto.markets_last_updated = param.markets_last_updated
    } else {
      // invalid option
      return cb(false);
    }
    StatsDb[net].updateOne({ coin: coin }, dto).then(() => {
      return cb(true);
    }).catch((err) => {
      console.error("Failed to update stats for chain '%s': %s", net, err)
      // return cb([])
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

  check_networkhistory_and_upgrade_schema: function(cb, net=settings.getDefaultNet()) {
    NetworkHistoryDb[net].countDocuments({}).then((count) => {
      return cb(count)
    }).catch((err) => {
      console.error("Failed to find network history for chain '%s': %s", net, err)
      return cb(-1)
    })
  },

  initialize_data_startup: function(cb, net=settings.getDefaultNet()) {
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
        console.log("  * %s stats created. Init TX DB now...", net)
        module.exports.check_txes_and_upgrade_schema(function(countTx) {
          console.log("  * %s TX DB count %d.", net, countTx)
          module.exports.check_masternodes_and_upgrade_schema(function(countMn) {
            console.log("  * %s masternode DB count %d.", net, countMn)
            module.exports.check_networkhistory_and_upgrade_schema(function(countNh) {
              console.log("  * %s network history DB count %d.", net, countNh)
              module.exports.check_richlist_and_upgrade_schema(coin.name, function(richlist_exists) {
                console.log("  * %s richlist initialized: %s.", net, richlist_exists)
                // initialize the richlist if required.
                module.exports.create_richlist(coin.name, richlist_exists, function() {
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
  },

  remove_sync_message: function(net=settings.getDefaultNet()) {
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
              const tx_types = settings.get(net, 'tx_types')
              const isButkoin = settings.isButkoin(net)
              const isBitoreum = settings.isBitoreum(net)
              const isRaptoreum = settings.isRaptoreum(net)

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
                  var extra = null
                  if (isButkoin || isBitoreum || isRaptoreum) {
                    switch (tx.type) {
                      case tx_types.indexOf('TRANSACTION_NORMAL'): break // -> NORMAL
                      case tx_types.indexOf('TRANSACTION_PROVIDER_REGISTER'): extra = datautil.protxRegisterServiceTxToArray(tx); break
                      case tx_types.indexOf('TRANSACTION_PROVIDER_UPDATE_SERVICE'): extra = datautil.protxUpdateServiceTxToArray(tx); break
                      case tx_types.indexOf('TRANSACTION_PROVIDER_UPDATE_REGISTRAR'): extra = datautil.protxUpdateRegistrarTxToArray(tx); break
                      case tx_types.indexOf('TRANSACTION_PROVIDER_UPDATE_REVOKE'): extra = datautil.protxUpdateRevokeTxToArray(tx); break
                      case tx_types.indexOf('TRANSACTION_COINBASE'): break // COINBASE, Array.from(rtx.extraPayload).reverse().join("")
                      case tx_types.indexOf('TRANSACTION_QUORUM_COMMITMENT'): extra = datautil.protxQuorumCommitmentTxToArray(tx); break
                      case tx_types.indexOf('TRANSACTION_FUTURE'): break // FUTURE
                      default: console.warn('*** Unknown TX type %s.', tx.type)
                    }
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
                    op_return: op_return,
                    extra: extra
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