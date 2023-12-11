module.exports = new require('mongoose').Schema({
  coin: { type: String },
  lvote: { type: Number, default: 0 },
  reward: { type: Number, default: 0 },
  supply: { type: Number, default: 0 },
  cap: { type: Number, default: 0 },
  estnext: { type: Number, default: 0 },
  phase: { type: String, default: 'N/A'},
  maxvote: { type: Number, default: 0 },
  nextin: { type: String, default: 'N/A'},
  votes: { type: Array, default: [] }
})