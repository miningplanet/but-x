const debug = require('debug')('debug')
const request = require('postman-request')
const settings = require('./settings')
const base_server = 'http://127.0.0.1:' + settings.webserver.port + "/"
const base_url = base_server + 'api/'
const onode = require('./node')
const datautil = require('./datautil')
const assetutil = require('./functions/assetutil')
const clients = []

const CHECK_YOUR_CONSOLE = 'There was an error. Check your console.'

settings.wallets.forEach(function (wallet) {
  clients[wallet.id] = new onode.Client(wallet)
})

function rpcCommand(params, cb) {
  const net = settings.getNet(params[0].net);
  clients[net].cmd([{method: params[0].method, params: params[0].parameters}], function(err, response) {
    if (err)
      return cb(CHECK_YOUR_CONSOLE);
    else
      return cb(response);
  });
}

function prepareRpcCommand(cmd, addParams) {
  var method_name = '';
  var params = addParams || [];

  // Check for null/blank string
  if (cmd != null && cmd.trim() != '') {
    // Split cmd by spaces
    var split = cmd.split(' ');

    for (i = 0; i < split.length; i++) {
      if (i == 0)
        method_name = split[i];
      else
        params.push(split[i]);
    }
  }

  return { method: method_name, parameters: params };
}

function convertHashUnits(hashes, net=settings.getDefaultNet()) {
  const shared_pages = settings.get(net, 'shared_pages')
  if (shared_pages.page_header.panels.network_panel.nethash_units == 'K') {
    // return units in KH/s
    return (hashes / 1000).toFixed(4);
  } else if (shared_pages.page_header.panels.network_panel.nethash_units == 'M') {
    // return units in MH/s
    return (hashes / 1000000).toFixed(4);
  } else if (shared_pages.page_header.panels.network_panel.nethash_units == 'G') {
    // return units in GH/s
    return (hashes / 1000000000).toFixed(4);
  } else if (shared_pages.page_header.panels.network_panel.nethash_units == 'T') {
    // return units in TH/s
    return (hashes / 1000000000000).toFixed(4);
  } else if (shared_pages.page_header.panels.network_panel.nethash_units == 'P') {
    // return units in PH/s
    return (hashes / 1000000000000000).toFixed(4);
  } else {
    // return units in H/s
    return hashes.toFixed(4);
  }
}

function encodeP2PKaddress(p2pk_descriptor, cb, net=settings.getDefaultNet()) {
  // find the descriptor value
  module.exports.get_descriptorinfo(p2pk_descriptor, function(descriptor_info) {
    // check for errors
    if (descriptor_info != null) {
      // encode the address using the output descriptor
      module.exports.get_deriveaddresses(descriptor_info.descriptor, function(p2pkh_address) {
        // check for errors
        if (p2pkh_address != null) {
          // return P2PKH address
          return cb(p2pkh_address);
        } else {
          // address could not be encoded
          return cb(null);
        }
      }, net);
    } else {
      // address could not be encoded
      return cb(null);
    }
  }, net);
}

function calculate_total(vout, cb) {
  var total = 0

  module.exports.syncLoop(vout.length, function (loop) {
    var i = loop.iteration()

    if (!isNaN(vout[i].amount))
      total = total + vout[i].amount
    else
      console.error("ERROR: vout[i].amount not a number: " + vout[i].amount)
    loop.next()
  }, function() {
    return cb(total)
  })
}

