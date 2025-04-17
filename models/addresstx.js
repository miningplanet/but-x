module.exports = new require('mongoose').Schema({
  a_id: { type: String, index: true},
  blockindex: {type: Number, default: 0, index: true},
  txid: { type: String, lowercase: true, index: true},
  amount: { type: Number, default: 0, index: false},
  name: { type: String, required: false, index: true},
  ttype: { type: Number, required: false, index: true},
  tamount: { type: Number, required: false, index: false},
  treissue: { type: Boolean, required: false, index: false },
  tunits: { type: Number, required: false, index: false},
  asm: { type: String, required: false, index: false},
}, {id: false})