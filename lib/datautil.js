/**
  Helper class for data related functions.
*/
const trace = require('debug')('trace')

const ZERO_DK = '000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
const ZERO_DK_COMPRESSED = '0'

/* BUTK tx_type 1 JSON to array. See validation.h -> TRANSACTION_PROVIDER_REGISTER. */
function protxRegisterServiceTxToArray(tx) {
    r = []
    r[0] = tx.proRegTx.version
    r[1] = tx.proRegTx.collateralHash
    r[2] = tx.proRegTx.collateralIndex
    r[3] = tx.proRegTx.service
    r[4] = tx.proRegTx.ownerAddress
    r[5] = tx.proRegTx.votingAddress
    r[6] = tx.proRegTx.payoutAddress
    r[7] = tx.proRegTx.pubKeyOperator
    r[8] = tx.proRegTx.operatorReward
    r[9] = tx.proRegTx.inputsHash
    if (trace.enabled) trace("Parsed Protx Register Service TX object: %o", r)
    return r
}

/* BUTK tx_type 2 JSON to array. See validation.h -> TRANSACTION_PROVIDER_UPDATE_SERVICE. */
function protxUpdateServiceTxToArray(tx) {
    r = []
    r[0] = tx.proUpServTx.version
    r[1] = tx.proUpServTx.proTxHash
    r[2] = tx.proUpServTx.service
    r[3] = tx.proUpServTx.inputsHash
    if (trace.enabled) trace("Parsed Protx Update Service TX object: %o", r)
    return r
}

/* BUTK tx_type 3 JSON to array. See validation.h -> TRANSACTION_PROVIDER_UPDATE_REGISTRAR. */
function protxUpdateRegistrarTxToArray(tx) {
    r = []
    r[0] = tx.proUpRegTx.version
    r[1] = tx.proUpRegTx.proTxHash
    r[2] = tx.proUpRegTx.votingAddress
    r[3] = tx.proUpRegTx.payoutAddress
    r[4] = tx.proUpRegTx.pubKeyOperator
    r[5] = tx.proUpRegTx.inputsHash
    if (trace.enabled) trace("Parsed Protx Update Registrar TX object: %o", r)
    return r
}

/* BUTK tx_type 4 JSON to array. See validation.h -> TRANSACTION_PROVIDER_UPDATE_REVOKE. */
function protxUpdateRevokeTxToArray(tx) {
    r = []
    r[0] = tx.proUpRevTx.version
    r[1] = tx.proUpRevTx.proTxHash
    r[2] = tx.proUpRevTx.reason
    r[3] = tx.proUpRevTx.inputsHash
    if (trace.enabled) trace("Parsed Protx Update Registrar TX object: %o", r)
    return r
}

/* BUTK tx_type 6 JSON to array. See validation.h -> TRANSACTION_QUORUM_COMMITMENT. */
function protxQuorumCommitmentTxToArray(tx) {
    r = []
    r[0] = tx.qcTx.version
    r[1] = tx.qcTx.height
    r[2] = tx.qcTx.commitment.version
    r[3] = tx.qcTx.commitment.llmqType
    r[4] = tx.qcTx.commitment.quorumHash
    r[5] = tx.qcTx.commitment.signersCount
    r[6] = tx.qcTx.commitment.validMembersCount
    if (tx.qcTx.commitment.quorumPublicKey == ZERO_DK)
        r[7] = ZERO_DK_COMPRESSED
    else
        r[7] = tx.qcTx.commitment.quorumPublicKey
    if (trace.enabled) trace("Parsed quorum commitment TX object: %o", r)
    return r
}

