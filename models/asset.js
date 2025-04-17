const mongoose = require('mongoose')

module.exports = mongoose.Schema({
  height: { type: Number, default: 0, index: true },
  txid: { type: String, index: true },
  name: { type: String, default: "", unique: true, index: true },
  owner: { type: String, index: true },
  address: { type: String, index: true },
  owner_address: { type: String, index: true },
  tx_type: { type: String, default: null, index: true },
  tx_count: { type: Number, default: 0, index: false },
  vout: { type: Number, default: 0, index: false },
  type: { type: String, default: "", unique: false, index: true },
  expire_time: { type: Number, default: -1, index: false },
  amount: { type: Number, default: 0, index: false },
  units: { type: Number, default: 0, index: false },
  balance: { type: Number, default: 0, index: false },
  ipfs_hash: { type: String, default: "", unique: false, index: true },
  token: { type: String, default: "", index: false },
}, {id: false})