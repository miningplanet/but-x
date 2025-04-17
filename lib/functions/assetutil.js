const debug = require('debug')('yerbas')
const d_assets = require('debug')('assets')

/* 
--- Asset Registration ---

vout:[
...,
{
  "value": 0,
  "valueSat": 0,
  "n": 1,
  "scriptPubKey": {
    "asm": "OP_DUP OP_HASH160 b79bfb8283f4a053ff5bd3ea08937e4ddd0b6ded OP_EQUALVERIFY OP_CHECKSIG OP_YERB_ASSET 0a72766e6f05534849422175",
    "hex": "76a914b79bfb8283f4a053ff5bd3ea08937e4ddd0b6ded88acc00a72766e6f05534849422175",
    "reqSigs": 1,
    "type": "new_asset",
    "asset": {
      "name": "SHIB!",
      "amount": 1,
      "expire_time": 94104290836599
    },
    "addresses": [
      "yd4HNACM8zu5uH5k6xYEWnRf5J6bJNfUdx"
    ]
  }
},
{
  "value": 0,
  "valueSat": 0,
  "n": 2,
  "scriptPubKey": {
    "asm": "OP_DUP OP_HASH160 b79bfb8283f4a053ff5bd3ea08937e4ddd0b6ded OP_EQUALVERIFY OP_CHECKSIG OP_YERB_ASSET 1472766e710453484942000052acdfb2241d08010075",
    "hex": "76a914b79bfb8283f4a053ff5bd3ea08937e4ddd0b6ded88acc01472766e710453484942000052acdfb2241d08010075",
    "reqSigs": 1,
    "type": "new_asset",
    "asset": {
      "name": "SHIB",
      "amount": 21000000000,
      "expire_time": 94104290836599,
      "units": 8,
      "reissuable": 1
    },
    "addresses": [
      "yd4HNACM8zu5uH5k6xYEWnRf5J6bJNfUdx"
    ]
  },
  "spentTxId": "2ae2f871a736bdca5dfebefc0583847f61f27dd77b9db85c088b00e6ca626c6b",
  "spentIndex": 1,
  "spentHeight": 623239
}
...
]
*/

/* 
--- Asset Transfer (send 20,000 to yZpXBbJdvyngZ3fr7LxWypadLGsSXcuHTv; change 5,000 goes to yZkiUtGzBWpY1E2Dr1Nh2MqwydtsAYBEkQ ---
vin: [
{"txid":"c99f4fbaa547ca86663d1ea57d50b08ded6ab3781c6896af315153f420e18e32","vout":2, ...],
{"txid":"c99f4fbaa547ca86663d1ea57d50b08ded6ab3781c6896af315153f420e18e32","vout":1, ...],
],
vout:[
...,
{
  "value": 0,
  "valueSat": 0,
  "n": 1,
  "scriptPubKey": {
    "asm": "OP_DUP OP_HASH160 941950f07f4afe29b873f03170fda4f60e15bdfe OP_EQUALVERIFY OP_CHECKSIG OP_YERB_ASSET 1172766e74045348494200204aa9d101000075",
    "hex": "76a914941950f07f4afe29b873f03170fda4f60e15bdfe88acc01172766e74045348494200204aa9d101000075",
    "reqSigs": 1,
    "type": "transfer_asset",
    "asset": {
      "name": "SHIB",
      "amount": 20000
    },
    "addresses": [
      "yZpXBbJdvyngZ3fr7LxWypadLGsSXcuHTv"
    ]
  },
  "spentTxId": "e623dd30ead4832b1ae754f55c6a2fca48276eec10b57442e4205de574b2ff73",
  "spentIndex": 2,
  "spentHeight": 623895
},
{
  "value": 0,
  "valueSat": 0,
  "n": 2,
  "scriptPubKey": {
    "asm": "OP_DUP OP_HASH160 9361156301583856911cfe68a5ed7597614c9750 OP_EQUALVERIFY OP_CHECKSIG OP_YERB_ASSET 1172766e7404534849420088526a7400000075",
    "hex": "76a9149361156301583856911cfe68a5ed7597614c975088acc01172766e7404534849420088526a7400000075",
    "reqSigs": 1,
    "type": "transfer_asset",
    "asset": {
      "name": "SHIB",
      "amount": 5000
    },
    "addresses": [
      "yZkiUtGzBWpY1E2Dr1Nh2MqwydtsAYBEkQ"
    ]
  }
},
...
]
*/

