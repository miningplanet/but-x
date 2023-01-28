var mongoose = require('mongoose'),
   Schema = mongoose.Schema;

var TxSchema = new Schema({
  txid: { type: String, lowercase: true, unique: true, index: true},
  version: {type: Number, default: 0 },
  tx_type: { type: String, default: null },
  size: {type: Number, default: 0 },
  locktime: {type: Number, default: 0 },
  instantlock: {type: Boolean, default: false },
  chainlock: {type: Boolean, default: false },
  vin: { type: Array, default: [] },
  vout: { type: Array, default: [] },
  total: { type: Number, default: 0, index: true },
  timestamp: { type: Number, default: 0, index: true },
  blockhash: { type: String, index: true },
  blockindex: {type: Number, default: 0, index: true},
  op_return: { type: String, default: null }
}, {id: false});

TxSchema.index({total: 1, total: -1, blockindex: 1, blockindex: -1});

module.exports = mongoose.model('Tx', TxSchema);