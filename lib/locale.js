/**
* The Locale Module reads the locale settings and provides
* this information to the other modules
*/

const fs = require("fs")
const jsonminify = require("jsonminify")
const settings = require("./settings")

exports.menu_explorer = "X",
exports.menu_assets = "Assets",
exports.menu_info = "Info",
exports.menu_api = "API",
exports.menu_markets = "Markets",
exports.menu_masternodes = "Masternodes",
exports.menu_richlist = "Rich List",
exports.menu_reward = "Reward",
exports.menu_movement = "Movement",
exports.menu_node = "Nodes",
exports.menu_network = "Network",
exports.menu_claim_address = "Claim Address",
exports.menu_register = "Register",
exports.menu_login = "Login",
exports.menu_user = "User",

exports.ex_title = "{1} X",
exports.ex_description = "A listing of all verified {1} transactions",
exports.ex_search_title = "Search",
exports.ex_search_button = "Search",
exports.ex_search_message = "Search by block height, block hash, tx hash or address",
exports.ex_error = "Error!",
exports.ex_warning = "Warning",
exports.ex_search_error = "Search found no results.",
exports.ex_latest_transactions = "Latest Transactions",
exports.ex_summary = "Block Summary",
exports.ex_supply = "Supply",
exports.ex_block = "Block",

exports.tx_title = "{1} Tx Details",
exports.tx_description = "Viewing tx data from {1} block # {2}",
exports.tx_block_hash = "Block Hash",
exports.tx_type = "Type",
exports.tx_txout = "Txout",
exports.tx_version = "Version",
exports.tx_recipients = "Recipients",
exports.tx_contributors = "Contributor(s)",
exports.tx_hash = "Tx Hash",
exports.tx_extra = "Extra Data",
exports.tx_address = "Address",
exports.tx_amount = "Amount",
exports.tx_locktime = "Lock time",
exports.tx_instantlock = "Instant lock",
exports.tx_chainlock = "Chain lock",
exports.tx_nonstandard = "NONSTANDARD TX",
exports.tx_size = "Size",
exports.view_raw_tx_data = "View Raw Transaction Data",
exports.view_block = "View Block",
exports.block_confirmations = "Confirmations"

/* BUTK tx_type 1 JSON to array. See validation.h -> TRANSACTION_PROVIDER_REGISTER. */
exports.tx_protx_reg_version = "Protx Register Service Version",
exports.tx_protx_reg_height = "Height",
exports.tx_protx_reg_collateral_hash = "Collateral Hash",
exports.tx_protx_reg_collateral_index = "Collateral Index",
exports.tx_protx_reg_service = "Host:IP",
exports.tx_protx_reg_owner_address = "Owner Address",
exports.tx_protx_reg_voting_address = "Voting Address",
exports.tx_protx_reg_payout_address = "Payout Address",
exports.tx_protx_reg_operator_pk = "Operator PK",
exports.tx_protx_reg_operator_reward = "Operator Reward [%]",
exports.tx_protx_reg_inputs_hash = "Inputs Hash",

/* BUTK tx_type 2 JSON to array. See validation.h -> TRANSACTION_PROVIDER_UPDATE_SERVICE. */
exports.tx_protx_update_version = "Protx Update Service Version",
exports.tx_protx_update_protx_hash = "ProTx Hash",
exports.tx_protx_update_service = "Host:IP",
exports.tx_protx_update_inputs_hash = "Inputs Hash",

/* BUTK tx_type 3 JSON to array. See validation.h -> TRANSACTION_PROVIDER_UPDATE_REGISTRAR. */
exports.tx_protx_update_revoke_version = "Protx Revoke Service Version",
exports.tx_protx_update_revoke_protx_hash = "ProTx Hash",
exports.tx_protx_update_revoke_reason = "Reason",
exports.tx_protx_update_revoke_inputs_hash = "Inputs Hash",

/* BUTK tx_type 4 JSON to array. See validation.h -> TRANSACTION_PROVIDER_UPDATE_REVOKE. */
exports.tx_protx_update_reg_version = "Protx Update Service Version",
exports.tx_protx_update_reg_protx_hash = "Collateral Hash",
exports.tx_protx_update_reg_voting_address = "Voting Address",
exports.tx_protx_update_reg_payout_address = "Payout Address",
exports.tx_protx_update_reg_operator_pk = "Operator PK",
exports.tx_protx_update_req_inputs_hash = "Inputs Hash",

