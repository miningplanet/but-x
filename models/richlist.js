module.exports = new require('mongoose').Schema({
  coin: { type: String },
  received: { type: Array, default: [] },
  balance: { type: Array, default: [] },
  toptx: { type: Array, default: [] },
  burned: { type: Array, default: [] }
})