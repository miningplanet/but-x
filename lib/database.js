const debug = require('debug')('debug')
const debugPeers = require('debug')('peers')
const settings = require('./settings')
const { Peers } = require('./peers')
const mongoose = require('mongoose')
const lib = require('./x')
const fs = require('fs')
const { WebSocket } = require('ws')

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
const XPeersDb = []

var upstreamPeers = {}

const TTLCache = require('@isaacs/ttlcache')
const cache = settings.cache

const statsCache          = new TTLCache({ max: cache.stats.size,         ttl: 1000 * cache.stats.ttl,          updateAgeOnGet: false, noUpdateTTL: false })
const dbindexCache        = new TTLCache({ max: cache.dbindex.size,       ttl: 1000 * cache.dbindex.ttl,        updateAgeOnGet: false, noUpdateTTL: false })
const blocksCache         = new TTLCache({ max: cache.blocks.size,        ttl: 1000 * cache.blocks.ttl,         updateAgeOnGet: false, noUpdateTTL: false })
const addressCache        = new TTLCache({ max: cache.addresses.size,     ttl: 1000 * cache.addresses.ttl,      updateAgeOnGet: false, noUpdateTTL: false })
const addressTxCache      = new TTLCache({ max: cache.addresstxes.size,   ttl: 1000 * cache.addresstxes.ttl,    updateAgeOnGet: false, noUpdateTTL: false })
const peersCache          = new TTLCache({ max: cache.peers.size,         ttl: 1000 * cache.peers.ttl,          updateAgeOnGet: false, noUpdateTTL: false })
const masternodesCache    = new TTLCache({ max: cache.masternodes.size,   ttl: 1000 * cache.masternodes.ttl,    updateAgeOnGet: false, noUpdateTTL: false })
const richlistCache       = new TTLCache({ max: cache.richlist.size,      ttl: 1000 * cache.richlist.ttl,       updateAgeOnGet: false, noUpdateTTL: false })
const networkChartCache   = new TTLCache({ max: cache.network_chart.size, ttl: 1000 * cache.network_chart.ttl,  updateAgeOnGet: false, noUpdateTTL: false })
const txsCache            = new TTLCache({ max: cache.txs.size,           ttl: 1000 * cache.txs.ttl,            updateAgeOnGet: false, noUpdateTTL: false })
const marketsCache        = new TTLCache({ max: cache.markets.size,       ttl: 1000 * cache.markets.ttl,        updateAgeOnGet: false, noUpdateTTL: false })

const WAIT_FOR_UPSTREAM_PEERS   = JSON.parse('{ "msg" : "Wait for upstream peers."}')

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

function check_stats(coinName, cb, net=settings.getDefaultNet()) {
  StatsDb[net].findOne({coin: coinName}).then((data) => {
    cb(data ? true : false)
  }).catch((err) => {
    console.error("Failed to check stats for chain '%s': %s", net, err)
    cb(false)
  })
}

function create_stats(coinName, skip, cb, net=settings.getDefaultNet()) {
  // check if stats need to be created
  if (!skip) {
    console.log("Try to init initial stats.")
    const dto = StatsDb[net].create({
      coin: coinName,
      chain: net,
      last: 0
    })
    if (dto) {
        console.log("Initial stats entry created for %s.", coinName)
    }
    cb(dto)
  } else
    cb(null)
}

function get_stats(coinName, cb, net=settings.getDefaultNet()) {
  const path = Peers.UPSTREAM_GET_COINSTATS + net
  const cached = statsCache.get(path)
  if (cached) {
    return cb(cached)
  }

  if (settings.needsUpstream(net)) {
    if (has_upstream_peers(net)) {
      debugPeers("Get remote coinstats for net '%s', number of peers %d.", net, upstreamPeers.length)
      get_upstream_peer(net).send(path, function() {
        wait_until_upstream_cached(cb, statsCache, path)
      })
    } else {
      cb(WAIT_FOR_UPSTREAM_PEERS)
    }
  } else {
    get_stats_local(coinName, cb, net)
  }
}

function get_stats_local(coinName, cb, net=settings.getDefaultNet()) {
  StatsDb[net].findOne({coin: coinName}).then((data) => {
    return cb(data)
  }).catch((err) => {
    console.error("Failed to find stats for chain '%s': %s", net, err)
    return cb(null)
  })
}

function get_dbindex_local(coinName, cb, net=settings.getDefaultNet()) {
  DbIndexDb[net].findOne({coin: coinName}).then((data) => {
    return cb(data)
  }).catch((err) => {
    console.error("Failed to find dbindex for chain '%s': %s.", net, err)
    return cb(null)
  })
}

function get_peers_local(cb, net=settings.getDefaultNet()) {
  PeersDb[net].find().sort({address: 1, protocol: -1, port: 1}).exec().then((peers) => {
    return cb(peers)
  }).catch((err) => {
    console.error("Failed to get peers for chain '%s': %s", net, err)
    return cb([])
  })
}

