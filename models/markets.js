module.exports = new require('mongoose').Schema({
  market: { type: String, index: true },
  ext_market_url: { type: String },
  referal: { type: String },
  logo: { type: String },
  coin_symbol: { type: String },
  pair_symbol: { type: String },
  reverse: { type: Boolean, default: false },
  summary: { type: Object, default: {} },
  chartdata: { type: Array, default: [] },
  buys: { type: Array, default: [] },
  sells: { type: Array, default: [] },
  history: { type: Array, default: [] },
})