/* BUTK tx_type 6 JSON to array. See validation.h -> TRANSACTION_QUORUM_COMMITMENT. */
exports.tx_qc_version = "Quorum Version",
exports.tx_qc_height = "Height",
exports.tx_qc_commitment_version = "Commitment Version",
exports.tx_qc_commitment_llmq_type = "LLMQ Type",
exports.tx_qc_commitment_hash = "Quorum Hash",
exports.tx_qc_commitment_signers = "Signers",
exports.tx_qc_commitment_valid_members = "Valid Members",
exports.tx_qc_commitment_pk = "Quorum PK",

/* Yerbas tx_type 8 JSON to array. See validation.h -> TRANSACTION_ASSET_REGISTER. */
exports.tx_assert_register_version = "Asset Register Version",

/* Yerbas tx_type 9 JSON to array. See validation.h -> TRANSACTION_ASSET_REISUE. */
exports.tx_assert_reissue_version = "Asset Reissue Version",

/* Generic token */
exports.tx_token_type = "Type",
exports.tx_token_amount = "Amount",
exports.tx_token_ipfs_hash = "IPFS Hash",
exports.tx_token_expire_time = "Expires",
exports.tx_token_properties = "Properties",

exports.block_title = "{1} Block Details",
exports.block_description = "Viewing block data from {1} block #{2}",
exports.block_previous = "Previous Block",
exports.block_next = "Next Block",
exports.block_genesis = "GENESIS",
exports.block_hash = "Hash",
exports.block_hash_pow = "Hash (PoW)",
exports.block_algo = "Algo",
exports.block_difficulty = "Difficulty",
exports.block_confirmations = "Confirmations",
exports.block_size = "Size",
exports.block_bits = "Bits",
exports.block_nonce = "Nonce",
exports.block_timestamp = "Time",
exports.block_version = "Version",
exports.block_version_hex = "Version (hex)",
exports.block_merkle_root = "Merkle root",
exports.block_chainwork = "Chainwork",
exports.block_cbtx = "Coinbase transaction",
exports.block_transactions = "Transaction",
exports.view_raw_block_data = "View Raw Block Data",
exports.view_tx = "View Transaction",


exports.assets_title = "{1} Assets",
exports.assets_description = "Viewing all assets",
exports.asset_title = "{1} Asset {2}",
exports.asset_description = "Viewing asset data {1} block #{2}",

exports.error_title = "{1} X Error",
exports.error_description = "The page you are looking for cannot be found",
exports.error_description_alt = "An error occurred which prevented the page from loading correctly",

exports.algo = "Algorithm",
exports.bits = "Bits",
exports.confirmations = "Confirmations",
exports.difficulty = "Difficulty",
exports.hash = "Hash",
exports.hash_pow = "Hash (PoW)",
exports.height = "Height",
exports.hidden_address = "Hidden Address",
exports.hidden_sender = "Hidden Sender",
exports.hidden_recipient = "Hidden Recipient",
exports.initial_index_alert = "Blockchain data is currently being synchronized. You may browse the site during this time, but keep in mind that data may not yet be fully accurate and some functionality may not work until synchronization is complete.",
exports.last_updated = "Updated",
exports.masternodecount = "Smartnodes",
exports.network = "Network",
exports.new_coins = "New Coins",
exports.nonce = "Nonce",
exports.proof_of_stake = "PoS",
exports.size = "Size",
exports.timestamp = "Time",
exports.total = "Total",
exports.total_received = "Total Received",
exports.total_sent = "Total Sent",
exports.total_top_100 = "Top 1-100 Total",
exports.transactions = "Transactions",
exports.unknown_address = "Unknown Address",
exports.unknown_recipient = "Unknown Recipient",
exports.unknown_sender = "Unknown Sender",
exports.version = "Version",
exports.version_hex = "Version (hex)",

exports.a_title = "{1} Wallet Address Details",
exports.a_description = "Viewing balance and transaction data from {1} address {2}",
exports.a_menu_showing = "Showing",
exports.a_menu_txs = "transactions",
exports.a_menu_all = "All",
exports.a_qr = "QR Code",

exports.mn_title = "{1} Smartnodes",
exports.mn_description = "A listing of all smartnodes known to be active on the {1} network",
exports.mn_masternode_list = "Smartnode List",

exports.move_title = "{1} Coin Movements",
exports.move_latest = "Latest Movement",
exports.move_description = "A listing of larger movements where {1} or more {2} coins were sent in a single transaction",

