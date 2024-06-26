module.exports = new require('mongoose').Schema({
  rank: { type: Number, default: 0 },
  network: { type: String, default: "" },
  txhash: { type: String, default: "" },
  outidx : { type: Number, default: 0},
  status : { type: String, default: "" },
  addr: { type: String, index: true },
  version : { type: Number, default: 0},
  lastseen: { type: Number, default: 0 },
  activetime: { type: Number, default: 0 },
  lastpaid: { type: Number, default: 0 },
  claim_name: { type: String, default: '', index: true },
  ip_address: { type: String, default: '', index: true },
  last_paid_block: {type: Number, default: 0},
  pose_score: {type: Number, default: 0},
  country: { type: String, default: "" },
  country_code: { type: String, default: "" }
}, {id: false})