function get_distribution(settings, lib, richlist, stats, cb, net=settings.getDefaultNet()) {
  const richlist_page = settings.get(net, 'richlist_page')
  var distribution = {
    supply: stats.supply,
    t_1_25: {percent: 0, total: 0 },
    t_26_50: {percent: 0, total: 0 },
    t_51_75: {percent: 0, total: 0 },
    t_76_100: {percent: 0, total: 0 },
    t_101plus: {percent: 0, total: 0 }
  }
  lib.syncLoop(richlist.balance.length, function (loop) {
    var i = loop.iteration()
    var count = i + 1
    var percentage = ((richlist.balance[i].balance / 100000000) / stats.supply) * 100

    if (count <= 25 ) {
      distribution.t_1_25.percent = distribution.t_1_25.percent + percentage
      distribution.t_1_25.total = distribution.t_1_25.total + (richlist.balance[i].balance / 100000000)
    }

    if (count <= 50 && count > 25) {
      distribution.t_26_50.percent = distribution.t_26_50.percent + percentage
      distribution.t_26_50.total = distribution.t_26_50.total + (richlist.balance[i].balance / 100000000)
    }

    if (count <= 75 && count > 50) {
      distribution.t_51_75.percent = distribution.t_51_75.percent + percentage
      distribution.t_51_75.total = distribution.t_51_75.total + (richlist.balance[i].balance / 100000000)
    }

    if (count <= 100 && count > 75) {
      distribution.t_76_100.percent = distribution.t_76_100.percent + percentage
      distribution.t_76_100.total = distribution.t_76_100.total + (richlist.balance[i].balance / 100000000)
    }

    loop.next()
  }, function() {
    distribution.t_101plus.percent = parseFloat(100 - distribution.t_76_100.percent - distribution.t_51_75.percent - distribution.t_26_50.percent - distribution.t_1_25.percent - (richlist_page.burned_coins.include_burned_coins_in_dist == true && richlist.burned > 0 ? ((richlist.burned / 100000000) / stats.supply) * 100 : 0)).toFixed(2)
    distribution.t_101plus.total = parseFloat(distribution.supply - distribution.t_76_100.total - distribution.t_51_75.total - distribution.t_26_50.total - distribution.t_1_25.total - (richlist_page.burned_coins.include_burned_coins_in_dist == true && richlist.burned > 0 ? (richlist.burned / 100000000) : 0)).toFixed(8)
    distribution.t_1_25.percent = parseFloat(distribution.t_1_25.percent).toFixed(2)
    distribution.t_1_25.total = parseFloat(distribution.t_1_25.total).toFixed(8)
    distribution.t_26_50.percent = parseFloat(distribution.t_26_50.percent).toFixed(2)
    distribution.t_26_50.total = parseFloat(distribution.t_26_50.total).toFixed(8)
    distribution.t_51_75.percent = parseFloat(distribution.t_51_75.percent).toFixed(2)
    distribution.t_51_75.total = parseFloat(distribution.t_51_75.total).toFixed(8)
    distribution.t_76_100.percent = parseFloat(distribution.t_76_100.percent).toFixed(2)
    distribution.t_76_100.total = parseFloat(distribution.t_76_100.total).toFixed(8)

    return cb(distribution)
  })
}

function convert_to_satoshi(amount, cb) {
  // fix to 8dp & convert to string
  var fixed = amount.toFixed(8).toString()
  // remove decimal (.) and return integer
  return cb(parseInt(fixed.replace('.', '')))
}

function is_unique(array, object, key_name, cb) {
  var unique = true
  var index = null

  module.exports.syncLoop(array.length, function (loop) {
    var i = loop.iteration()

    if (array[i][key_name] == object) {
      unique = false
      index = i
      loop.break(true)
      loop.next()
    } else
      loop.next()
  }, function() {
    return cb(unique, index)
  })
}

module.exports = {
    ZERO_DK: ZERO_DK,
    ZERO_DK_COMPRESSED: ZERO_DK_COMPRESSED,
    protxRegisterServiceTxToArray: protxRegisterServiceTxToArray,
    protxUpdateServiceTxToArray: protxUpdateServiceTxToArray,
    protxUpdateRegistrarTxToArray: protxUpdateRegistrarTxToArray,
    protxUpdateRevokeTxToArray: protxUpdateRevokeTxToArray,
    protxQuorumCommitmentTxToArray: protxQuorumCommitmentTxToArray,
    get_distribution: get_distribution,
    convert_to_satoshi: convert_to_satoshi,
    is_unique: is_unique,
}