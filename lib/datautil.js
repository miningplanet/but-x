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
    trace("Parsed Protx Register Service TX object: %o", r)
    return r
}

/* BUTK tx_type 2 JSON to array. See validation.h -> TRANSACTION_PROVIDER_UPDATE_SERVICE. */
function protxUpdateServiceTxToArray(tx) {
    r = []
    r[0] = tx.proUpServTx.version
    r[1] = tx.proUpServTx.proTxHash
    r[2] = tx.proUpServTx.service
    r[3] = tx.proUpServTx.inputsHash
    trace("Parsed Protx Update Service TX object: %o", r)
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
    trace("Parsed Protx Update Registrar TX object: %o", r)
    return r
}

/* BUTK tx_type 4 JSON to array. See validation.h -> TRANSACTION_PROVIDER_UPDATE_REVOKE. */
function protxUpdateRevokeTxToArray(tx) {
    r = []
    r[0] = tx.proUpRevTx.version
    r[1] = tx.proUpRevTx.proTxHash
    r[2] = tx.proUpRevTx.reason
    r[3] = tx.proUpRevTx.inputsHash
    trace("Parsed Protx Update Registrar TX object: %o", r)
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
    trace("Parsed quorum commitment TX object: %o", r)
    return r
}

module.exports = {
    ZERO_DK: ZERO_DK,
    ZERO_DK_COMPRESSED: ZERO_DK_COMPRESSED,
    protxRegisterServiceTxToArray: protxRegisterServiceTxToArray,
    protxUpdateServiceTxToArray: protxUpdateServiceTxToArray,
    protxUpdateRegistrarTxToArray: protxUpdateRegistrarTxToArray,
    protxUpdateRevokeTxToArray: protxUpdateRevokeTxToArray,
    protxQuorumCommitmentTxToArray: protxQuorumCommitmentTxToArray
}