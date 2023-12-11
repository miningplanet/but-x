module.exports = new require('mongoose').Schema({
  ex: { type: String, index: true },
  market: { type: String, index: true },
  trade: { type: String, index: false },
  type: { type: Number, default: -1, index: true },
  price: { type: Number, default: -1, index: false },
  quantity: { type: Number, default: -1, index: false },
  date: { type: Number, default: -1,index: false },
}, { id: true })