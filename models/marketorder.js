module.exports = new require('mongoose').Schema({
  ex: { type: String, index: true },
  market: { type: String, index: false },
  trade: { type: String, index: true },
  type: { type: Number, default: -1, index: true },
  price: { type: Number, default: -1, index: false },
  quantity: { type: Number, default: -1, index: false },
  date: { type: Number, default: -1,index: false },
}, { id: true })