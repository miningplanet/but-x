module.exports = new require('mongoose').Schema({
  coin: { type: String, index: true, required : true },
  chain: { type: String, index: true, required : true },
  count: { type: Number, default: 1, required : true }, // headers
  last: { type: Number, default: 1, required : true }, // blocks
  count_tx_by_type: { type: Object, index: false, required: false },
  count_blocks_by_algorithm: { type: Object, index: false, required: false },
  latest_coinbase_tx: { type: Object, index: false, required: false },
  buy_order_aggregation: { type: Object, index: false, required: false },
  sell_order_aggregation: { type: Object, index: false, required: false }  
})