const debug = require('debug')('debug')
const onode = require('./node')
const express = require('express')
const settings = require('./settings')
const TTLCache = require('@isaacs/ttlcache')

// RPC cache
const wlength = settings.wallets.length
const rpcCache = new TTLCache({ max: 100, ttl: settings.cache.difficulty * 1000, updateAgeOnGet: false, noUpdateTTL: false })

module.exports = function() {
  function express_app() {
    var app = express();

    // All /api/* requests.
    app.get('*/:net?', hasAccess, function(req, res) {
      var method = req.path.substring(1, req.path.length);
      var net = app.get('default_wallet');
      
      // TODO: Fix. Could be other param as well!
      if (method.indexOf('/') > -1)
        net = method.substring(method.lastIndexOf('/') + 1, method.length);

      if (method.indexOf('/') > -1) {
        method = method.substring(0, method.indexOf('/'));
      }

      debug("Call method '%s', net '%s', params '%o'", method, net, req.params);      
      const client = getClient(net);
      var query_parameters = req.query;
      var params = [];

      for (var parameter in query_parameters) {
        if (query_parameters.hasOwnProperty(parameter)) {
          var param = query_parameters[parameter];

          if (!isNaN(param))
            param = parseFloat(param);

          params.push(param);
        }
      }

      var command = [];

      switch (method) {
        case 'getnetworkhashps':
        case 'getmininginfo':
        case 'getdifficulty':
        case 'getconnectioncount':
        case 'getblockcount':
        case 'getblockhash':
        case 'getblock':
        case 'getrawtransaction':
        case 'getsupply':
        case 'getinfo':
        case 'getblockchaininfo':
        case 'getpeerinfo':
        case 'gettxoutsetinfo':
        case 'getmaxmoney':
        case 'getmaxvote':
        case 'getvote':
        case 'getphase':
        case 'getreward':
        case 'getnextrewardestimate':
        case 'getnextrewardwhenstr':
        case 'getvotelist':
        case 'getmasternodecount':
        case 'getmasternodelist':
        case 'verifymessage':
        case 'sendmany':
          command = specialApiCase(method, net, query_parameters);
          break;
        default:
          command = [{
            method: method,
            params: params
          }];

          break;
      }

      if (settings.cache.enabled) {
        const paramString = Object.keys(query_parameters).map(key => key+"="+query_parameters[key]).join("&")
        const r = rpcCache.get(net + '-' + method + '-' + paramString)
        if (r == undefined) {
          client.cmd(command, function(err, response) {
            if (err) {
              console.log(err)
              res.send("There was an error. Check your console.")
            } else {
              if (typeof response === 'object') {
                if (method == 'getdifficulty') {
                  const algos = settings.get(net, 'algos')
                  const obj = {}
                  obj.height = !isNaN(response.blocks) ? response.blocks : -1
                  obj.difficulty = !isNaN(response.difficulty) ? response.difficulty : -1
                  
                  algos.forEach((algo) => {
                    if (!isNaN(response['difficulty_' + algo.algo]))
                      obj['difficulty_' + algo.algo] = response['difficulty_' + algo.algo]
                  })

                  rpcCache.set(net + '-' + method + '-' + paramString, obj)
                  debug("Cached '%s' '%s' %o - mem: %o", method, net, obj, process.memoryUsage())
                  res.json(obj)
                } else {
                  rpcCache.set(net + '-' + method + '-' + paramString, response)
                  debug("Cached '%s' '%s' %o - mem: %o", method, net, response, process.memoryUsage())
                  res.json(response)
                }
              } else {
                res.setHeader('content-type', 'text/plain')
                rpcCache.set(net + '-' + method + '-' + paramString, response.toString())
                debug("Cached '%s' '%s' %o - mem: %o", method, net, response, process.memoryUsage())
                res.end(response.toString())
              }
            }
          })
        } else {
          debug("Get '%s' by cache '%s' %o ...", method, net, r)
          if (typeof r === 'object') {
            res.json(r)
          } else {
            res.end(r)
          }
        }
      } else {
        client.cmd(command, function(err, response) {
          if (err) {
            console.log(err)
            res.send("There was an error. Check your console.")
          } else {
            if (typeof response === 'object') {
              if (method == 'getdifficulty') {
                const algos = settings.get(net, 'algos')
                const obj =  {};
                obj.height = !isNaN(response.blocks) ? response.blocks : -1
                obj.difficulty = !isNaN(response.difficulty) ? response.difficulty : -1

                algos.forEach((algo) => {
                  if (!isNaN(response['difficulty_' + algo.algo]))
                    obj['difficulty_' + algo.algo] = response['difficulty_' + algo.algo]
                })

                res.json(obj)
              } else {
                res.json(response)
              }
            } else {
              res.setHeader('content-type', 'text/plain')
              res.end(response.toString())
            }
          }
        })
      }
    })

    function hasAccess(req, res, next) {
      var method = req.path.substring(1, req.path.length);
      var net = app.get('default_wallet')

      // TODO: Fix. Could be other param as well!
      if (method.indexOf('/') > -1) {
        net = method.substring(method.lastIndexOf('/') + 1, method.length)
        method = method.substring(0, method.indexOf('/'))
      }
      var method_enabled = false;

      // check if this is a "normal" api method
      if (settings.api_page.public_apis.rpc[method] != null) {
        // check the enabled property of this normal method
        method_enabled = settings.api_page.public_apis.rpc[method].enabled;
      } else if (settings.api_page.public_apis.ext[method] != null) {
        // check the enabled property of this normal method
        method_enabled = settings.api_page.public_apis.ext[method].enabled;
      } else {
        // look for this method in the list of blockchain specific features
        Object.keys(settings.blockchain_specific).forEach(function(key, index, map) {
          // check if this feature is enabled and has a definition for this api cmd
          if (settings.blockchain_specific[key].enabled == true && settings.blockchain_specific[key]['public_apis'] != null && settings.blockchain_specific[key]['public_apis'][method] != null) {
            // check the enabled properly of this blockchain specific method
            method_enabled = settings.blockchain_specific[key]['public_apis'][method].enabled;
          }
        });
      }

      // only show disabled msg for outside calls. internal calls should always go through
      const shared_pages = settings.get(net, 'shared_pages')
      if ((!settings.api_page.enabled || method_enabled == null || !method_enabled) && req.headers.host.indexOf('127.0.0.1') == -1)
        res.end('This method is disabled');
      else if (method == 'getnetworkhashps' && !shared_pages.show_hashrate) {
        // getnetworkhashps requires show_hashrate to be enabled or else hashrate cannot be returned
        res.end('-');
      } else {
        // TODO: Tmp. allow all.
        return next();
        // if (accesslist.type == 'all')
        //   return next();

        // if ('undefined' == typeof accesslist[method]) {
        //   if (accesslist.type == 'only')
        //     res.end('This method is restricted');
        //   else
        //     return next();
        // } else {
        //   if (accesslist[method] == true) {
        //     console.log("Access granted for API method %s'.", method);
        //     return next();
        //   } else
        //     res.end('This method is restricted');
        // }
      }
    }

    function prepareRpcCommand(cmd, addParams) {
      var method_name = '';
      var params = addParams || [];

      // Check for null/blank string
      if (cmd != null && cmd.trim() != '') {
        // Split cmd by spaces
        var split = cmd.split(' ');

        for (i=0; i<split.length; i++) {
          if (i==0)
            method_name = split[i];
          else
            params.push(split[i]);
        }
      }

      return { method: method_name, parameters: params };
    }

    function specialApiCase(method_name, net=settings.getDefaultNet(), query_parameters) {
      var params = [];
      switch (method_name) {
        case 'getnetworkhashps':
          var cmd = prepareRpcCommand(settings.isButkoin(net) ? 'getallnetworkhashps' : 'getnetworkhashps');
          method_name = cmd.method;
          params = cmd.parameters;
          break;
        case 'getmininginfo':
          var cmd = prepareRpcCommand('getmininginfo')
          method_name = cmd.method
          params = cmd.parameters
          break;
        case 'getdifficulty':
          // settings.api_cmds[method_name]
          var cmd = prepareRpcCommand('getblockchaininfo');

          method_name = cmd.method;
          params = cmd.parameters;

          break;
        case 'getconnectioncount':
        case 'getblockcount':
        case 'getinfo':
        case 'getblockchaininfo':
        case 'getpeerinfo':
        case 'gettxoutsetinfo':
        case 'getvotelist':
        case 'getmasternodecount':
        case 'getmasternodelist':
          var cmd = prepareRpcCommand(settings.api_cmds[method_name]);

          method_name = cmd.method;
          params = cmd.parameters;

          break;
        case 'getmaxmoney':
        case 'getmaxvote':
        case 'getvote':
        case 'getphase':
        case 'getreward':
        case 'getnextrewardestimate':
        case 'getnextrewardwhenstr':
        case 'getsupply':
          var cmd = prepareRpcCommand(settings.blockchain_specific.heavycoin.api_cmds[method_name]);

          method_name = cmd.method;
          params = cmd.parameters;

          break;
        case 'getblockhash':
          for (var parameter in query_parameters) {
            if (query_parameters.hasOwnProperty(parameter) && (parameter == 'height' || parameter == 'index'))
              params.push(parseInt(query_parameters[parameter]));
          }

          var cmd = prepareRpcCommand(settings.api_cmds.getblockhash, params);

          method_name = cmd.method;
          params = cmd.parameters;

          break;
        case 'getblock':
          for (var parameter in query_parameters) {
            if (query_parameters.hasOwnProperty(parameter) && parameter == 'hash')
              params.push(query_parameters[parameter]);
          }

          var cmd = prepareRpcCommand(settings.api_cmds.getblock, params);
          
          method_name = cmd.method;
          params = cmd.parameters;

          break;
        case 'getrawtransaction':
          for (var parameter in query_parameters) {
            if (query_parameters.hasOwnProperty(parameter)) {
              if (parameter == 'txid')
                params.push(query_parameters[parameter]);
              else if (parameter == 'decrypt')
                params.push(parseInt(query_parameters[parameter]));
            }
          }

          var cmd = prepareRpcCommand(settings.api_cmds.getrawtransaction, params);

          method_name = cmd.method;
          params = cmd.parameters;

          break;
        case 'verifymessage':
          for (var parameter in query_parameters) {
            if (query_parameters.hasOwnProperty(parameter)) {
              if (parameter == 'address' || parameter == 'message')
                params.push(query_parameters[parameter]);
              if (parameter == 'signature') {
                var param = decodeURIComponent(query_parameters[parameter]);
                while (param.indexOf(" ") > -1)
                  param = param.replace(" ", "+");
                params.push(param);
              }
            }
          }

          var cmd = prepareRpcCommand(settings.api_cmds.verifymessage, params);

          method_name = cmd.method;
          params = cmd.parameters;

          break;
        case 'sendmany':
          var after_account = false;
          var before_min_conf = true;
          var address_info = {};

          for (var parameter in query_parameters) {
            if (query_parameters.hasOwnProperty(parameter)) {
              if (parameter == 'minconf') {
                before_min_conf = false;
                params.push(address_info);
              }

              var param = query_parameters[parameter];

              if (!isNaN(param))
                param = parseFloat(param);

              if (after_account && before_min_conf)
                address_info[parameter] = param;
              else
                params.push(param);

              if (parameter == 'account')
                after_account = true;
            }
          }

          if (before_min_conf)
            params.push(address_info);

          break;
      }

      return [{
        method: method_name,
        params: params
      }];
    }

    return app;
  };

  var accesslist = {};
  var clients = [];
  var wallet_passphrase = null;
  var requires_passphrase = {
    'dumpprivkey': true,
    'importprivkey': true,
    'keypoolrefill': true,
    'sendfrom': true,
    'sendmany': true,
    'sendtoaddress': true,
    'signmessage': true,
    'signrawtransaction': true
  };

  accesslist.type = 'all';

  function setAccess(type, access_list) {
    // reset
    accesslist = {};
    accesslist.type = type;

    if (type == "only") {
      for (i = 0; i < access_list.length; i++)
        accesslist[access_list[i]] = true;
    }

    if (type == "restrict") {
      for (i = 0; i < access_list.length; i++)
        accesslist[access_list[i]] = false;
    }

    // default is for security reasons. Prevents accidental theft of coins/attack
    if (type == 'default-safe') {
      var restrict_list = ['dumpprivkey', 'walletpassphrasechange', 'stop'];

      accesslist.type = 'restrict';

      for (i = 0; i < restrict_list.length; i++)
        accesslist[restrict_list[i]] = false;
    }

    if (type == 'read-only') {
      var restrict_list = ['addmultisigaddress', 'addnode', 'backupwallet', 'createmultisig', 'createrawtransaction', 'encryptwallet', 'importprivkey', 'keypoolrefill', 'lockunspent', 'move', 'sendfrom', 'sendmany', 'sendrawtransaction', 'sendtoaddress', 'setaccount', 'setgenerate', 'settxfee', 'signmessage', 'signrawtransaction', 'stop', 'submitblock', 'walletlock', 'walletpassphrasechange'];

      accesslist.type = 'restrict';

      for (i = 0; i < restrict_list.length; i++)
        accesslist[restrict_list[i]] = false;
    }
  };

  function setWalletDetails(details) {
    for (let i = 0; i < details.length; i++) {
      clients[i] = new onode.Client(details[i]);
      if (details[i].wallet_password) {
        clients[i].setWalletPassphrase(details[i].wallet_password, 10)
      }
    }
  };

  function setWalletPassphrase(passphrase) {
    wallet_passphrase = passphrase;
  };

  function getClient(net=settings.getDefaultNet()) {
    var r;
    for (let i = 0; i < clients.length; i++) {
      if (clients[i].rpc.opts.id == net) {
        debug("Found wallet '%s'.", net)  
        r = clients[i];
        break;
      }
    }
    if (r == null)
      console.error("Failed to find wallet '%s'", net)
    return r;
  };

  return {
    app: express_app(),
    setAccess: setAccess,
    setWalletDetails: setWalletDetails,
    setWalletPassphrase: setWalletPassphrase
  }
}();