exports.rl_title = "Top Coin Holders",
exports.rl_description = "A listing of the richest {1} wallet addresses and breakdown of the current coin distribution",
exports.rl_received_coins = "Received",
exports.rl_current_balance = "Balance",
exports.rl_top_tx = "Transactions",

exports.rl_received = "Received",
exports.rl_balance = "Balance",
exports.rl_block_height = "Block",
exports.rl_tx_size = "Size",
exports.rl_tx_timestamp = "Time",
exports.rl_total_out = "Total",
exports.rl_wealth = "Wealth Distribution",
exports.rl_top25 = "Top 1-25",
exports.rl_top50 = "Top 26-50",
exports.rl_top75 = "Top 51-75",
exports.rl_top100 = "Top 76-100",
exports.rl_hundredplus = "101+",

exports.net_title = "{1} Network Peers",
exports.net_description = "A listing of {1} network peers that have connected to X in the last 24 hours",
exports.net_addnodes = "Add Nodes",
exports.net_connections = "Connections",
exports.net_address = "Address",
exports.net_protocol = "Protocol",
exports.net_version = "Version",
exports.net_subversion = "Sub-version",
exports.net_country = "Country",

exports.info_title = "{1} Info {2}",
exports.info_description = "All information about the {1} blockchain, mining and markets.",
exports.info_title_chain = "Blockchain Overview"
exports.info_title_token = "Token Overview"
exports.info_title_markets = "Market Stats"
exports.info_title_masternodes = "Masternode Stats"
exports.info_title_mining = "Mining Stats"
exports.info_name = "Name"
exports.info_symbol = "Symbol"
exports.info_home = "Home"
exports.info_whitepaper = "Whitepaper"
exports.info_start_time = "Start time"
exports.info_block_height = "Blocks"
exports.info_blocks_per_hour = "Blocks / h"
exports.info_last_price = "Last Price ({1} / USD)"
exports.info_max_supply = "Max supply"
exports.info_current_supply = "Current supply"
exports.info_latest_coinbase = "Latest coinbase"
exports.info_count_addresses = "Addresses"
exports.info_count_assets = "Assets"
exports.info_count_utxos = "Utxos"
exports.info_count_transactions = "Transactions"
exports.info_count_masternodes = "Masternodes (enabled / total)"
exports.info_hash_ps = "Hash / s."
exports.info_kilohash_ps = "Kilohash / s."
exports.info_megahash_ps = "Megahash / s."
exports.info_gigahash_ps = "Gigahash / s."
exports.info_difficulty = "Difficulty"

exports.info_masternodes_th_country = "Active Nodes per Country"
exports.info_masternodes_th_count = "Num"
exports.info_masternodes_th_percent = "%"

exports.info_mining_th_algorithm = "Algorithm"
exports.info_mining_th_type = "Type"
exports.info_mining_th_hash_ps = "Hash / s."
exports.info_mining_th_difficulty = "Difficulty"
exports.info_mining_th_blocks = "Blocks"
exports.info_mining_th_percent = "%"

exports.api_title = "{1} API",
exports.api_description = "A listing of public API endpoints for retrieving {1} coin data and more.",
exports.api_documentation = "API Documentation",
exports.api_calls = "API Calls",
exports.api_getnetworkhashps = "Returns the current network hashrate. (Megahash/s)",
exports.api_getblockchaininfo = "Returns the current block chain info including various stats.",
exports.api_getmininginfo = "Returns the current mining info including various stats.",
exports.api_getdifficulty = "Returns the current Proof of work (PoW) difficulty for",
exports.api_getconnectioncount = "Returns the number of connections X has to other nodes.",
exports.api_getmasternodelist = "Returns the complete list of masternodes on the network.",
exports.api_getmasternodecount = "Returns the total number of masternodes on the network.",
exports.api_validateaddress = "Validates the wallet address.",
exports.api_getgovernanceinfo = "Returns the governance info object with min. quorum, proposal fee and super block cycle.",
exports.api_getvotelist = "Returns the current vote list.",
exports.api_getblockcount = "Returns the number of blocks currently in the block chain.",
exports.api_getblockhash = "Returns the hash of the block at [index]; index 0 is the genesis block.",
exports.api_getblock = "Returns information about the block with the given hash.",
exports.api_getrawtransaction = "Returns raw transaction representation for given transaction id. decrypt can be set to 0 (false) or 1 (true).",
exports.api_getmaxmoney = 'Returns the maximum possible money supply.',
exports.api_getmaxvote = 'Returns the maximum allowed vote for the current phase of voting.',
exports.api_getvote = 'Returns the current block reward vote setting.',
exports.api_getphase = 'Returns the current voting phase (\'Mint\', \'Limit\' or \'Sustain\').',
exports.api_getreward = 'Returns the current block reward, which has been decided democratically in the previous round of block reward voting.',
exports.api_getsupply = 'Returns the current money supply.',
exports.api_getnextrewardestimate = 'Returns an estimate for the next block reward based on the current state of decentralized voting.',
exports.api_getnextrewardwhenstr =  'Returns a string describing how long until the votes are tallied and the next block reward is computed.',

