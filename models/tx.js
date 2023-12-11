module.exports = new require('mongoose').Schema({
  txid: { type: String, lowercase: true, unique: true, index: true },
  version: {type: Number, default: 0, index: false },
  tx_type: { type: String, default: null, index: false },
  size: {type: Number, default: 0, index: false },
  locktime: {type: Number, default: 0, index: false },
  instantlock: {type: Boolean, default: false },
  chainlock: {type: Boolean, default: false },
  vin: { type: Array, default: [], index: false },
  vout: { type: Array, default: [], index: false },
  total: { type: Number, default: 0, index: false },
  timestamp: { type: Number, default: 0, index: false },
  blockhash: { type: String, index: true },
  blockindex: {type: Number, default: 0, index: true},
  op_return: { type: String, default: null },
  extra: { type: [String], default: null }
}, {id: false})