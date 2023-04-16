/**
 * Benchmarks the system.
 *
 * !!!
 * 
 * Deletes all TX and addresses in he database, and restores it 
 * for the given number of blocks by the deamon starting at height 0.
 * 
 * Usage:
 * 
 * node scripts/benchmark.js [net] [blocks]
 * 
 * [net] = chain, default 'testnet' or settings.dbs[1].
 * [blocks] = number of blocks, default 5000.
 */
var mongoose = require('mongoose'),
    settings = require('../lib/settings'),
    lib = require('../lib/explorer'),
    async = require('async'),
    instance = require('../bin/instance'),
    db = require('../lib/database');

const { StatsDb, AddressDb, AddressTxDb, TxDb, RichlistDb } = require('../lib/database');

var net = settings.dbs[1].id
if (process.argv[2] != null && process.argv[2] != '') {
  net = settings.getNetOrNull(process.argv[2])
  console.log("Use chain %s", net)
}
if (net == null) {
  console.error("Chain '%s' not found. Exit.", process.argv[2])
  exit(999)
}

var numberOfBlocks = 5000;
if (process.argv[3] != null && process.argv[3] != '') {
  numberOfBlocks = parseInt(process.argv[3])
  console.log("Use number of blocks %d", numberOfBlocks)
}

function exit(exitCode) {
  mongoose.disconnect();
  process.exit(exitCode);
}

TxDb[net].deleteMany({}, function(err) {
  AddressDb[net].deleteMany({}, function(err2) {
    var s_timer = new Date().getTime();

    // updates tx, address & richlist db's
    function update_tx_db(coin, start, end, txes, timeout, check_only, cb) {
      var complete = false;
      var blocks_to_scan = [];
      var task_limit_blocks = settings.sync.block_parallel_tasks;
      var task_limit_txs = 1;

      // fix for invalid block height (skip genesis block as it should not have valid txs)
      if (typeof start === 'undefined' || start < 1)
        start = 1;

      if (task_limit_blocks < 1)
        task_limit_blocks = 1;

      for (i = start; i < (end + 1); i++)
        blocks_to_scan.push(i);

      async.eachLimit(blocks_to_scan, task_limit_blocks, function(block_height, next_block) {
        if (!check_only && block_height % settings.sync.save_stats_after_sync_blocks === 0) {
          StatsDb[net].updateOne({coin: coin}, {
            last: block_height - 1,
            txes: txes
          }, function() {});
        } else if (check_only) {
          console.log('Checking block ' + block_height + '...');
        }

        lib.get_blockhash(block_height, function(blockhash) {
          if (blockhash) {
            lib.get_block(blockhash, function(block) {
              if (block) {
                async.eachLimit(block.tx, task_limit_txs, function(txid, next_tx) {
                  TxDb[net].findOne({txid: txid}, function(err, tx) {
                    if (tx) {
                      setTimeout( function() {
                        tx = null;
                        next_tx();
                      }, timeout);
                    } else {
                      db.save_tx(net, txid, block_height, function(err, tx_has_vout) {
                        if (err)
                          console.log(err);
                        else
                          console.log('%s: %s', block_height, txid);

                        if (tx_has_vout)
                          txes++;

                        setTimeout( function() {
                          tx = null;
                          next_tx();
                        }, timeout);
                      });
                    }
                  });
                }, function() {
                  setTimeout( function() {
                    blockhash = null;
                    block = null;
                    next_block();
                  }, timeout);
                });
              } else {
                console.log('Block not found: %s', blockhash);

                setTimeout( function() {
                  next_block();
                }, timeout);
              }
            }, net);
          } else {
            setTimeout( function() {
              next_block();
            }, timeout);
          }
        }, net);
      }, function() {
        StatsDb[net].updateOne({coin: coin}, {
          last: end,
          txes: txes
        }, function() {
          return cb();
        });
      });
    }

    update_tx_db(settings.coin.name, 1, numberOfBlocks, 0, settings.sync.update_timeout, false, function() {
      var e_timer = new Date().getTime();

      TxDb[net].countDocuments({}, function(txerr, txcount) {
        AddressDb[net].countDocuments({}, function(aerr, acount) {
          var stats = {
            tx_count: txcount,
            address_count: acount,
            seconds: (e_timer - s_timer)/1000,
          };

          console.log(stats);
          exit(0);
        });
      });
    });
  });
});