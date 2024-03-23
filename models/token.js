module.exports = new require('mongoose').Schema({
  height: { type: Number, default: 0, index: true },
  txid: { type: String, lowercase: true, index: true },
  vout: { type: Number, default: 0, index: false },
  name: { type: String, default: "", unique: true, index: true },
  type: { type: String, default: "", unique: false, index: true },
  expire_time: { type: Number, default: -1, index: false },
  amount: { type: Number, default: 0, index: false },
  ipfs_hash: { type: String, default: "", unique: false, index: true },
  token: { type: String, default: "", index: false },
}, {id: false})