// Markets view
exports.mkt_market = "Market",
exports.mkt_exchange = "Exchange",
exports.mkt_ask = "Ask",
exports.mkt_bid = "Bid",
exports.mkt_last = "Last",
exports.mkt_title = "{1} Market Details",
exports.mkt_description = "Viewing {1} market data for the {2} exchange",
exports.mkt_hours = "24 hours",
exports.mkt_view_chart = "View 24 hour summary",
exports.mkt_view_summary = "View 24 hour chart",
exports.mkt_no_chart = "Chart data is not available via markets API",
exports.mkt_high = "High",
exports.mkt_low = "Low",
exports.mkt_volume = "Volume",
exports.mkt_top_bid = "Top Bid",
exports.mkt_top_ask = "Top Ask",
exports.mkt_initial = "Initial Price",
exports.mkt_last = "Last",
exports.mkt_yesterday = "Yesterday",
exports.mkt_change = "Change",
exports.mkt_sell_orders = "Sell Orders",
exports.mkt_buy_orders = "Buy Orders",
exports.mkt_price = "Price",
exports.mkt_amount = "Amount",
exports.mkt_total = "Total",
exports.mkt_trade = "Trade",
exports.mkt_trade_history = "Trade History ({1})",
exports.mkt_type = "Type",
exports.mkt_time_stamp = "Time",
exports.mkt_select = "Market Selection",
exports.mkt_sum = "Sum ->",

// Registration page
exports.registration_title = "User Registration",
exports.registration_description = "Register an account with an address from your wallet. Sign the UUID {1} with the wallet address and paste it into the form below. You can then log in with this address and your password. Registration is free. But the address to be registrated needs at least {2} coins.",

// Login page
exports.login_title = "User Login",
exports.login_description = "Sign in with your address and password.",

// User page
exports.user_title = "Welcome {1}",

// Claim address view
exports.claim_title = "{1} Wallet Address Claim",
exports.claim_description = "Verify ownership of your {1} wallet address and set a custom display name in X",

// Heavycoin
exports.heavy_vote = "Vote",
// Heavycoin rewards view
exports.heavy_title = "{1} Reward/Voting Details",
exports.heavy_description = "Viewing {1} voting data and coin reward change details",
exports.heavy_reward_voting_info = "Reward/voting information",
exports.heavy_cap = "Coin Cap",
exports.heavy_phase = "Phase",
exports.heavy_maxvote = "Max Vote",
exports.heavy_reward = "Reward",
exports.heavy_current = "Current Reward",
exports.heavy_estnext = "Est. Next",
exports.heavy_changein = "Reward change in approximately",
exports.heavy_key = "Key",
exports.heavy_lastxvotes = "Last 20 votes",

exports.reloadLocale = function reloadLocale(locale) {
  // discover where the locale file lives
  var localeFilename = "./" + locale;
  var localeStr;

  try {
    // read the settings sync
    localeStr = fs.readFileSync(localeFilename).toString();
  } catch(e) {
    console.warn('Locale file not found. Continuing using defaults!');
  }

  var lsettings;

  // try to parse the settings  
  try {
    if (localeStr) {
      localeStr = jsonminify(localeStr).replace(",]","]").replace(",}","}");
      lsettings = JSON.parse(localeStr);
    }
  } catch(e) {
    console.error('There was an error processing your locale file: '+e.message);
    process.exit(1);
  }

  // loop through the settings
  for (var i in lsettings) {
    // test if the setting start with a low character
    if (i.charAt(0).search("[a-z]") !== 0)
      console.warn("Settings should start with a low character: '" + i + "'");

    if (exports[i] !== undefined) {
      // we know this setting, so we overwrite it
      exports[i] = lsettings[i];
    } else {
      // this setting is unkown, output a warning and throw it away
      console.warn("Unknown Setting: '" + i + "'. This setting doesn't exist or it was removed");
    }
  }
};

// initially load settings
exports.reloadLocale(settings.locale);