function get_masternodes_local(cb, net=settings.getDefaultNet()) {
  MasternodeDb[net].find({}).then((dtos) => {
    return cb(dtos)
  }).catch((err) => {
    console.error("Failed to find masternodes for chain '%s': %s", net, err)
    return cb([])
  })
}

function get_richlist_local(coin, cb, net=settings.getDefaultNet()) {
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

function get_block_by_height_local(height, cb, net=settings.getDefaultNet()) {
  BlockDb[net].findOne({height: height}).then((block) => {
    cb(block)
  }).catch((err) => {
    console.error("Failed to find block %d for chain '%s': %s", height, net, err)
    cb(err)
  })
}

function get_block_by_hash_local(hash, cb, net=settings.getDefaultNet()) {
  BlockDb[net].findOne({hash: hash}).then((block) => {
    cb(block)
  }).catch((err) => {
    console.error("Failed to find block '%s' for chain '%s': %s", hash, net, err)
    cb(err)
  })
}

function get_address_local(hash, cb, net=settings.getDefaultNet()) {
  AddressDb[net].findOne({a_id: hash}).then((address) => {
    if (address)
      return cb(address)
    else
      return cb()
  }).catch((err) => {
    console.error("Failed to find address '%s' for chain '%s': %s", address, net, err)
    return cb()
  })
}

function get_tx_local(txid, cb, net=settings.getDefaultNet()) {
  TxDb[net].findOne({txid: txid}).then((tx) => {
    cb(tx ? tx : null)
  }).catch((err) => {
    console.error("Failed to find tx '%s' for chain '%s': %s", txid, net, err)
    cb(null)
  })
}

function get_tx(txid, cb, net=settings.getDefaultNet()) {
  const path = Peers.UPSTREAM_GET_TX + net + '/' + txid
  const cached = txsCache.get(path)
  if (cached) {
    return cb(cached)
  }

  if (settings.needsUpstream(net)) {
    if (has_upstream_peers(net)) {
      debugPeers("Get remote tx for net '%s', number of peers %d", net, upstreamPeers.length)
      get_upstream_peer(net).send(path, function() {
        wait_until_upstream_cached(cb, txsCache, path)
      })
    } else {
      cb(WAIT_FOR_UPSTREAM_PEERS)
    }
  } else {
    get_tx_local(txid, cb, net)
  }
}

function get_txs_by_blockhash_local(hash, cb, net=settings.getDefaultNet()) {
  TxDb[net].find({blockhash: hash}).then((tx) => {
    return cb(tx ? tx : null)
  }).catch((err) => {
      console.error("Failed to find txs for block hash '%s' for chain '%s': %s", hash, net, err)
      return cb(null)
  })
}

function get_address_txs_local(hash, start, length, cb, net=settings.getDefaultNet()) {
  var totalCount = 0

  AddressTxDb[net].find({a_id: hash}).countDocuments().then((count) => {
    totalCount = count

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
          var txs = []
          var count = address_tx.length
          var running_balance = balance_sum.length > 0 ? balance_sum[0].balance : 0
          var txs = []

          lib.syncLoop(count, function (loop) {
            var i = loop.iteration()

            get_tx(address_tx[i].txid, function (tx) {
              if (tx && !txs.includes(tx)) {
                tx.balance = running_balance
                txs.push(tx)
                loop.next()
              } else if (!txs.includes(tx)) {
                txs.push("1. Not found")
                loop.next()
              } else {
                loop.next()
              }

              running_balance = running_balance - address_tx[i].amount
            }, net)
          }, function () {
            return cb({ "data": txs, "recordsTotal": count, "recordsFiltered": count })
          })
          
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
}

function get_last_txs_local(cb, stats, start, length, findCriteria, net=settings.getDefaultNet()) {
  TxDb[net].find(findCriteria).sort({blockindex: -1}).skip(Number(start)).limit(Number(length)).exec().then((txs) => {
    const tx_types = settings.get(net, 'tx_types')
    const data = []
    for (i = 0; i < txs.length; i++) {
      const amount = !isNaN(txs[i].total) ? txs[i].total / 100000000 : '-'
      const tx_type = !isNaN(txs[i].tx_type) ? tx_types[parseInt(txs[i].tx_type)] : '-'
      push_tx_data(data, txs[i], amount, tx_type)
    }
    return cb(data, stats ? stats.txes : 0)
  }).catch((err) => {
    console.error("Failed to find txes for chain '%s': %s", net, err)
    return cb(err)
  })
}

function push_tx_data(data, tx, amount, tx_type) {
  data.push({
    blockindex: tx.blockindex,
    blockhash: tx.blockhash,
    txid: tx.txid,
    type: tx_type,
    version: tx.version,
    senders: tx.vin.length,
    recipients: tx.vout.length,
    amount: (amount),
    size: tx.size,
    locktime: tx.locktime,
    instantlock: tx.instantlock,
    chainlock: tx.chainlock,
    timestamp: tx.timestamp,
    op_return: tx.op_return,
    extra: tx.extra
  })
}

// only sync
function get_market_data(market, coin_symbol, pair_symbol, reverse, cb, net=settings.getDefaultNet()) {
  if (fs.existsSync('./lib/markets/' + market + '.js')) {
    exMarket = require('./markets/' + market)
    exMarket.get_data({net: net, coin: coin_symbol, exchange: pair_symbol, reverse: reverse}, function(err, obj) {
      return cb(err, obj)
    })
  } else
    return cb(null)
}

// gets market data for given market and trading pair
function get_market_local(market, coin_symbol, pair_symbol, cb, net=settings.getDefaultNet()) {
  MarketsDb[net].findOne({market: market, coin_symbol: coin_symbol, pair_symbol: pair_symbol}).then((data) => {
    cb(data ? data : null)
  }).catch((err) => {
    console.error("Failed to get market '%s' - '%s'/'%s' tx for chain '%s': %s", market, coin_symbol, pair_symbol, net, err)
    cb(null)
  })
}

// gets all markets including buys, sells and historical data.
function get_markets_local(cb, net=settings.getDefaultNet()) {
  MarketsDb[net].find({}, { _id: 0, market: 1, coin_symbol: 1, pair_symbol: 1, summary: 1, chartdata: 1, buys: 1, sells: 1, history: 1, ext_market_url: 1, referal: 1, logo: 1 }).then((data) => {
    cb(data ? data : null)
  }).catch((err) => {
    console.error("Failed to find market for chain '%s': %s", net, err)
    cb(null)
  })
}

// gets all markets without buys, sells and historical data.
function get_markets_summary_local(cb, net=settings.getDefaultNet()) {
  MarketsDb[net].find({}, { _id: 0, market: 1, referal: 1, coin_symbol: 1, pair_symbol: 1, reverse: 1, summary: 1, ext_market_url: 1, referal: 1, logo: 1 }).then((data) => {
    cb(data ? data : null)
  }).catch((err) => {
    console.error("Failed to get market summary for chain '%s': %s", net, err)
    cb(null)
  })
}

// gets market trade history data for given market and trading pair sorted by timestamp descending
function get_market_trade_history_local(market, coin_symbol, pair_symbol, cb, net=settings.getDefaultNet()) {
  MarketTradeDb[net].find({ex: market, market: coin_symbol, trade: pair_symbol}).sort({timestamp: -1}).then((data) => {
    return cb(data ? data : null)
  }).catch((err) => {
    console.error("Failed to get market trade history '%s' - '%s'/'%s' tx for chain '%s': %s", market, coin_symbol, pair_symbol, net, err)
    return cb(null)
  })
}

// gets buy orders aggregation for a given market and trading pair ordered by price descending.
function get_buy_order_aggregation_local(ex, market, trade, reverse, cb, net=settings.getDefaultNet()) {
  const type = reverse == true ? 1 : 0
  const order = reverse == true ? 1 : -1
  MarketOrderDb[net].find({ex: ex, market: market, trade: trade, type: type}).sort({price: order}).then((data) => {
    return cb(data ? data : null)
  }).catch((err) => {
    console.error("Failed to get buy orders aggregation '%s' - '%s'/'%s' (reverse=%s) for chain '%s': %s", ex, market, trade, reverse, net, err)
    return cb(null)
  })
}

// gets sell orders aggregation for a given market and trading pair ordered by price ascending.
function get_sell_order_aggregation_local(ex, market, trade, reverse, cb, net=settings.getDefaultNet()) {
  const type = reverse == true ? 0 : 1
  MarketOrderDb[net].find({ex: ex, market: market, trade: trade, type: type}).sort({price: 1}).then((data) => {
    return cb(data ? data : null)
  }).catch((err) => {
    console.error("Failed to get sell orders aggregation '%s' - '%s'/'%s' (reverse=%s) for chain '%s': %s", ex, market, trade, reverse, net, err)
    return cb(null)
  })
}

// lookup all network history data for populating network charts
function get_network_chart_data_local(cb, net=settings.getDefaultNet()) {
  NetworkHistoryDb[net].find().sort({blockindex: 1}).exec().then((data) => {
    cb(data)
  }).catch((err) => {
    console.error("Failed to find network chart for chain '%s': %s", net, err)
    cb(null)
  })
}

async function wait_until_upstream_cached(cb, cache, net) {
  const sleep = ms => new Promise(res => setTimeout(res, ms))
  var data = cache.get(net)
  do {
    data = cache.get(net)
    if (data) {
      return cb(data)
    }
    await sleep(250)
  } while(data === undefined)
}

function push_upstream_peer_client(peer, net) {
  debugPeers("Pushed upstream client for net '%s': %o", net, peer._url)

  if (!Array.isArray(upstreamPeers[net]))
    upstreamPeers[net] = []

  upstreamPeers[net].push(peer)
}

function has_upstream_peers(net) {
  return Array.isArray(upstreamPeers[net]) && upstreamPeers[net].length > 0
}

function get_upstream_peer(net) {
  return upstreamPeers[net][upstreamPeers[net].length -1]
}

module.exports = {
  has_upstream_peers: has_upstream_peers,
  get_upstream_peer: get_upstream_peer,
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

  connection_factory: function(net, initpeers, dbstring, cb) {
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
    XPeersDb[net] = con.model('Xpeers', require('../models/xpeers'))

    // TODO: Not the best place here, but lets do it for a while.
    if (initpeers == true) {
      const db = settings.getDbOrNull(net)
      if (db && db.peers && db.peers.enabled == true && Array.isArray(db.peers.upstream)) {
        // connect upstream
        db.peers.upstream.forEach(function (url) {
          console.log("Try to connect to upstream peer '%s'.", url + '/' + net)
          const socket = new WebSocket(url + '/' + net)
          var push = true

          socket.on('error', function(err) {
            console.error('error!')
            console.error(err.code)
            push = false
          })

          socket.onmessage = (event) => {
            // TODO: Comes before 'Received event:'
            // debugPeers("onmessage: %o", event)
          }

          socket.addEventListener('open', (wssocket) => {
            // console.log('Connected to WebSocket server. %o', wssocket)
            const obj = {}
            obj.event = Peers.UPSTREAM_HANDSHAKE
            obj.net = net
            obj.data = Peers.PEER_VERSION
            socket.send(JSON.stringify(obj))
          })

          // Event listener for incoming messages
          socket.addEventListener('message', (m) => {
            const params = m.data.split('/')
            const net = params[1]
            debugPeers("Received event for net %s: %o", net, m.data)

            const coinName = settings.getCoin(net).name
            

            if (m.data == Peers.UPSTREAM_GET_PEERS + net) {
              module.exports.get_peers(function(peers) {      
                socket.send(JSON.stringify({ "event": m.data, "data": peers }))
              }, net)
            } else if (m.data.startsWith(Peers.UPSTREAM_GET_BLOCK_BY_HASH + net)) {
              module.exports.get_block_by_hash(params[2], function(block) {
                socket.send(JSON.stringify({ "event": m.data, "data": block }))
              }, net)
            } else if (m.data.startsWith(Peers.UPSTREAM_GET_BLOCK_BY_HEIGHT + net)) {
              module.exports.get_block_by_height(params[2], function(block) {      
                socket.send(JSON.stringify({ "event": m.data, "data": block }))
              }, net)
            } else if (m.data.startsWith(Peers.UPSTREAM_GET_ADDRESS + net)) {
              module.exports.get_address(params[2], function(address) {      
                socket.send(JSON.stringify({ "event": m.data, "data": address }))
              }, net)
            } else if (m.data.startsWith(Peers.UPSTREAM_GET_ADDRESS_TXES + net)) {
              module.exports.get_address_txs(params[2], params[3], params[4], function(data) {      
                // TODO: Fix peer data. Balance is undefined
                socket.send(JSON.stringify({ "event": m.data, "data": data }))
              }, net)
            } else if (m.data.startsWith(Peers.UPSTREAM_GET_TXES_BY_BLOCKHASH + net)) {
              module.exports.find_txs_by_blockhash(params[2], function(txs) {      
                socket.send(JSON.stringify({ "event": m.data, "data": txs }))
              }, net)
            } else if (m.data.startsWith(Peers.UPSTREAM_GET_LAST_TXES + net)) {
              module.exports.get_last_txs(params[2], params[3], params[4], params[5], function(txs) {      
                socket.send(JSON.stringify({ "event": m.data, "data": txs }))
              }, net)
            } else if (m.data.startsWith(Peers.UPSTREAM_GET_TX + net)) {
              get_tx(params[2], function(tx) {      
                socket.send(JSON.stringify({ "event": m.data, "data": tx }))
              }, net)
            } else if (m.data == Peers.UPSTREAM_GET_MASTERNODES + net) {
              module.exports.get_masternodes(function(masternodes) {      
                socket.send(JSON.stringify({ "event": m.data, "data": masternodes }))
              }, net)
            } else if (m.data == Peers.UPSTREAM_GET_COINSTATS + net) {
              get_stats(coinName, function(stats) {      
                socket.send(JSON.stringify({ "event": m.data, "data": stats }))
              }, net)
            } else if (m.data == Peers.UPSTREAM_GET_DBINDEX + net) {
              module.exports.get_dbindex(coinName, function(dbindex) {      
                socket.send(JSON.stringify({ "event": m.data, "data": dbindex }))
              }, net)
            } else if (m.data == Peers.UPSTREAM_GET_RICHLIST + net) {
              module.exports.get_richlist(coinName, function(richlist) {      
                socket.send(JSON.stringify({ "event": m.data, "data": richlist }))
              }, net)
            } else if (m.data.startsWith(Peers.UPSTREAM_GET_NETWORK_CHART + net)) {
              module.exports.get_network_chart_data(function(data) {      
                socket.send(JSON.stringify({ "event": m.data, "data": data }))
              }, net)
            } else if (m.data.startsWith(Peers.UPSTREAM_GET_MARKET + net)) {
              module.exports.get_market(params[2], params[3], params[4], function(market) {      
                socket.send(JSON.stringify({ "event": m.data, "data": market }))
              }, net)
            } else if (m.data.startsWith(Peers.UPSTREAM_GET_MARKETS + net)) {
              module.exports.get_markets(function(markets) {      
                socket.send(JSON.stringify({ "event": m.data, "data": markets }))
              }, net)
            } else if (m.data.startsWith(Peers.UPSTREAM_GET_MARKET_SUMMARY + net)) {
              module.exports.get_markets_summary(function(summary) {      
                socket.send(JSON.stringify({ "event": m.data, "data": summary }))
              }, net)
            } else if (m.data.startsWith(Peers.UPSTREAM_GET_MARKET_HISTORY + net)) {
              module.exports.get_market_trade_history(params[2], params[3], params[4], function(history) {      
                socket.send(JSON.stringify({ "event": m.data, "data": history }))
              }, net)
            } else if (m.data.startsWith(Peers.UPSTREAM_GET_BUY_ORDER_AGGR + net)) {
              module.exports.get_buy_order_aggregation(params[2], params[3], params[4], params[5], function(orders) {      
                socket.send(JSON.stringify({ "event": m.data, "data": orders }))
              }, net)
            } else if (m.data.startsWith(Peers.UPSTREAM_GET_SELL_ORDER_AGGR + net)) {
              module.exports.get_sell_order_aggregation(params[2], params[3], params[4], params[5], function(orders) {      
                socket.send(JSON.stringify({ "event": m.data, "data": orders }))
              }, net)
            }
            
            // TODO: Check ping peers.
            // setTimeout(function() {
            //   const obj = {}
            //   obj.event = Peers.UPSTREAM_PING
            //   obj.net = net
            //   obj.data = Peers.PEER_VERSION
            //   socket.send(JSON.stringify(obj))
            //   }, 3000) 
          })

          if (push == true)
            push_upstream_peer_client(socket, net)
        })
      }

      if (db && db.peers && db.peers.enabled == true && db.peers.mode && db.peers.mode == 'upstream') {
        console.log("Allow upstream peers for net '%s'.", net)
      }
    }
    return cb(con)
  },

  push_upstream_peer_server: function(peer, net) {
    peer._sender._socket._peername.net = net
    debugPeers("Pushed upstream server for net '%s': %o", net, peer._sender._socket._peername)

    if (!Array.isArray(upstreamPeers[net]))
      upstreamPeers[net] = []

    upstreamPeers[net].push(peer)
  },

  update_upstream_peer_servers: async function(wsInstance) {
    const sleep = ms => new Promise(res => setTimeout(res, ms))
    await sleep(100)
    const clientsSet = wsInstance.getWss().clients
    const clientsValues = clientsSet.values()
    const newUpstreamPeers = {}
    const nets = ['mainnet', 'yerbas']

    for(let h=0; h < nets.length; h++) {
      const net = nets[h]
      if (!Array.isArray(newUpstreamPeers[net]))
        newUpstreamPeers[net] = []

      for(let i=0; i < clientsSet.size; i++) {
        const peer = clientsValues.next().value
        if (peer && peer._sender._socket._peername.net == net) {
          debugPeers("Alive upstream peer for net '%s': %o.", peer._sender._socket._peername)
          newUpstreamPeers[net].push(peer)
        }
      }
    }
    upstreamPeers = newUpstreamPeers
  },

  check_show_sync_message: function(net=settings.getDefaultNet()) {
    return fs.existsSync('./tmp/show_sync_message-' + net + '.tmp');
  },

  find_txs_by_blockhash: function(hash, cb, net=settings.getDefaultNet()) {
    const path = Peers.UPSTREAM_GET_TXES_BY_BLOCKHASH + net + '/' + hash
    const cached = txsCache.get(path)
    if (cached) {
      return cb(cached)
    }

    if (settings.needsUpstream(net)) {
      if (has_upstream_peers(net)) {
        debugPeers("Get remote txs by block hash '%s' for net '%s', number of peers %d", hash, net, upstreamPeers.length)
        get_upstream_peer(net).send(path, function() {
          wait_until_upstream_cached(cb, txsCache, path)
        })
      } else {
        cb(WAIT_FOR_UPSTREAM_PEERS)
      }
    } else {
      get_txs_by_blockhash_local(hash, cb, net)
    }
  },

  // TODO: Peers.
  update_label: function(hash, claim_name, cb, net=settings.getDefaultNet()) {
    module.exports.get_address(hash, function(address) {
      if (address) {
        AddressDb[net].updateOne({a_id: hash}, {
          name: claim_name
        }).then(() => {
          // update claim name in richlist
          module.exports.update_richlist_claim_name(hash, claim_name, function() {
            // update claim name in masternode list
            module.exports.update_masternode_claim_name(hash, claim_name, function() {
              return cb('')
            }, net);
          }, net);
        }).catch((err) => {
          console.error("Failed to update address '%s' for chain '%s': %s", hash, net, err)
          return cb(err)
        });
      } else {
        // address is not valid or does not have any transactions
        return cb('no_address')
      }
    }, net)
  },

  // TODO: Peers.
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

  // TODO: Peers.
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

  get_dbindex: function(coinName, cb, net=settings.getDefaultNet()) {
    const path = Peers.UPSTREAM_GET_DBINDEX + net
    const cached = dbindexCache.get(path)
    if (cached) {
      return cb(cached)
    }

    if (settings.needsUpstream(net)) {
      if (has_upstream_peers(net)) {
        debugPeers("Get remote db index for net '%s', number of peers %d", net, upstreamPeers.length)
        get_upstream_peer(net).send(path, function() {
          wait_until_upstream_cached(cb, dbindexCache, path)
        })
      } else {
        cb(WAIT_FOR_UPSTREAM_PEERS)
      }
    } else {
      get_dbindex_local(coinName, cb, net)
    }
  },

  get_address: function(hash, cb, net=settings.getDefaultNet()) {
    const path = Peers.UPSTREAM_GET_ADDRESS + net + '/' + hash
    const cached = addressCache.get(net)
    if (cached) {
      return cb(cached)
    }

    if (settings.needsUpstream(net)) {
      if (has_upstream_peers(net)) {
        debugPeers("Get remote address '%s' for net '%s', number of peers %d", hash, net, upstreamPeers.length)
        get_upstream_peer(net).send(path, function() {
          wait_until_upstream_cached(cb, addressCache, path)
        })
      } else {
        cb(WAIT_FOR_UPSTREAM_PEERS)
      }
    } else {
      get_address_local(hash, cb, net)
    }
  },

  get_block_by_height: function(height, cb, net=settings.getDefaultNet()) {
    const path = Peers.UPSTREAM_GET_BLOCK_BY_HEIGHT + net + '/' + height
    const cached = blocksCache.get(path)
    if (cached) {
      return cb(cached)
    }

    if (settings.needsUpstream(net)) {
      if (has_upstream_peers(net)) {
        debugPeers("Get remote block by height %d for net '%s', number of peers %d", height, net, upstreamPeers.length)
        get_upstream_peer(net).send(path, function() {
          wait_until_upstream_cached(cb, blocksCache, path)
        })
      } else {
        cb(WAIT_FOR_UPSTREAM_PEERS)
      }
    } else {
      get_block_by_height_local(height, cb, net)
    }
  },

  get_block_by_hash: function(hash, cb, net=settings.getDefaultNet()) {
    const path = Peers.UPSTREAM_GET_BLOCK_BY_HASH + net + '/' + hash
    const cached = blocksCache.get(path)
    if (cached) {
      return cb(cached)
    }

    if (settings.needsUpstream(net)) {
      if (has_upstream_peers(net)) {
        debugPeers("Get remote block by hash '%s' for net '%s', number of peers %d", hash, net, upstreamPeers.length)
        get_upstream_peer(net).send(path, function() {
          wait_until_upstream_cached(cb, blocksCache, path)
        })
      } else {
        cb(WAIT_FOR_UPSTREAM_PEERS)
      }
    } else {
      get_block_by_hash_local(hash, cb, net)
    }
  },

  get_richlist: function(coin, cb, net=settings.getDefaultNet()) {
    const path = Peers.UPSTREAM_GET_RICHLIST + net
    const cached = richlistCache.get(path)
    if (cached) {
      return cb(cached)
    }

    if (settings.needsUpstream(net)) {
      if (has_upstream_peers(net)) {
        debugPeers("Get remote richlist for net '%s', number of peers %d", net, upstreamPeers.length)
        get_upstream_peer(net).send(path, function() {
          wait_until_upstream_cached(cb, richlistCache, path)
        })
      } else {
        cb(WAIT_FOR_UPSTREAM_PEERS)
      }
    } else {
      get_richlist_local(coin, cb, net)
    }
  },

  get_network_chart_data: function(cb, net=settings.getDefaultNet()) {
    const path = Peers.UPSTREAM_GET_NETWORK_CHART + net
    const cached = networkChartCache.get(path)
    if (cached) {
      return cb(cached)
    }

    if (settings.needsUpstream(net)) {
      if (has_upstream_peers(net)) {
        debugPeers("Get remote network chart for net '%s', number of peers %d", net, upstreamPeers.length)
        get_upstream_peer(net).send(path, function() {
          wait_until_upstream_cached(cb, networkChartCache, path)
        })
      } else {
        cb(WAIT_FOR_UPSTREAM_PEERS)
      }
    } else {
      get_network_chart_data_local(cb, net)
    }
  },

  // get last transactions, optional by tx_type.
  get_last_txs: function(start, length, min, type, cb, net=settings.getDefaultNet()) {
    const coin = settings.getCoin(net)
    get_stats(coin.name, function(stats) {
      const path = Peers.UPSTREAM_GET_LAST_TXES + net + '/' + start + '/' + length + '/' + min + '/' + type
      const cached = txsCache.get(path)
      if (cached) {
        return cb(cached)
      }

      if (settings.needsUpstream(net)) {
        if (has_upstream_peers(net)) {
          debugPeers("Get remote last txs for net '%s', number of peers %d", net, upstreamPeers.length)
          get_upstream_peer(net).send(path, function() {
            wait_until_upstream_cached(cb, txsCache, path)
          })
        } else {
          cb(WAIT_FOR_UPSTREAM_PEERS)
        }
      } else {
        var findCriteria = {'total': {$gte: min}}
        if (!isNaN(type) && type > -1) {
          findCriteria = {'total': {$gte: min}, 'tx_type': type}
        }
        get_last_txs_local(cb, stats, start, length, findCriteria, net)
      }
    }, net)
  },

  get_address_txs: function(hash, start, length, cb, net=settings.getDefaultNet()) {
    const path = Peers.UPSTREAM_GET_ADDRESS_TXES + net + '/' + hash + '/' + start + '/' + length
    const cached = addressTxCache.get(path)
    if (cached) {
      return cb(cached)
    }

    if (settings.needsUpstream(net)) {
      if (has_upstream_peers(net)) {
        debugPeers("Get remote address txes for net '%s', number of peers %d", net, upstreamPeers.length)
        get_upstream_peer(net).send(path, function() {
          wait_until_upstream_cached(cb, addressTxCache, path)
        })
      } else {
        cb(WAIT_FOR_UPSTREAM_PEERS)
      }
    } else {
      get_address_txs_local(hash, start, length, cb, net)
    }
  },

  // gets market data for given market and trading pair
  get_market: function(market, coin_symbol, pair_symbol, cb, net=settings.getDefaultNet()) {
    const path = Peers.UPSTREAM_GET_MARKET + net + '/' + market + '/' + coin_symbol + '/' + pair_symbol
    const cached = marketsCache.get(path)
    if (cached) {
      return cb(cached)
    }

    if (settings.needsUpstream(net)) {
      if (has_upstream_peers(net)) {
        debugPeers("Get remote market for net '%s', number of peers %d", net, upstreamPeers.length)
        get_upstream_peer(net).send(path, function() {
          wait_until_upstream_cached(cb, marketsCache, path)
        })
      } else {
        cb(WAIT_FOR_UPSTREAM_PEERS)
      }
    } else {
      get_market_local(market, coin_symbol, pair_symbol, cb, net)
    }
  },

  // gets all markets including buys, sells and historical data.
  get_markets: function(cb, net=settings.getDefaultNet()) {
    const path = Peers.UPSTREAM_GET_MARKETS + net
    const cached = marketsCache.get(path)
    if (cached) {
      return cb(cached)
    }

    if (settings.needsUpstream(net)) {
      if (has_upstream_peers(net)) {
        debugPeers("Get remote markets for net '%s', number of peers %d", net, upstreamPeers.length)
        get_upstream_peer(net).send(path, function() {
          wait_until_upstream_cached(cb, marketsCache, path)
        })
      } else {
        cb(WAIT_FOR_UPSTREAM_PEERS)
      }
    } else {
      get_markets_local(cb, net)
    }
  },

  // gets all markets without buys, sells and historical data.
  get_markets_summary: function(cb, net=settings.getDefaultNet()) {
    const path = Peers.UPSTREAM_GET_MARKET_SUMMARY + net
    const cached = marketsCache.get(path)
    if (cached) {
      return cb(cached)
    }

    if (settings.needsUpstream(net)) {
      if (has_upstream_peers(net)) {
        debugPeers("Get remote market summary for net '%s', number of peers %d", net, upstreamPeers.length)
        get_upstream_peer(net).send(path, function() {
          wait_until_upstream_cached(cb, marketsCache, path)
        })
      } else {
        cb(WAIT_FOR_UPSTREAM_PEERS)
      }
    } else {
      get_markets_summary_local(cb, net)
    }
  },

  // gets market trade history data for given market and trading pair sorted by timestamp descending
  get_market_trade_history: function(market, coin_symbol, pair_symbol, cb, net=settings.getDefaultNet()) {
    const path = Peers.UPSTREAM_GET_MARKET_HISTORY + net + '/' + market + '/' + coin_symbol + '/' + pair_symbol
    const cached = marketsCache.get(path)
    if (cached) {
      return cb(cached)
    }

    if (settings.needsUpstream(net)) {
      if (has_upstream_peers(net)) {
        debugPeers("Get remote market history for net '%s', number of peers %d", net, upstreamPeers.length)
        get_upstream_peer(net).send(path, function() {
          wait_until_upstream_cached(cb, marketsCache, path)
        })
      } else {
        cb(WAIT_FOR_UPSTREAM_PEERS)
      }
    } else {
      get_market_trade_history_local(market, coin_symbol, pair_symbol, cb, net)
    }
  },

  // gets buy orders aggregation for a given market and trading pair ordered by price descending.
  get_buy_order_aggregation: function(ex, market, trade, reverse, cb, net=settings.getDefaultNet()) {
    const path = Peers.UPSTREAM_GET_BUY_ORDER_AGGR + net + '/' + ex + '/' + market + '/' + trade + '/' + reverse
    const cached = marketsCache.get(path)
    if (cached) {
      return cb(cached)
    }

    if (settings.needsUpstream(net)) {
      if (has_upstream_peers(net)) {
        debugPeers("Get remote market buy order aggr. for net '%s', number of peers %d", net, upstreamPeers.length)
        get_upstream_peer(net).send(path, function() {
          wait_until_upstream_cached(cb, marketsCache, path)
        })
      } else {
        cb(WAIT_FOR_UPSTREAM_PEERS)
      }
    } else {
      get_buy_order_aggregation_local(ex, market, trade, reverse, cb, net)
    }
  },

  // gets sell orders aggregation for a given market and trading pair ordered by price ascending.
  get_sell_order_aggregation: function(ex, market, trade, reverse, cb, net=settings.getDefaultNet()) {
    const path = Peers.UPSTREAM_GET_SELL_ORDER_AGGR + net + '/' + ex + '/' + market + '/' + trade + '/' + reverse
    const cached = marketsCache.get(path)
    if (cached) {
      return cb(cached)
    }

    if (settings.needsUpstream(net)) {
      if (has_upstream_peers(net)) {
        debugPeers("Get remote market buy order aggr. for net '%s', number of peers %d", net, upstreamPeers.length)
        get_upstream_peer(net).send(path, function() {
          wait_until_upstream_cached(cb, marketsCache, path)
        })
      } else {
        cb(WAIT_FOR_UPSTREAM_PEERS)
      }
    } else {
      get_sell_order_aggregation_local(ex, market, trade, reverse, cb, net)
    }
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

  get_peers: function(cb, net=settings.getDefaultNet()) {
    const path = Peers.UPSTREAM_GET_PEERS + net
    const cached = peersCache.get(path)
    if (cached) {
      return cb(cached)
    }

    if (settings.needsUpstream(net)) {
      if (has_upstream_peers(net)) {
        debugPeers("Get remote network peers for net '%s', number of peers %d", net, upstreamPeers.length)
        get_upstream_peer(net).send(path, function() {
          wait_until_upstream_cached(cb, peersCache, path)
        })
      } else {
        cb(WAIT_FOR_UPSTREAM_PEERS)
      }
    } else {
      get_peers_local(cb, net)
    }
  },

  // get the list of masternodes
  get_masternodes: function (cb, net=settings.getDefaultNet()) {
    const path = Peers.UPSTREAM_GET_MASTERNODES + net
    const cached = masternodesCache.get(path)
    if (cached) {
      return cb(cached)
    }

    if (settings.needsUpstream(net)) {
      if (has_upstream_peers(net)) {
        debugPeers("Get remote network masternodes for net '%s', number of peers %d", net, upstreamPeers.length)
        get_upstream_peer(net).send(path, function() {
          wait_until_upstream_cached(cb, masternodesCache, path)
        })
      } else {
        cb(WAIT_FOR_UPSTREAM_PEERS)
      }
    } else {
      get_masternodes_local(cb, net)
    }
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

      module.exports.get_address(addresses[a], function(address) {
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

  // TODO: Check init.
  initialize_data_startup: function(cb, net=settings.getDefaultNet()) {
    net = settings.getNet(net)
    if (net == null) {
      console.error("Failed to initialize DB for chain '%s'. Exit.", net)
      exit(1);
    }
    const coin = settings.getCoin(net)

    console.log('- %s %s initialize DB...', net, coin.name);

    // check if stats collection is initialized
    check_stats(coin.name, function(stats_exists) {
      var skip = true;
      // determine if stats collection already exists
      if (stats_exists == false) {
        console.log('No stats entry found. Creating new entry now...');
        skip = false;
      }
      // initialize the stats collection
      create_stats(coin.name, skip, function() {
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

  get_xpeers: function(cb, net=settings.getDefaultNet()) {
    XPeersDb[net].find().sort({address: 1, protocol: -1, port: 1}).exec().then((peers) => {
      return cb(peers)
    }).catch((err) => {
      console.error("Failed to get X peers: %s", err)
      return cb([])
    })
  },
  
  check_stats: check_stats,
  get_tx: get_tx,
  fs: fs,
  BlockDb: BlockDb,
  PeersDb: PeersDb,
  MasternodeDb: MasternodeDb,
  RichlistDb: RichlistDb,
  MarketsDb: MarketsDb,
  MarketOrderDb: MarketOrderDb,
  MarketTradeDb: MarketTradeDb,
  get_dbindex_local: get_dbindex_local,
  get_stats: get_stats,
  get_markets_local: get_markets_local,
  get_market_data: get_market_data,
  NetworkHistoryDb: NetworkHistoryDb,
  statsCache: statsCache,
  dbindexCache: dbindexCache,
  blocksCache: blocksCache,
  addressCache: addressCache,
  addressTxCache: addressTxCache,
  txsCache: txsCache,
  peersCache: peersCache,
  masternodesCache: masternodesCache,
  upstreamPeers: upstreamPeers,
  richlistCache: richlistCache,
  marketsCache: marketsCache,
  networkChartCache: networkChartCache
};