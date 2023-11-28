const debug = require('debug')('rpc')
const rpc = require('./jsonrpc')

function Client(opts) {
  this.opts = opts
  this.rpc = new rpc.Client(opts)
}

Client.prototype.cmd = function() {
  const args = [].slice.call(arguments)
  const cmd = args.shift()
  callRpc(cmd, args, this.rpc)
}

function callRpc (cmd, args, rpc) {
  var fn = args[args.length - 1]

  debug("Call rpc command '%o', args '%o'", cmd, args)
  debug("With opts '%o'.", rpc.opts)

  // if the last argument is a callback, pop it from the args list
  if (typeof fn === 'function')
    args.pop()
  else
    fn = function () {}

  rpc.call(cmd, args, function () {
    const args = [].slice.call(arguments)
    args.unshift(null)
    fn.apply(this, args)
  }, function(err) {
    fn(err)
  })
}

module.exports.Client = Client