/* 
   Returns an array of vout containing
   - the ownership asset (!) at index 0 
   - the child asset at index 1,
   if it is a main asset or sub asset (/).

   In case of a unique assset (#), we return the parent 
   asset name at index 0 as a string.
*/
function getNewAsset(vout) {
    const r = new Array(2)
    var ownership
    var child
    vout.forEach(v => {
      if (hasNewAsset(v) && v.scriptPubKey.asset.name.endsWith('!')) {
        if (d_assets.enabled) d_assets("Found new asset (i=0): %o.", v)
          r[0] = v
      }
      if (hasNewAsset(v) && !v.scriptPubKey.asset.name.endsWith('!')) {
        if (d_assets.enabled) d_assets("Found new asset (i=1): %o.", v)
          r[1] = v
      }
    })
    return r
}

function getDistinctAssets(vout) {
  const r = new Set()
  if (vout && Array.isArray(vout)) {
    for (v in vout) {
      if (vout[v].scriptPubKey && vout[v].scriptPubKey.asset && Array.isArray(vout[v].scriptPubKey.addresses)) {
        r.add(vout[v].scriptPubKey.asset.name)
      }
    }
  }
  return r
}

function getDistinctTransferAssets(vout) {
  const r = new Set()
  if (vout && Array.isArray(vout)) {
    for (v in vout) {
      if (vout[v].scriptPubKey && vout[v].scriptPubKey.asset && Array.isArray(vout[v].scriptPubKey.addresses) && vout[v].scriptPubKey.type === 'transfer_asset') {
        r.add(vout[v].scriptPubKey.asset.name)
      }
    }
  }
  if (d_assets.enabled) d_assets("Found distinct transfer assets %o.", r)
  return r
}

/* 
vout[.].scriptPubKey.type 
vout[.].scriptPubKey.asset.name
vout[.].scriptPubKey.asset.amount
*/
function hasAsset(utxo) {
  const r = utxo && utxo.scriptPubKey && utxo.scriptPubKey.type && utxo.scriptPubKey.asset && utxo.scriptPubKey.asset.name
    && (utxo.scriptPubKey.type === 'transfer_asset' 
    || utxo.scriptPubKey.type === 'new_asset')
  if (r && d_assets.enabled)
    d_assets("Found %s %o.", utxo.scriptPubKey.type, utxo.scriptPubKey.asset)
  return r
}

function hasNewAsset(utxo) {
  const r = utxo && utxo.scriptPubKey && utxo.scriptPubKey.type && utxo.scriptPubKey.asset && utxo.scriptPubKey.asset.name && utxo.scriptPubKey.type === 'new_asset'
  if (r && d_assets.enabled)
    d_assets("Found %s %o.", utxo.scriptPubKey.type, utxo.scriptPubKey.asset)
  return r
}

function hasAssetHexAsm(utxo) {
  const r = utxo && utxo.scriptPubKey && utxo.scriptPubKey.type && utxo.scriptPubKey.hex
    && (utxo.scriptPubKey.type === 'transfer_asset'
    || utxo.scriptPubKey.type === 'new_asset' )
  if (r && d_assets.enabled)
    d_assets("Found asm %s %o.", utxo.scriptPubKey.type, utxo.scriptPubKey.asset)
  return r
}

function getAssetTypeIndex(type) {
  switch (type) {
    case 'new_asset':
      return 0
    case 'reissue_asset':
      return 1
    case 'transfer_asset':
      return 2
    case 'restricted_asset':
      return 3
    default:
      return -1
  }
}

function getAssetType(type) {
  switch (type) {
    case 0:
      return 'new_asset'
    case 1:
      return 'reissue_asset'
    case 2:
      return 'transfer_asset'
    case 3:
      return 'restricted_asset'
    default:
      return ''
  }
}

module.exports = {
    getDistinctAssets: getDistinctAssets,
    getDistinctTransferAssets: getDistinctTransferAssets,
    getNewAsset: getNewAsset,
    getAssetTypeIndex: getAssetTypeIndex,
    getAssetType: getAssetType,
    hasAsset: hasAsset,
    hasAssetHexAsm: hasAssetHexAsm
}