module.exports = new require('mongoose').Schema({
  coin: { type: String, index: true, required : true },
  chain: { type: String, index: true, required : true },
  latest_block_height: { type: Number, default: 1, required : true },
  count_addresses: { type: Number, default: 0, required : true },
  count_utxos: { type: Number, default: 0, required : true },
  count_txes: { type: Number, default: 0, required : true },
  count_tx_by_type: { type: Object, index: false, required: false },
  count_blocks: { type: Number, default: 0, required : true },
  count_blocks_by_algorithm: { type: Object, index: false, required: false },
  count_masternodes_enabled: { type: Number, default: 0, required : true },
  count_masternodes_by_country: { type: Object, index: false, required: false },
  latest_coinbase_tx: { type: Object, index: false, required: false },
  buy_order_aggregation: { type: Object, index: false, required: false },
  sell_order_aggregation: { type: Object, index: false, required: false }  
})