module.exports = {
  encodeP2PKaddress: encodeP2PKaddress,
  calculate_total: calculate_total,
  get_hashrate: function(cb, net=settings.getDefaultNet(), lookup=-1, height=-1) {
    const shared_pages = settings.get(net, 'shared_pages')
    const api_cmds = settings.get(net, 'api_cmds')
    const algos = settings.get(net, 'algos')
    
    if (shared_pages.show_hashrate == false)
      return cb('-')

    if (shared_pages.page_header.panels.network_panel.nethash == 'netmhashps') {
      const cmd = prepareRpcCommand(api_cmds.getmininginfo)
      if (!(cmd.method == '' && cmd.parameters.length == 0)) {
        if (api_cmds.use_rpc) {
          rpcCommand([{net:net, method:cmd.method, parameters: cmd.parameters}], function(response) {
            if (response == CHECK_YOUR_CONSOLE) {
              return cb('-')
            }

            const hashps = {}
            hashps.nethash = !isNaN(body.networkhashps) ? convertHashUnits(body.networkhashps, net) : -1

            algos.forEach((algo) => {
              if (!isNaN(response['networkhashps_' + algo.algo]))
                hashps['nethash_' + algo.algo] = response['networkhashps_' + algo.algo]
            })

            if (Object.keys(hashps).length > 0) {
              return cb(hashps)
            } else {
              return cb('-')
            }
          })
        } else {
          const uri = base_url + 'getmininginfo/' + net
          request({uri: uri, json: true}, function (error, response, body) {
            if (body == CHECK_YOUR_CONSOLE) {
              // return a blank value
              return cb('-')
            } else {
              const hashps = {}

              algos.forEach((algo) => {
                if (!isNaN(response['networkhashps_' + algo.algo]))
                  hashps['nethash_' + algo.algo] = response['networkhashps_' + algo.algo]
              })

              if (Object.keys(hashps).length > 0) {
                return cb(hashps)
              } else {
                return cb('-')
              }
            }
          })
        }
      } else {
        // getmininginfo cmd not set
        return cb('-')
      }
    } else if (shared_pages.page_header.panels.network_panel.nethash == 'getnetworkhashps') {
      // load getnetworkhashps rpc call from settings
      const cmd = prepareRpcCommand(api_cmds.getnetworkhashps)
      // check if the rpc cmd is valid
      if (!(cmd.method == '' && cmd.parameters.length == 0)) {
        // check if getting data from wallet rpc or web api request
        if (api_cmds.use_rpc) {
          // get data from wallet via rpc cmd
          rpcCommand([{net:net, method:cmd.method, parameters: cmd.parameters}], function(response) {
            // check if an error msg was received from the rpc server
            if (response == CHECK_YOUR_CONSOLE)
              return cb('-')
            // check if the response has a value
            if (response) {
              // return hash value with proper units
              return cb(convertHashUnits(response, net))
            } else {
              // response is blank/null
              return cb('-')
            }
          });
        } else {
          // get data via internal web api request
          var uri = base_url + 'getnetworkhashps/' + net
          request({uri: uri, json: true}, function (error, response, body) {
            // check if an error msg was received from the web api server
            if (body == CHECK_YOUR_CONSOLE) {
              // return a blank value
              return cb('-');
            } else {
              // return hash value with proper units
              return cb(convertHashUnits(body));
            }
          });
        }
      } else {
        // getnetworkhashps cmd not set
        return cb('-');
      }
    } else {
      // Invalid network hashrate setting value
      return cb('-');
    }
  },

  get_difficulty: function(net, cb) {
    net = settings.getNet(net)
    const api_cmds = settings.get(net, 'api_cmds')
    const algos = settings.get(net, 'algos')
    const cmd = prepareRpcCommand(api_cmds.getdifficulty)

    if (!(cmd.method == '' && cmd.parameters.length == 0)) {
      if (api_cmds.use_rpc) {
        rpcCommand([{net:net, method: 'getblockchaininfo', parameters: cmd.parameters}], function(response) {
          if (response == CHECK_YOUR_CONSOLE)
            return cb(null)
          else {
            const obj =  {}
            obj.height = !isNaN(response.blocks) ? response.blocks : -1
            obj.difficulty = !isNaN(response.difficulty) ? response.difficulty : -1

            algos.forEach((algo) => {
              if (!isNaN(response['difficulty_' + algo.algo]))
                obj['difficulty_' + algo.algo] = response['difficulty_' + algo.algo]
            })

            return cb(obj)
          }
        })
      } else {
        const uri = base_url + 'getdifficulty/' + net
        request({uri: uri, json: true}, function (error, response, body) {
          if (body == CHECK_YOUR_CONSOLE)
            return cb(null)
          else
            return cb(body)
        })
      }
    } else {
      // cmd not in use. return null.
      return cb(null)
    }
  },

  get_connectioncount: function(net, cb) {
    const api_cmds = settings.get(net, 'api_cmds')
    var cmd = prepareRpcCommand(api_cmds.getconnectioncount);

    if (!(cmd.method == '' && cmd.parameters.length == 0)) {
      if (api_cmds.use_rpc) {
        rpcCommand([{net:net, method:cmd.method, parameters: cmd.parameters}], function(response) {
          // check if an error msg was received from the rpc server
          if (response == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(response);
        });
      } else {
        var uri = base_url + 'getconnectioncount/' + net
        request({uri: uri, json: true}, function (error, response, body) {
          // check if an error msg was received from the web api server
          if (body == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(body);
        });
      }
    } else {
      // cmd not in use. return null.
      return cb(null);
    }
  },

  // only sync.js
  get_masternodelist: function(net, cb) {
    const api_cmds = settings.get(net, 'api_cmds')
    var cmd = prepareRpcCommand(api_cmds.getmasternodelist);

    if (!(cmd.method == '' && cmd.parameters.length == 0)) {
      if (api_cmds.use_rpc) {
        rpcCommand([{net: net, method:cmd.method, parameters: cmd.parameters}], function(response) {
          // check if an error msg was received from the rpc server
          if (response == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(response);
        });
      } else {
        var uri = base_url + 'getmasternodelist/' + net
        request({uri: uri, json: true}, function (error, response, body) {
          // check if an error msg was received from the web api server
          if (body == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(body);
        });
      }
    } else {
      // cmd not in use. return null.
      return cb(null);
    }
  },

  get_blockcount: function(cb, net=settings.getDefaultNet()) {
    const api_cmds = settings.get(net, 'api_cmds')
    var cmd = prepareRpcCommand(api_cmds.getblockcount);

    if (!(cmd.method == '' && cmd.parameters.length == 0)) {
      if (api_cmds.use_rpc) {
        rpcCommand([{net:net, method:cmd.method, parameters: cmd.parameters}], function(response) {
          // check if an error msg was received from the rpc server
          if (response == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(response);
        });
      } else {
        var uri = base_url + 'getblockcount/' + net
        request({uri: uri, json: true}, function (error, response, body) {
          // check if an error msg was received from the web api server
          if (body == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(body);
        });
      }
    } else {
      // cmd not in use. return null.
      return cb(null);
    }
  },

  get_blockhash: function(height, cb, net=settings.getDefaultNet()) {
    const api_cmds = settings.get(net, 'api_cmds')
    var cmd = prepareRpcCommand(api_cmds.getblockhash, (!isNaN(height) ? [parseInt(height)] : []));

    if (!(cmd.method == '' && cmd.parameters.length == 0)) {
      if (api_cmds.use_rpc) {
        rpcCommand([{net:net, method:cmd.method, parameters: cmd.parameters}], function(response) {
          // check if an error msg was received from the rpc server
          if (response == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(response);
        });
      } else {
        var uri = base_url + 'getblockhash/' + net + '?height=' + (height ? height : '');
        request({uri: uri, json: true}, function (error, response, body) {
          // check if an error msg was received from the web api server
          if (body == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(body);
        });
      }
    } else {
      // cmd not in use. return null.
      return cb(null);
    }
  },

  get_block: function(hash, cb, net=settings.getDefaultNet()) {
    const api_cmds = settings.get(net, 'api_cmds')
    var cmd = prepareRpcCommand(api_cmds.getblock, (hash ? [hash] : []));

    if (!(cmd.method == '' && cmd.parameters.length == 0)) {
      if (api_cmds.use_rpc) {
        rpcCommand([{net:net, method:cmd.method, parameters: cmd.parameters}], function(response) {
          // check if an error msg was received from the rpc server
          if (response == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(response);
        });
      } else {
        var uri = base_url + 'getblock/' + net + '?hash=' + hash;
        request({uri: uri, json: true}, function (error, response, body) {
          // check if an error msg was received from the web api server
          if (body == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(body);
        });
      }
    } else {
      // cmd not in use. return null.
      return cb(null);
    }
  },

  get_rawtransaction: function(hash, cb, net=settings.getDefaultNet()) {
    const api_cmds = settings.get(net, 'api_cmds')
    var cmd = prepareRpcCommand(api_cmds.getrawtransaction, (hash ? [hash, 1] : []));

    if (!(cmd.method == '' && cmd.parameters.length == 0)) {
      if (api_cmds.use_rpc) {
        rpcCommand([{net:net, method:cmd.method, parameters: cmd.parameters}], function(response) {
          // check if an error msg was received from the rpc server
          if (response == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(response);
        });
      } else {
        var uri = base_url + 'getrawtransaction/' + net + '?txid=' + hash + '&decrypt=1';
        request({uri: uri, json: true}, function (error, response, body) {
          // check if an error msg was received from the web api server
          if (body == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(body);
        });
      }
    } else {
      // cmd not in use. return null.
      return cb(null);
    }
  },

  // only used by heavy
  get_maxmoney: function(cb, net=settings.getDefaultNet()) {
    var cmd = prepareRpcCommand(settings.blockchain_specific.heavycoin.api_cmds.getmaxmoney);
    const api_cmds = settings.get(net, 'api_cmds')

    if (!(cmd.method == '' && cmd.parameters.length == 0)) {
      if (api_cmds.use_rpc) {
        rpcCommand([{net:net, method:cmd.method, parameters: cmd.parameters}], function(response) {
          // check if an error msg was received from the rpc server
          if (response == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(response);
        });
      } else {
        var uri = base_url + 'getmaxmoney/' + net;
        request({uri: uri, json: true}, function (error, response, body) {
          // check if an error msg was received from the web api server
          if (body == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(body);
        });
      }
    } else {
      // cmd not in use. return null.
      return cb(null);
    }
  },

  get_maxvote: function(cb, net=settings.getDefaultNet()) {
    var cmd = prepareRpcCommand(settings.blockchain_specific.heavycoin.api_cmds.getmaxvote);
    const api_cmds = settings.get(net, 'api_cmds')

    if (!(cmd.method == '' && cmd.parameters.length == 0)) {
      if (api_cmds.use_rpc) {
        rpcCommand([{net:net, method:cmd.method, parameters: cmd.parameters}], function(response) {
          // check if an error msg was received from the rpc server
          if (response == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(response);
        });
      } else {
        var uri = base_url + 'getmaxvote/' + net
        request({uri: uri, json: true}, function (error, response, body) {
          // check if an error msg was received from the web api server
          if (body == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(body);
        });
      }
    } else {
      // cmd not in use. return null.
      return cb(null);
    }
  },

  get_vote: function(cb, net=settings.getDefaultNet()) {
    var cmd = prepareRpcCommand(settings.blockchain_specific.heavycoin.api_cmds.getvote);
    const api_cmds = settings.get(net, 'api_cmds')

    if (!(cmd.method == '' && cmd.parameters.length == 0)) {
      if (api_cmds.use_rpc) {
        rpcCommand([{net:net, method:cmd.method, parameters: cmd.parameters}], function(response) {
          // check if an error msg was received from the rpc server
          if (response == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(response);
        });
      } else {
        var uri = base_url + 'getvote/' + net
        request({uri: uri, json: true}, function (error, response, body) {
          // check if an error msg was received from the web api server
          if (body == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(body);
        });
      }
    } else {
      // cmd not in use. return null.
      return cb(null);
    }
  },

  get_phase: function(cb, net=settings.getDefaultNet()) {
    var cmd = prepareRpcCommand(settings.blockchain_specific.heavycoin.api_cmds.getphase);
    const api_cmds = settings.get(net, 'api_cmds')

    if (!(cmd.method == '' && cmd.parameters.length == 0)) {
      if (api_cmds.use_rpc) {
        rpcCommand([{net:net, method:cmd.method, parameters: cmd.parameters}], function(response) {
          // check if an error msg was received from the rpc server
          if (response == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(response);
        });
      } else {
        var uri = base_url + 'getphase/' + net
        request({uri: uri, json: true}, function (error, response, body) {
          // check if an error msg was received from the web api server
          if (body == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(body);
        });
      }
    } else {
      // cmd not in use. return null.
      return cb(null);
    }
  },

  get_reward: function(cb, net=settings.getDefaultNet()) {
    var cmd = prepareRpcCommand(settings.blockchain_specific.heavycoin.api_cmds.getreward);
    const api_cmds = settings.get(net, 'api_cmds')

    if (!(cmd.method == '' && cmd.parameters.length == 0)) {
      if (api_cmds.use_rpc) {
        rpcCommand([{net:net, method:cmd.method, parameters: cmd.parameters}], function(response) {
          // check if an error msg was received from the rpc server
          if (response == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(response);
        });
      } else {
        var uri = base_url + 'getreward/' + net
        request({uri: uri, json: true}, function (error, response, body) {
          // check if an error msg was received from the web api server
          if (body == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(body);
        });
      }
    } else {
      // cmd not in use. return null.
      return cb(null);
    }
  },

  get_estnext: function(cb, net=settings.getDefaultNet()) {
    var cmd = prepareRpcCommand(settings.blockchain_specific.heavycoin.api_cmds.getnextrewardestimate);
    const api_cmds = settings.get(net, 'api_cmds')

    if (!(cmd.method == '' && cmd.parameters.length == 0)) {
      if (api_cmds.use_rpc) {
        rpcCommand([{net:net, method:cmd.method, parameters: cmd.parameters}], function(response) {
          // check if an error msg was received from the rpc server
          if (response == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(response);
        });
      } else {
        var uri = base_url + 'getnextrewardestimate/' + net
        request({uri: uri, json: true}, function (error, response, body) {
          // check if an error msg was received from the web api server
          if (body == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(body);
        });
      }
    } else {
      // cmd not in use. return null.
      return cb(null);
    }
  },

  get_nextin: function(cb, net=settings.getDefaultNet()) {
    var cmd = prepareRpcCommand(settings.blockchain_specific.heavycoin.api_cmds.getnextrewardwhenstr);
    const api_cmds = settings.get(net, 'api_cmds')

    if (!(cmd.method == '' && cmd.parameters.length == 0)) {
      if (api_cmds.use_rpc) {
        rpcCommand([{net:net, method:cmd.method, parameters: cmd.parameters}], function(response) {
          // check if an error msg was received from the rpc server
          if (response == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(response);
        });
      } else {
        var uri = base_url + 'getnextrewardwhenstr/' + net
        request({uri: uri, json: true}, function (error, response, body) {
          // check if an error msg was received from the web api server
          if (body == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(body);
        });
      }
    } else {
      // cmd not in use. return null.
      return cb(null);
    }
  },

  get_descriptorinfo: function(descriptor, cb, net=settings.getDefaultNet()) {
    // format the descriptor correctly for use in the getdescriptorinfo cmd
    descriptor = 'pkh(' + descriptor.replace(' OP_CHECKSIG', '') + ')';

    var cmd = prepareRpcCommand(settings.blockchain_specific.bitcoin.api_cmds.getdescriptorinfo, (descriptor ? [descriptor] : []));
    const api_cmds = settings.get(net, 'api_cmds')

    if (!(cmd.method == '' && cmd.parameters.length == 0)) {
      if (api_cmds.use_rpc) {
        rpcCommand([{net:net, method:cmd.method, parameters: cmd.parameters}], function(response) {
          // check if an error msg was received from the rpc server
          if (response == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(response);
        });
      } else {
        var uri = base_url + 'getdescriptorinfo/' + net + '?descriptor=' + encodeURIComponent(descriptor);
        request({uri: uri, json: true}, function (error, response, body) {
          // check if an error msg was received from the web api server
          if (body == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(body);
        });
      }
    } else {
      // cmd not in use. return null.
      return cb(null);
    }
  },

  get_deriveaddresses: function(descriptor, cb, net=settings.getDefaultNet()) {
    var cmd = prepareRpcCommand(settings.blockchain_specific.bitcoin.api_cmds.deriveaddresses, (descriptor ? [descriptor] : []));
    const api_cmds = settings.get(net, 'api_cmds')

    if (!(cmd.method == '' && cmd.parameters.length == 0)) {
      if (api_cmds.use_rpc) {
        rpcCommand([{net:net, method:cmd.method, parameters: cmd.parameters}], function(response) {
          // check if an error msg was received from the rpc server
          if (response == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(response);
        });
      } else {
        var uri = base_url + 'deriveaddresses/' + net + '?descriptor=' + encodeURIComponent(descriptor);
        request({uri: uri, json: true}, function (error, response, body) {
          // check if an error msg was received from the web api server
          if (body == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(body);
        });
      }
    } else {
      // cmd not in use. return null.
      return cb(null);
    }
  },

  // synchonous loop used to interate through an array,
  // avoid use unless absolutely neccessary
  syncLoop: function(iterations, process, exit) {
    var index = 0,
        done = false,
        shouldExit = false;

    var loop = {
      next: function() {
        if (done) {
          if (shouldExit && exit) {
            // exit if we're done
            exit();
          }

          // stop the loop if we're done
          return;
        }

        // if we're not finished
        if (index < iterations) {
          // increment our index
          index++;

          if (index % 100 === 0) {
            // clear stack
            setTimeout(function() {
              // run our process, pass in the loop
              process(loop);
            }, 1);
          } else {
            // run our process, pass in the loop
            process(loop);
          }
        } else {
          // otherwise we're done
          // make sure we say we're done
          done = true;

          if (exit) {
            // call the callback on exit
            exit();
          }
        }
      },
      iteration: function() {
        // return the loop number we're on
        return index - 1;
      },
      break: function(end) {
        // end the loop
        done = true;
        // passing end as true means we still call the exit callback
        shouldExit = end;
      }
    };

    loop.next();

    return loop;
  },

  balance_supply: function(cb, net=settings.getDefaultNet()) {
    AddressDb[net].find({}, 'balance').where('balance').gt(0).exec().then((docs) => {
      var count = 0;
      module.exports.syncLoop(docs.length, function (loop) {
        var i = loop.iteration();

        count = count + docs[i].balance;
        loop.next();
      }, function() {
        return cb(count);
      });
    }).catch((err) => {
      console.error("Failed to find address balances for chain '%s': %s", net, err)
      return cb(0);
    });
  },
  
  get_txoutsetinfo: function(net=settings.getDefaultNet(), cb) {
    const uri = base_url + 'gettxoutsetinfo/' + net
    request({uri: uri, json: true}, function (error, response, body) {
      if (!body || !body.total_amount || body == CHECK_YOUR_CONSOLE)
        return cb(null)
      else
        return cb(body)
    })
  },

  get_blockchaininfo: function(net=settings.getDefaultNet(), cb) {
    const api_cmds = settings.get(net, 'api_cmds')
    var cmd = prepareRpcCommand(api_cmds.getblockchaininfo)

    if (!(cmd.method == '' && cmd.parameters.length == 0)) {
      if (api_cmds.use_rpc) {
        rpcCommand([{net: net, method:cmd.method, parameters: cmd.parameters}], function(response) {
          if (response == CHECK_YOUR_CONSOLE)
            return cb(null)
          else
            return cb(response)
        })
      } else {
        var uri = base_url + 'getblockchaininfo/' + net
        request({uri: uri, json: true}, function (error, response, body) {
          if (body == CHECK_YOUR_CONSOLE)
            return cb(null)
          else
            return cb(body)
        });
      }
    } else {
      // cmd not in use. return null.
      return cb(null)
    }
  },

  get_peerinfo: function(net=settings.getDefaultNet(), cb) {
    const api_cmds = settings.get(net, 'api_cmds')
    var cmd = prepareRpcCommand(api_cmds.getpeerinfo);

    if (!(cmd.method == '' && cmd.parameters.length == 0)) {
      if (api_cmds.use_rpc) {
        rpcCommand([{net: net, method:cmd.method, parameters: cmd.parameters}], function(response) {
          // check if an error msg was received from the rpc server
          if (response == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(response);
        });
      } else {
        var uri = base_url + 'getpeerinfo/' + net
        request({uri: uri, json: true}, function (error, response, body) {
          // check if an error msg was received from the web api server
          if (body == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(body);
        });
      }
    } else {
      // cmd not in use. return null.
      return cb(null);
    }
  },

  verify_message: function(net=settings.getDefaultNet(), address, signature, message, cb) {
    const api_cmds = settings.get(net, 'api_cmds')
    var cmd = prepareRpcCommand(api_cmds.verifymessage, [address, signature, message]);

    if (!(cmd.method == '' && cmd.parameters.length == 0)) {
      if (api_cmds.use_rpc) {
        rpcCommand([{net:net, method:cmd.method, parameters: cmd.parameters}], function(response) {
          // check if an error msg was received from the rpc server
          if (response == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(response);
        });
      } else {
        var uri = base_url + 'verifymessage/' + net + '?address=' + address + '&signature=' + signature + '&message=' + message;
        request({uri: uri, json: true}, function (error, response, body) {
          // check if an error msg was received from the web api server
          if (body == CHECK_YOUR_CONSOLE)
            return cb(null);
          else
            return cb(body);
        });
      }
    } else {
      // cmd not in use. return null.
      return cb(null);
    }
  },

  validate_address: function(net=settings.getDefaultNet(), address, cb) {
    const api_cmds = settings.get(net, 'api_cmds')
    const cmd = prepareRpcCommand(api_cmds.validateaddress, [address])

    if (!(cmd.method == '' && cmd.parameters.length == 0)) {
      if (api_cmds.use_rpc) {
        rpcCommand([{net:net, method:cmd.method, parameters: cmd.parameters}], function(response) {
          if (response == 'Unexpected error.')
            return cb(null)
          else
            return cb(response)
        })
      } else {
        const uri = base_url + 'validateaddress/' + net + '?address=' + address
        request({uri: uri, json: true}, function (error, response, body) {
          if (body == 'Unexpected error.')
            return cb(null)
          else
            return cb(body)
        })
      }
    } else {
      // cmd not in use. return null.
      return cb(null)
    }
  },

  get_geo_location: function(address, cb) {
    request({uri: 'https://reallyfreegeoip.org/json/' + address, json: true}, function (error, response, geo) {
      return cb(error, geo)
    })
  },

  get_exchange_rates: function(cb) {
    request({uri: 'https://api.exchangerate.host/latest?base=USD', json: true}, function (error, response, data) {
      return cb(error, data)
    })
  },

  create_lock: function(lock, net=settings.getDefaultNet()) {
    const fs = require('fs')
    const fname = './tmp/' + net + '-' + lock + '.pid'
    try {
      const pid = process.pid.toString();
      fs.appendFileSync(fname, pid)
      if (debug.enabled)
        debug("Created lock '%s' for PID '%s'", fname, pid)
      return true
    } catch(err) {
      console.log("Error: Unable to create lock: %s", fname)
      return false
    }
  },

  remove_lock: function(lock, net=settings.getDefaultNet()) {
    const fs = require('fs')
    const fname = './tmp/' + net + '-' + lock + '.pid'
    try {
      fs.unlinkSync(fname)
      if (debug.enabled)
        debug("Removed lock '%s'.", fname)
      return true
    } catch(err) {
      console.log("Error: Unable to remove lock: %s", fname)
      return false
    }
  },

  is_locked: function(lock_array, net=settings.getDefaultNet()) {
    const fs = require('fs')
    const path = require('path')
    var retVal = false

    // loop through all lock files that need to be checked
    for (var i = 0; i < lock_array.length; i++) {
      const pidFile = path.join(path.dirname(__dirname), 'tmp', net + '-' + `${lock_array[i]}.pid`)
      // check if the script is already running (tmp/file.pid file already exists)
      const exists = fs.existsSync(pidFile)
      if (debug.enabled)
        debug("Lock '%s' exists -> %s", pidFile, exists)
      if (exists) {
        const { execSync } = require('child_process')
        var deactivateLock = false

        // the pid file exists
        // determine the operating system
        switch (process.platform) {
          case 'win32':
            // windows
            // run a cmd that will determine if the lock should still be active
            var cmdResult = execSync(`tasklist /FI "PID eq ${fs.readFileSync(pidFile).toString()}"`)

            // check if the process that created the lock is actually still running (crude check by testing for # of carriage returns or node.exe process running, but should work universally across different systems and languages)
            if (cmdResult.toString().split('\n').length < 4 || cmdResult.toString().toLowerCase().indexOf('\nnode.exe') == -1) {
              // lock should be deactivated
              deactivateLock = true
            }

            break;
          default:
            // linux or other
            // run a cmd that will determine if the lock should still be active

            try {
              var cmdResult = execSync('ps -p `cat "' + pidFile + '"` > /dev/null')
            } catch (err) {
              // if an error occurs, the process is NOT running and therefore the lock should be deactivated
              deactivateLock = true
            }
        }

        // check if the lock should be deactivated
        if (deactivateLock) {
          // script is not actually running so the lock file can be deleted
          try {
            fs.rmSync(pidFile)
            console.log("Lock '%s' deactivated.", pidFile)
          } catch(err) {
            console.log(`Failed to delete lock file ${pidFile}: ${err}`)
          }
        } else {
          // script is running
          if (debug.enabled)
            debug(`${lock_array[i]} script is running..`)

          retVal = true
          break
        }
      }
    }

    return retVal
  }
}