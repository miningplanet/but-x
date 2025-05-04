/**
* The Settings Module reads the settings out of settings.json and provides this information to the other modules.
*
* UI related settings might be devided into 
* - Mobile (0-575px)
* - Tablet (576-991px) or
* - Desktop (>= 992px) variant.
*/
const debug = require('debug')('debug')
const fs = require("fs")
const jsonminify = require("jsonminify")
const _ = require('lodash')

exports.home_url =                        "https://site.xyz"
exports.home_title =                      "Home Link"
// locale: Change language definitions. Only English is supported for now.
exports.locale =                            "locale/en.json"
exports.coins = [
  { "id": "EGOD",   "name": "Egodcoin",   "symbol": "EGOD",   "max_supply":   420000000 },
  { "id": "BTRM",   "name": "Bitoreum",   "symbol": "BTRM",   "max_supply": 21000000000 },
  { "id": "RTM",    "name": "Raptoreum",  "symbol": "RTM",    "max_supply": 21000000000 },
  { "id": "PEPEW",  "name": "PEPEPOW",    "symbol": "PEPEW",  "max_supply": 89999999997 },
  { "id": "VKAX",   "name": "Vkax",       "symbol": "VKAX",   "max_supply": 21000000000 },
  { "id": "YERB",   "name": "Yerbas",     "symbol": "YERB",   "max_supply":   420000000 },
  { "id": "BTC",    "name": "Bitcoin",    "symbol": "BTC",    "max_supply":    21000000 }
],
exports.dbs = [
  {
    "id":                                 "mainnet",
    "user":                               "iquidus",
    "password":                           "3xp!0reR",
    "database":                           "explorerdb",
    "address":                            "localhost",
    "port":                               27017,
    "enabled":                            true
  },
  {
    "id":                                 "testnet",
    "user":                               "iquidus-testnet",
    "password":                           "3xpTest3!",
    "database":                           "explorerdb-testnet",
    "address":                            "localhost",
    "port":                               27017,
    "enabled":                            true
  }
],
exports.wallets = [
  {
    "id":                                 "mainnet",
    "chain":                              "main",
    "host":                               "localhost",
    "port":                               15998,
    "username":                           "admin1",
    "password":                           "123",
    "genesis_hash":                       "7e2489e3e792e445b485550840504179897ae3f501ef81dc4a53a6716a323175",
    "start_time":                         1675905317
  },
  {
    "id":                                 "testnet",
    "chain":                              "testnet",
    "host":                               "localhost",
    "port":                               34340,
    "username":                           "admin1",
    "genesis_hash":                       "eff0bbe5c1bbe1ef8da54822a18f528d6dc58232990bdb86e0a77ab2814ed12c",
    "start_time":                         1652138420
  }
],

// Web server settings (read more: https://www.npmjs.com/package/express)
exports.webserver = {
  "url":                                  "https://x.site.com",
  "port":                                 process.env.PORT || 3001,
  // If you us a reverse proxy like Nginx or Apache TLS usually is not required for the internal communication.
  // Paths are absolute.
  "tls": {
    "enabled":                            false,
    "port":                               443,
    "cert_file":                          "/etc/letsencrypt/live/domain-name-here/cert.pem",
    "chain_file":                         "/etc/letsencrypt/live/domain-name-here/chain.pem",
    "key_file":                           "/etc/letsencrypt/live/domain-name-here/privkey.pem"
  },
  // Cross-Origin Resource Sharing (CORS) support (read more: https://www.maxcdn.com/one/visual-glossary/cors/).
  "cors": {
    // Set Access-Control-Allow-Origin: <corsorigin> header or not.
    "enabled":                            false,
    "corsorigin":                         "*"
  }
}

// Currencies known to the system.
exports.currencies = {
  "USD":    { "minfd": 8, "maxfd": 8, "name": "United States Dollar",   "code": "USD",    "symbol": "&#36;" },
  "EUR":    { "minfd": 8, "maxfd": 8, "name": "Euro",                   "code": "EUR",    "symbol": "&euro;" },
  "CNY":    { "minfd": 7, "maxfd": 7, "name": "Chinese Yuan",           "code": "CNY",    "symbol": "&#20803;" },
  "INR":    { "minfd": 6, "maxfd": 6, "name": "Indian Rupees",          "code": "INR",    "symbol": "&#8377;" },
  "JPY":    { "minfd": 5, "maxfd": 5, "name": "Japanese Yen",           "code": "JPY",    "symbol": "&#165;" },
  "GBP":    { "minfd": 8, "maxfd": 8, "name": "British Pound Sterling", "code": "GBP",    "symbol": "&pound;" },
  "RUB":    { "minfd": 6, "maxfd": 6, "name": "Russian Ruble",          "code": "RUB",    "symbol": "&#8381;" },
  "BRL":    { "minfd": 7, "maxfd": 7, "name": "Brazilian Real",         "code": "BRL",    "symbol": "R&#36;" },
  "USDT":   { "minfd": 8, "maxfd": 8, "name": "Tether",                 "code": "USDT",   "symbol": "USDT" },
  "BTC":    { "minfd": 8, "maxfd": 8, "name": "Bitcoin",                "code": "BTC",    "symbol": "BTC" },
  "LTC":    { "minfd": 8, "maxfd": 8, "name": "Litecoin",               "code": "LTC",    "symbol": "LTC" },
  "DOGE":   { "minfd": 6, "maxfd": 6, "name": "Dogecoin",               "code": "DOGE",   "symbol": "DOGE" },
  "EXTO":   { "minfd": 7, "maxfd": 7, "name": "Exto",                   "code": "EXTO",   "symbol": "EXT" },
  "BTRM":   { "minfd": 4, "maxfd": 4, "name": "Bitoreum",               "code": "BTRM",   "symbol": "BTRM" },
  "RTM":    { "minfd": 4, "maxfd": 4, "name": "Raptoreum",              "code": "RTM",    "symbol": "RTM" },
  "DASH":   { "minfd": 4, "maxfd": 4, "name": "Dash",                   "code": "DASH",   "symbol": "DASH" },
  "BNB":    { "minfd": 8, "maxfd": 8, "name": "Binance",                "code": "BNB",    "symbol": "BNB" },
  "PEPEW":  { "minfd": 7, "maxfd": 7, "name": "PEPEPOW",                "code": "PEPEW",  "symbol": "PEPEW" },
  "VKAX":   { "minfd": 7, "maxfd": 7, "name": "Vkax",                   "code": "VKAX",   "symbol": "VKAX" },
  "GALE":   { "minfd": 7, "maxfd": 7, "name": "Galleoncoin",            "code": "GALE",   "symbol": "GALE" },
  "YERB":   { "minfd": 7, "maxfd": 7, "name": "Yerbas",                 "code": "YERB",   "symbol": "YERB" }
},

// Algorithms supported by the base coin.
exports.algos = [
  { "algo": "ghostrider", "type": "cpu" },
  { "algo": "yespower",   "type": "cpu" },
  { "algo": "lyra2",      "type": "gpu" },
  { "algo": "sha256d",    "type": "ASIC" },
  { "algo": "scrypt",     "type": "ASIC" }
]

// TX types of the base coin.
exports.tx_types = [
    "TRANSACTION_NORMAL",
    "TRANSACTION_PROVIDER_REGISTER",
    "TRANSACTION_PROVIDER_UPDATE_SERVICE",
    "TRANSACTION_PROVIDER_UPDATE_REGISTRAR",
    "TRANSACTION_PROVIDER_UPDATE_REVOKE",
    "TRANSACTION_COINBASE",
    "TRANSACTION_QUORUM_COMMITMENT",
    "TRANSACTION_FUTURE",
    "TRANSACTION_ASSET_REGISTER",
    "TRANSACTION_ASSET_REISUE"
]

// TTL cache (time in seconds) for the base coin.
exports.cache = {
  "enabled": true,
  "network_chart":                        { "ttl": 120,   "size": 100 },
  "stats":                                { "ttl": 120,   "size": 100 },
  "dbindex":                              { "ttl": 60,    "size": 100 },
  "supply":                               { "ttl": 120,   "size": 100 },
  "difficulty":                           { "ttl": 60,    "size": 100 },
  "ticker":                               { "ttl": 120,   "size": 100 },
  "blocks":                               { "ttl": 120,   "size": 100 },
  "addresses":                            { "ttl": 120,   "size": 100 },
  "addresstxes":                          { "ttl": 120,   "size": 100 },
  "assets":                               { "ttl": 120,   "size": 10 },
  "asset":                                { "ttl": 120,   "size": 100 },
  "assetTx":                              { "ttl": 120,   "size": 100 },
  "txs":                                  { "ttl": 120,   "size": 5000 },
  "peers":                                { "ttl": 120,   "size": 100 },
  "masternodes":                          { "ttl": 120,   "size": 100 },
  "richlist":                             { "ttl": 60,    "size": 100 },
  "markets":                              { "ttl": 60,    "size": 100 },
  "info":                                 { "ttl": 120,   "size": 100 },
  "allnet":                               { "ttl": 60,    "size": 100 },
  "xpeers":                               { "ttl": 30,    "size": 100 }
},

// Sync settings for network_history. Disable to not to store.
exports.network_history = {
  "enabled":                              true,
  "max_saved_records":                    120
}

// Per coin settings. Overwritten in settings.json.
exports.net = {
}

/* Shared page settings */

// Base settings for all pages. Others are derived by it.
exports.shared_pages = {
  // TODO: Wait for new themes.
  "theme": "Darkly",
  // Text to be displayed at the end of the HTML title tag and in the page header if "shared_pages.page_header.home_link" setting is set to "title".
  "page_title":                           "my.site",
  "page_description":                     "digital crypto currency.",
  "page_tags":                            "crypto, currency, coin, bitcoin",
  // Either top or bottom.
  "links_position":                       "bottom",
  "links": [
    {
      "enabled":                          false,
      "tooltip_text":                     "Github Egodcoin (info@egodcoin.org)",
      "url":                              "https://www.github.com/egodcoin",
      "text":                             "Github Egodcoin",
      "icon":                             "github",
      "image_path":                       ""
    }],
  // Base directory is public. Blank means disabled.
  "favicons": {
    "favicon32":                          "img/logo.svg",
    "favicon128":                         "img/logo.svg",
    "favicon180":                         "img/logo.svg",
    "favicon192":                         "img/logo.svg"
  },
  "date_time": {
    "timezone":                           "utc",
    "enable_alt_timezone_tooltips":       false
  },
  // If >= to this value then the block or tx is considered valid and shows up in green
  // If < this value by more than 50% then the block or tx is considered unconfirmed and shows up in red
  // If < this value by less than 50% then the block or tx is considered unconfirmed and shows up in orange
  "confirmations":                        40,
  // Network difficulty value to display (valid options are: POW, POS or Hybrid)
  //             POW: Display the proof-of-work difficulty value
  //             POS: Display the proof-of-stake difficulty value
  //             Hybrid: Display both the proof-of-work and proof-of-stake difficulty values
  // TODO: Fix. settings.json not effective.
  "difficulty": "POW",
  // If set to false, the /api/getnetworkhashps and /ext/getsummary apis will no longer show hash rate information, and the network hashrate chart will be disabled.
  "show_hashrate":                        true,
  "page_header": {
    // Use top to display the menu horizontally or side to display it vertically.
    "menu": "top",
    "menu_show_user_ip":                  true,
    // Sticks the header to top of page.
    "sticky_header":                      true,
    // Determines what is displayed in the top-left corner of the header menu. Valid options:
    //            title: display "shared_pages.page_title" text setting
    //            coin: display "coin.name" text setting
    //            logo: displays wallet[net].logo_title.
    "home_link":                          "logo",
    // Max. size in PX of the logo. Only valid if "shared_pages.page_header.home_link" = 'logo'.
    "home_link_logo_height":              50,
    // Shows max. 6 enabled panels in the sequence they are configured here.
    "panels": {
      "network_panel": {
        "enabled":                        false,
        "nethash":                        "getnetworkhashps",
        // nethash_units: Determine which units should be used to display the network hashrate. Valid options:
        //        P: Display value in petahashes (PH/s)
        //        T: Display value in terahashes (TH/s)
        //        G: Display value in gigahashes (GH/s)
        //        M: Display value in megahashes (MH/s)
        //        K: Display value in kilohashes (KH/s)
        //        H: Display value in hashes (H/s)
        "nethash_units":                  "G"
      },
      "difficulty_panel":                 { "enabled": false },
      "masternodes_panel":                { "enabled": true },
      "coin_supply_panel":                { "enabled": true },
      "price_panel":                      { "enabled": true },
      "market_cap_panel":                 { "enabled": true },
      "logo_panel":                       { "enabled": true }
    },
    "search": {
      "enabled":                          true,  
      // Use inside-header or below-header to determine where the search box should appear.
      "position":                         "inside-header"
    },
    // Independently show/hide individual charts by changing the show_nethash_chart and show_difficulty_chart values for each page.
    // Only if nethash_chart is enabled!
    "network_charts": {
      // Algorithms to show.
      "algos":                            ["ghostrider", "scrypt", "sha256d"],
      "align":                            "bottom",
      // Specifiy colors as i.e. "#ffffff" or "rgba(255, 255, 255, 1)" or "white".
      "nethash_chart": {
          "enabled":                      true,
          "line_color":                   "rgba(173,255,47)",
          "fill_color":                   "rgba(173,255,47, 0.2)",
          "pow_line_color":               "rgba(173,255,47)",
          "pow_fill_color":               "rgba(173,255,47, 0.2)",
          "pos_line_color":               "rgba(173,255,47)",
          "pos_fill_color":               "rgba(173,255,47, 0.2)",
          "ghostrider_line_color":        "rgba(153,255,47)",
          "ghostrider_fill_color":        "rgba(153,255,47, 0.2)",
          "scrypt_line_color":            "rgba(245,182,66)",
          "scrypt_fill_color":            "rgba(245,182,66, 0.2)",
          "sha256d_line_color":           "rgba(66,245,245)",
          "sha256d_fill_color":           "rgba(66,245,245, 0.2)",
          "crosshair_color":              "#ffffff",
          "round_decimals":               3
        },
        "difficulty_chart": {
          "enabled": true,
          "pow_line_color":               "rgba(173,255,47)",
          "pow_fill_color":               "rgba(173,255,47, 0.2)",
          "pos_line_color":               "rgba(173,255,47)",
          "pos_fill_color":               "rgba(173,255,47, 0.2)",
          "ghostrider_line_color":        "rgba(153,255,47)",
          "ghostrider_fill_color":        "rgba(153,255,47, 0.2)",
          "scrypt_line_color":            "rgba(245,182,66)",
          "scrypt_fill_color":            "rgba(245,182,66, 0.2)",
          "sha256d_line_color":           "rgba(66,245,245)",
          "sha256d_fill_color":           "rgba(66,245,245, 0.2)",
          "crosshair_color":              "#ffffff",
          "round_decimals":               3
        },
      "reload_chart_seconds":             60
    }
  },
  "page_footer": {
    // Let the footer stick to bottom of the page.
    "sticky_footer":                      false,
    // Supports any valid height value in pixels (Ex: "50px") or percent (Ex: "10%").
    "footer_height_desktop":              "50px",
    "footer_height_tablet":               "70px",
    "footer_height_mobile":               "70px",
    // image_path or icon class to determine the image or icon to show for the url link required for each entry. 1st filled-in is choosen.
    "social_links": [],
    // This is a percentage value and must be a positive number between 1-100
    "social_link_percent_height_desktop": 70,
    "social_link_percent_height_tablet":  42,
    "social_link_percent_height_mobile":  40,
    "copy_text":                          "Text and Copyright note."
  }
}

/* Built-in Pages (cannot be disabled) */

exports.index_page = {
  "enabled":                              true,
  "linked":                               true,
  "show_panels":                          true,
  "show_panels_position":                 "top",
  "show_nethash_chart":                   true,
  "show_difficulty_chart":                true,
  "refresh_interval":                     120000,
  "page_header": {
    "show_img":                           true,
    "show_title":                         true,
    "show_last_updated":                  true,
    "show_description":                   true
  },
  "transaction_table": {
    "page_length_options":                [ 10, 25, 50, 75, 100, 250, 500, 1000 ],
    "items_per_page":                     20,
    "reload_table_seconds":               60
  }
}

exports.info_page = {
  "enabled":                              true,
  "show_panels":                          true,
  "show_panels_position":                 "top",
  "show_nethash_chart":                   false,
  "show_difficulty_chart":                false,
  "page_header": {
    "show_img":                           false,
    "show_title":                         true,
    "show_last_updated":                  true,
    "show_description":                   true
  },
  "show_header_menu":                     true,
  "info": {
    "description":                        "Egodcoin - Description here. Ask ChatGPT4+",
    "home_url":                           "https://egodcoin.org",
    "whitepaper_url":                     "https://egodcoin.org/whitepaper.pdf",
    "whitepaper_title":                   "Egodcoin Whitepaper",
    "show_coinbase":                      true,
    "show_masternode_info":               true,
    "show_markets":                       true,
    "show_last_price" :                   true,
    "show_chainstats":                    true,
    "show_coinstats":                     true,
    "show_txstats":                       true,
    "show_algostats":                     true,
    "show_miningstats":                   true,
    "show_sporks":                        false
  }
}

exports.block_page = {
  "show_panels":                          false,
  "show_panels_position":                 "top",
  "show_nethash_chart":                   false,
  "show_difficulty_chart":                false,
  "page_header": {
    "show_img":                           true,
    "show_title":                         true,
    "show_description":                   true
  },
  // genesis_block: coin-cli getblockhash 0
  "genesis_block":                        "001787e5f9c3cd249f84f0142071f6098d9e3b7ec8591ff73543ddc4900c1dc2"
}

exports.transaction_page = {
  "show_panels":                          false,
  "show_panels_position":                 "top",
  "show_nethash_chart":                   false,
  "show_difficulty_chart":                false,
  "page_header": {
    "show_img":                           true,
    "show_title":                         true,
    "show_description":                   true
  },
  // genesis_block: coin-cli getblockhash 0
  "genesis_tx":                           "c083fb7c3b6936c15dc2685a522ffa685247e8c665c818888b51b0771584d7b4",
  "show_op_return":                       false
}

exports.address_page = {
  "show_panels":                          false,
  "show_panels_position":                 "top",
  "show_nethash_chart":                   false,
  "show_difficulty_chart":                false,
  "page_header": {
    "show_img":                           true,
    "show_title":                         true,
    "show_description":                   true
  },
  "show_sent_received":                   false,
  // enable_hidden_address_view: Determine whether to allow viewing the special 'hidden_address' wallet address which is populated anytime a private/hidden wallet address is involved in a transaction
  //                              NOTE: Enabling this option will add hyperlinks to all Hidden Addresses and allow viewing of the /address/hidden_address page
  //                                    Disabling this option will display all Hidden Addresses in plain-text without a hyperlink and visiting the /address/hidden_address page will result in a 404 error
  "enable_hidden_address_view":           false,
  // enable_unknown_address_view: Determine whether to allow viewing the special 'unknown_address' wallet address which is populated anytime a wallet address cannot be deciphered
  //                              NOTE: Enabling this option will add hyperlinks to all Unknown Addresses and allow viewing of the /address/unknown_address page
  //                                    Disabling this option will display all Unknown Addresses in plain-text without a hyperlink and visiting the /address/unknown_address page will result in a 404 error
  "enable_unknown_address_view":          false,
  "history_table": {
    "page_length_options":                [ 10, 25, 50, 75, 100, 250, 500, 1000 ],
    "items_per_page":                     50
  }
}

exports.error_page = {
  "show_panels":                          false,
  "show_panels_position":                 "top",
  "show_nethash_chart":                   false,
  "show_difficulty_chart":                false,
  "page_header": {
    "show_img":                           true,
    "show_title":                         true,
    "show_description":                   true
  }
}

/* Additional Pages (can be enabled/disabled via settings) */

exports.masternodes_page = {
  "enabled":                              true,
  "show_panels":                          false,
  "show_panels_position":                 "top",
  "show_nethash_chart":                   false,
  "show_difficulty_chart":                false,
  "page_header": {
    "show_img":                           true,
    "show_title":                         true,
    "show_last_updated":                  true,
    "show_description":                   true
  },
  "masternode_table": {
    "page_length_options":                [ 10, 25, 50, 75, 100, 250, 500, 1000 ],
    "items_per_page":                     20
  }
}

exports.movement_page = {
  "enabled":                              true,
  "show_panels":                          false,
  "show_panels_position":                 "top",
  "show_nethash_chart":                   false,
  "show_difficulty_chart":                false,
  "page_header": {
    "show_img":                           true,
    "show_title":                         true,
    "show_last_updated":                  true,
    "show_description":                   true
  },
  "movement_table": {
    "page_length_options":                [ 10, 25, 50, 75, 100, 250, 500, 1000 ],
    "items_per_page":                     20,
    "reload_table_seconds":               45,
    "min_amount":                         5000,
    // low low_warning_flag: Flag all transactions in yellow/orange that are sent with coin amounts above this value.
    "low_warning_flag":                   50000,
    // high_warning_flag: Flag all transactions in red that are sent with coin amounts above this value.
    "high_warning_flag":                  100000
  }
}

exports.network_page = {
  "enabled":                              true,
  "show_panels":                          false,
  "show_panels_position":                 "top",
  "show_nethash_chart":                   false,
  "show_difficulty_chart":                false,
  "page_header": {
    "show_img":                           true,
    "show_title":                         true,
    "show_last_updated":                  true,
    "show_description":                   true
  },
  // port_filter: Only show peers with these ports. 0 means any. -1 groups IPs connected with multiple ports.
  // hide_protocols: Hide these ports. I.e. [0, 70803, 70819] 
  "connections_table": {
    "page_length_options":                [ 10, 25, 50, 75, 100 ],
    "items_per_page":                     20,
    "port_filter":                        0,
    "hide_protocols":                     [ ]
  },
  "addnodes_table": {
    "page_length_options":                [ 10, 25, 50, 75, 100 ],
    "items_per_page":                     20,
    "port_filter":                        0,
    "hide_protocols":                     [ ]
  },
  "onetry_table": {
    "page_length_options":                [ 10, 25, 50, 75, 100 ],
    "items_per_page":                     10,
    "port_filter":                        0,
    "hide_protocols":                     [ ]
  }
}

exports.richlist_page = {
  "enabled":                              true,
  "show_panels":                          false,
  "show_panels_position":                 "top",
  "show_nethash_chart":                   false,
  "show_difficulty_chart":                false,
  "page_header": {
    "show_img":                           true,
    "show_title":                         true,
    "show_last_updated":                  true,
    "show_description":                   true
  },
  // Show or hide tabs.
  "show_current_balance":                 true,
  "show_received_coins":                  true,
  "show_top_tx":                          true,
  "wealth_distribution": {
    "show_distribution_table":            true,
    "show_distribution_chart":            true,
    // From left-to-right the 6 colors are represented as the following: 
    //    "top 1-25",
    //    "top 26-50",
    //    "top 51-75",
    //    "top 76-100",
    //    "101+" and "burned coins" if enabled.
    "colors":                             [ "#e73cbd", "#00bc8c", "#3498db", "#e3ce3e", "#adb5bd", "#e74c3c" ]
  },
  // Changes here might require an index sync or reindex-rich.
  "burned_coins": {
    // Add addresses to be excluded from the richlist/top100 page.
    "addresses":                          [ "ButkBurnAddressXXXXXXXXXXXXXW7cDZQ" ],
    // Set this value to false if your blockchain already has a mechanism for removing burned coins from the total supply.
    "include_burned_coins_in_dist":       false
  }
}

exports.markets_page = {
  "enabled":                              false,
  "show_panels":                          false,
  "show_panels_position":                 "top",
  "show_nethash_chart":                   false,
  "show_difficulty_chart":                false,
  "page_header": {
    "show_img":                           true,
    "show_title":                         true,
    "show_last_updated":                  true,
    "show_exchange_url":                  true,
    "show_description":                   true
  },
  // Show drop-down menu with a list of all markets available or a single item pointing to the default market.
  "show_market_dropdown_menu":            true,
  // Show a list of all markets near the top of the page.
  "show_market_select":                   true,
  // exchanges: see lib/markets.
  "exchanges": {
    "max_history":                        1000,
    "max_orders":                         500,
    "max_chart":                          10000,
    "xeggex": {
      "enabled":                          false,
      "trading_pairs":                    [ ]
    },
    "exbitron": {
      "enabled":                          false,
      "trading_pairs":                    [ ]
    },
    "btrmex": {
      "enabled":                          false,
      "trading_pairs":                    [ ]
    },
    "bitxonex": {
      "enabled":                          false,
      "trading_pairs":                    [ ]
    },
    "coinex": {
      "enabled":                          false,
      "trading_pairs":                    [ ]
    },
    "altmarkets": {
      "enabled":                          false,
      "trading_pairs":                    [ "LTC/BTC", "LTC/ETH" ]
    },
    "crex": {
      "enabled":                          false,
      "trading_pairs":                    [ "LTC/BTC" ]
    },
    "dextrade": {
      "enabled":                          false,
      "trading_pairs":                    [ "LTC/BTC" ]
    },
    // NOTE: freiexchange does not display a 24-hour chart due to a lack of OHLCV api data.
    "freiexchange": {
      "enabled":                          false,
      "trading_pairs":                    [ "LTC/BTC" ]
    },
    "poloniex": {
      "enabled":                          false,
      "trading_pairs":                    [ "LTC/BTC" ]
    },
    "unnamed": {
      "enabled":                          false,
      "trading_pairs":                    [ "LTC/BTC" ]
    },
    // NOTE: yobit does not display a 24-hour chart due to a lack of OHLCV api data.
    "yobit": {
      "enabled":                          false,
      "trading_pairs":                    [ "LTC/BTC" ]
    },
    "finexbox": {
      "enabled":                          false,
      "trading_pairs":                    [ ]
    },
    "tradeogre": {
      "enabled":                          true,
      "trading_pairs":                    [ ]
    }
  },
  "default_exchange": {
    "exchange_name":                      "xeggex",
    "trading_pair":                       "YERB/USDT"
  }
}

exports.api_page = {
  "enabled":                              true,
  "show_panels":                          false,
  "show_panels_position":                 "top",
  "show_nethash_chart":                   false,
  "show_difficulty_chart":                false,
  "page_header": {
    "show_img":                           true,
    "show_title":                         true,
    "show_description":                   true
  },
  "show_logo":                            true,
  "sample_data": {
    "asset":                              "TROLLTIPS",
    "blockindex":                         500,
    "blockhash":                          "775d67da29dd6553268061f86368d06654944dd5d5c61db4c97e4c7960c11a74",
    "txhash":                             "6cb3babd256de253f926f10bc8574dadf0a3e2fc8380107b81eb07c67d1e73ed",
    "address":                            "XkffzeBW9S39X6zwEVpNrRsdSx5sfRK8or",
    "address":                            "XkffzeBW9S39X6zwEVpNrRsdSx5sfRK8or",
      // 'HelloWorld' to base64 to URL-encoded
      "base64UrlEncodedMessage":          "SGVsbG9Xb3JsZA%3D%3D",
      // signature to URL-encoded
      "base64UrlEncodedSignature":        "H1B9Yt0gLf9V%2FW6L5GJ73O6Kb4RYL12zJ1YPrYS%2Btv0tIIsnREY92%2F%2BF2n9nBFxVzIqQL%2FL8blE8tnmWE2QAm8E%3D"
  },
  // "api_page.enabled" must be true or all API commands are disabled. Disable a specific API command to not to be shown on the API page.
  "public_apis": {
    "hide_rpc_api_section":               false,
    "hide_ext_api_section":               false,
    "hide_asset_api_section":             false,
    "hide_net_api_section":               false,
    "hide_peers_api_section":             false,
    "hide_linking_section":               false,
    "hide_electrum_api_section":          false,
    "rpc": {
      "getblockchaininfo":                { "enabled": true },
      "getmininginfo":                    { "enabled": true },
      "getdifficulty":                    { "enabled": true },
      "getconnectioncount":               { "enabled": true },
      "getblockcount":                    { "enabled": true },
      "getblockhash":                     { "enabled": true },
      "getblock":                         { "enabled": true },
      "getrawtransaction":                { "enabled": true },
      "getnetworkhashps":                 { "enabled": true },
      "getvotelist":                      { "enabled": true },
      "getmasternodecount":               { "enabled": true },
      "verifymessage":                    { "enabled": true },
      "validateaddress":                  { "enabled": true },
      "getgovernanceinfo":                { "enabled": true }
    },
    // ext: a collection of settings that pertain to the extended APIs that are retrieved from DB.
    "ext": {
      "getmoneysupply":                   { "enabled": true },
      "getdistribution":                  { "enabled": true },
      "getaddress":                       { "enabled": true },
      "getaddresstxs":                    { "enabled": true, "max_items_per_query": 1000 },
      "gettx":                            { "enabled": true },
      "getbalance":                       { "enabled": true },
      "getlasttxs":                       { "enabled": true, "max_items_per_query": 1000 },
      "getcurrentprice":                  { "enabled": true },
      "getnetworkpeers":                  { "enabled": true },
      "getbasicstats":                    { "enabled": true },
      "getticker":                        { "enabled": true },
      "getmarkets":                       { "enabled": true },
      "getsummary":                       { "enabled": true },
      "getmasternodelist":                { "enabled": true },
      "getmasternoderewards":             { "enabled": true },
      "getmasternoderewardstotal":        { "enabled": true }
    },
    "db": {
      "asset":                            { "enabled": true },
      "assets":                           { "enabled": true },
      "getassettxes":                     { "enabled": true, "max_items_per_query": 1000 }
    },
    "net": {
      "getallnet": {
        "enabled": true
      }
    },
    "peers": {
      "allowed_ips":                      [ "::ffff:127.0.0.1", "127.0.0.1" ],
      "getpeers":                         { "enabled": true },
      "subscribe_upstream":               { "enabled": true },
      "subscribe_downstream":             { "enabled": true },
      "unsubscribe_upstream":             { "enabled": true },
      "unsubscribe_downstream":           { "enabled": true }
    }
  }
}

exports.assets_page = {
  "enabled":                              true,
  "show_panels":                          true,
  "show_panels_position":                 "top",
  "show_nethash_chart":                   false,
  "show_difficulty_chart":                false,
  "page_header": {
    "show_img":                           true,
    "show_title":                         true,
    "show_description":                   true
  },
  "show_header_menu":                     true,
  "assets_table": {
    "page_length_options":                [ 20, 50, 100, 200 ],
    "items_per_page":                     20,
    "max_items":                          20000,
    "reload_table_seconds":               120
  }
},

exports.asset_page = {
  "enabled":                              true,
  "show_panels":                          true,
  "show_panels_position":                 "top",
  "show_nethash_chart":                   false,
  "show_difficulty_chart":                false,
  "page_header": {
    "show_img":                           true,
    "show_title":                         true,
    "show_description":                   true
  },
  "show_header_menu":                     true,
  "assettxes_table": {
      "items_per_page":                     10,
      "page_length_options":                [ 10, 20, 50, 100, 200 ]
    }
},

exports.registration_page = {
  "enabled":                              true,
  "linked":                               true,
  "show_panels":                          true,
  "show_panels_position":                 "top",
  "show_nethash_chart":                   false,
  "show_difficulty_chart":                false,
  "page_header": {
    "show_img":                           true,
    "show_title":                         true,
    "show_description":                   true
  },
  "show_header_menu":                     true,
  "enable_bad_word_filter":               true,
  "min_balance_for_registration":         1000
},

exports.login_page = {
  "enabled":                              true,
  "linked":                               true,
  "show_panels":                          true,
  "show_panels_position":                 "top",
  "show_nethash_chart":                   false,
  "show_difficulty_chart":                false,
  "page_header": {
    "show_img":                           true,
    "show_title":                         true,
    "show_description":                   true
  },
  "show_header_menu":                     true,
  "enable_bad_word_filter":               true,
  "min_balance_for_login":                100
},

exports.user_page = {
  "enabled":                              true,
  "linked":                               true,
  "show_panels":                          true,
  "show_panels_position":                 "top",
  "show_nethash_chart":                   false,
  "show_difficulty_chart":                false,
  "page_header": {
    "show_img":                           true,
    "show_title":                         true,
    "show_description":                   true
  },
  "show_header_menu":                     true
},

exports.claim_address_page = {
  "enabled":                              true,
  "show_panels":                          false,
  "show_panels_position":                 "top",
  "show_nethash_chart":                   false,
  "show_difficulty_chart":                false,
  "page_header": {
    "show_img":                           true,
    "show_title":                         true,
    "show_description":                   true
  },
  "show_header_menu":                     true,
  "enable_bad_word_filter":               true
}

// Synchronization settings.
exports.sync = {
  // Must be 1 to sync in order!
  "block_parallel_tasks":                 1,
  "update_timeout":                       5,
  "check_timeout":                        250,
  // Set to 1000 if you sync from 0.
  "save_stats_after_sync_blocks":         100,
  // Shows the sync message on the page.
  "show_sync_msg_when_syncing_more_than_blocks": 1000
}

// labels: a collection of settings that pertain to the list of customized wallet address labels
//           Adding entries to this section will display a custom label beside each affected wallet address when displayed in but-x
//           NOTE: You can add as many address labels as desired
exports.labels = {
  "yMk29LyDEGd18uH2ota6ns2WbF9tU8AehL":   { // yMk29LyDEGd18uH2ota6ns2WbF9tU8AehL
    "enabled":                            true,
    "label":                              "Burned by Xeggex",
    "type":                               "success",
    "url":                                "https://xeggex.com"
  }
}

// Maps the API commands to RPC. Blank ("") means disabled.
exports.api_cmds = {
  // Use RPC or API endpoints. Always true until replaced by new concept.
  "use_rpc":                              true,
  "getnetworkhashps":                     "getnetworkhashps",
  "getmininginfo":                        "getmininginfo",
  "getdifficulty":                        "getdifficulty",
  "getconnectioncount":                   "getconnectioncount",
  "getblockcount":                        "getblockcount",
  "getblockhash":                         "getblockhash",
  "getblock":                             "getblock",
  "getrawtransaction":                    "getrawtransaction",
  "getinfo":                              "getinfo",
  "getblockchaininfo":                    "getblockchaininfo",
  "getpeerinfo":                          "getpeerinfo",
  "gettxoutsetinfo":                      "gettxoutsetinfo",
  "getvotelist":                          "masternodelist votes",
  "getmasternodecount":                   "getmasternodecount",
  "getmasternodelist":                    "listmasternodes",
  "verifymessage":                        "verifymessage",
  "validateaddress":                      "validateaddress",
  "getgovernanceinfo":                    "getgovernanceinfo"
}

// Blockchain specific settings.
exports.blockchain_specific = {
  "bitcoin": {
    // Set to false to not to store P2PK TX with addresses. Changes might require a full reindex of the blockchain to fix any P2PK TX.
    "enabled":                            false,
    // Maps the API commands to RPC. Blank ("") means disabled.
    "api_cmds": {
      "getdescriptorinfo":                "getdescriptorinfo",
      "deriveaddresses":                  "deriveaddresses"
    }
  },
  "heavycoin": {
    "enabled":                            false,
    "reward_page": {
      "enabled":                          true,
      "show_panels":                      false,
      "show_nethash_chart":               false,
      "show_difficulty_chart":            false,
      "page_header": {
        "show_img":                       true,
        "show_title":                     true,
        "show_last_updated":              true,
        "show_description":               true
      }
    },
    // Maps the API commands to RPC. Blank ("") means disabled.
    "api_cmds": {
      "getmaxmoney":                      "getmaxmoney",
      "getmaxvote":                       "getmaxvote",
      "getvote":                          "getvote",
      "getphase":                         "getphase",
      "getreward":                        "getreward",
      "getsupply":                        "getsupply",
      "getnextrewardestimate":            "getnextrewardestimate",
      "getnextrewardwhenstr":             "getnextrewardwhenstr"
    },
    // "api_page.enabled" must be true or all API commands are diabled. Disable a specific API command to not to be shown on the API page.
    "public_apis": {
      "getmaxmoney":                      { "enabled": true },
      "getmaxvote":                       { "enabled": true },
      "getvote":                          { "enabled": true },
      "getphase":                         { "enabled": true },
      "getreward":                        { "enabled": true },
      "getsupply":                        { "enabled": true },
      "getnextrewardestimate":            { "enabled": true },
      "getnextrewardwhenstr":             { "enabled": true }
    }
  }
}

exports.getAllNet = function getAllNet() {
  var r = []
  this.dbs.forEach(function(db) {
      r.push(db.id)
  })
  return r
}

exports.getDefaultNet = function getDefaultNet() {
  return this.dbs[0].id
}

exports.getNet = function getNet(net) {
  var r = this.wallets[0].id
  this.wallets.forEach(function(wallet) {
    if (wallet.id == net) {
      r = wallet.id
    }
  })
  return r
}

exports.getNetOrNull = function getNetOrNull(net) {
  var r = null
  this.wallets.forEach(function(wallet) {
    if (wallet.id == net)
      r = wallet.id
  })
  return r
}

exports.getCoin = function getCoin(net) {
  r = null
  coins = this.coins
  this.wallets.forEach(function(wallet) {
    if (wallet.id == net) {
      debug("Found coin '%s' for net '%s'.", wallet.coin, net)
      coin = coins.forEach(function(coin) {
        if (coin.id == wallet.coin) {
          r = coin
        }
      })
    }
  })
  if (r == null)
    r = this.coins[0]
  return r
}

exports.getWallet = function getWallet(net) {
  r = null
  this.wallets.forEach(function(wallet) {
    if (wallet.id == net) {
      debug("Found wallet '%s' for net '%s'.", wallet.coin, net)
      r = wallet
    }
  })
  if (r == null)
    r = this.wallets[0]
  return r
}

exports.getRemoteIp = function getRemoteIp(req) {
  r = req.socket.remoteAddress
  const forwarded = req.header('x-forwarded-for')
  if (forwarded) {
    r = forwarded
  }
  debug("Received request by remote IP '%s'.", r)
  return r
}

exports.formatDateTime = function formatDateTime(unixtime, net=this.dbs[0].id, alt, locale='en-US') {
  const shared_pages = exports.get(net, 'shared_pages')
  var alt = false
  if (shared_pages.date_time.enable_alt_timezone_tooltips === true)
      alt = true
  const mdate = new Date(unixtime * 1000)
  var r = ''
  // Check if this date should be displayed in UTC or local timezone.
  if (shared_pages.date_time.timezone.toLowerCase() == 'local')
    r = '<span class="rdate">' + mdate.toLocaleDateString() + '</span>&nbsp;<span class="rtime" ' + (alt === true ? ' data-bs-toggle="tooltip" data-bs-placement="auto" title="' + mdate.toUTCString() + '"' : '') + '>' + mdate.toLocaleTimeString() + '</span>'
  else
    r = '<span class="rdate">' + mdate.toDateString() + '</span>&nbsp;<span class="rtime"' + (alt === true ? ' data-bs-toggle="tooltip" data-bs-placement="auto" title="' + mdate.toUTCString() + '"' : '') + '>' + mdate.toTimeString() + '</span>'
  return r
}

exports.formatCurrency = function formatCurrency(quantity, symbol, locale='en') {
  return Number(quantity).toLocaleString(locale,{'minimumFractionDigits':this.currencies[symbol].minfd,'maximumFractionDigits':this.currencies[symbol].maxfd,'useGrouping':true})
}

exports.formatDecimal = function formatDecimal(n, min, max, locale='en') {
  return Number(n).toLocaleString(locale,{'minimumFractionDigits':min,'maximumFractionDigits':max,'useGrouping':true})
}

exports.formatInt = function formatInt(n, locale='en') {
  return Number(n).toLocaleString(locale,{'minimumFractionDigits':0,'maximumFractionDigits':0,'useGrouping':true})
}

exports.formatUnixtime = function formatUnixtime(n, net, locale='en') {
  const shared_pages = exports.get(net, 'shared_pages')
  const mdate = new Date(n * 1000)
  var r = ''
  if (shared_pages.date_time.timezone.toLowerCase() == 'local')
    r = mdate.toLocaleString()
  else
    r = mdate.toUTCString()
  return r
}

exports.formatShortId = function (id, start, end) {
  return id ? id.substring(0, start) + '...' + id.substring(id.length - end, id.length) : 'n/a'
}

exports.isMultiAlgo = function isMultiAlgo(net) {
  return Array.isArray(exports.get(net, 'algos')) && exports.get(net, 'algos').size;
}

exports.isBitoreum = function isBitoreum(net) {
  return net == 'bitoreum'
}

exports.isRaptoreum = function isRaptoreum(net) {
  return net == 'raptoreum'
}

exports.isPepew = function isPepew(net) {
  return net == 'pepew'
}

exports.isVkax = function isVkax(net) {
  return net == 'vkax'
}

exports.isMagpie = function isMagpie(net) {
  return net == 'magpiecoin'
}

exports.getAlgoFromBlock = function getAlgoFromBlock(block, net) {
  var algo = 'ghostrider'
  if (exports.isMultiAlgo(net)) {
    algo = block.algo
  } else if (exports.isPepew(net)) {
    algo = "memehash"
  } else if (exports.isVkax(net)) {
    algo = "mike"
  } else if (exports.isMagpie(net)) {
    algo = "yespower"
  }
  return algo
}

exports.getDbConnectionString = function getDbConnectionString(net) {
  const db = exports.getDbOrNull(net)
  var s = 'mongodb://' + encodeURIComponent(db.user)
  s = s + ':' + encodeURIComponent(db.password)
  s = s + '@' + db.address
  s = s + ':' + db.port
  s = s + '/' + db.database
  return s
}

exports.getDbOrNull = function getDbOrNull(net=this.dbs[0].id) {
  var r = this.dbs[0]
  this.dbs.forEach(function(db) {
    if (db.id == net) {
      r = db
    }
  })
  return r
}

exports.getTitleLogo = function getTitleLogo(net=this.dbs[0].id) {
  var r = this.wallets[0].id
  this.wallets.forEach(function(wallet) {
    if (wallet.id == net) {
      r = wallet.logo_title
    }
  })
  return r
}

exports.getLogo = function getLogo(net=this.dbs[0].id) {
  var r = this.wallets[0].id
  this.wallets.forEach(function(wallet) {
    if (wallet.id == net) {
      r = wallet.logo
    }
  })
  return r
}

exports.panelOffset = function panelOffset(net=this.dbs[0].id) {
  const panels = exports.panels(net)
  var r = 0
  Object.keys(panels).forEach((key) => {
    if (panels[key].enabled == true) {
      r = r + 1
    }
  })
  debug("Got panels count for chain '%s' -> %d.", net, r)
  return 5 + 1 - r
}

exports.panel = function panel(index, net=this.dbs[0].id) {
  const panels = exports.panels(net)
  var r = []
  var i = 0
  Object.keys(panels).every((key) => {
    if (panels[key] && panels[key].enabled == true) {
      i = i+1
    }
    if (index == i) {
      debug("Got panel for chain '%s' and index %s -> %o.", net, index, key)
      r = key
      return false
    }
    return true
  })
  return r
}

// TODO: Fix exports.panels
exports.panels = function panels(net=this.dbs[0].id) {
  var r
  if (exports['net'][net] && exports['net'][net].shared_pages) {
    r = exports['net'][net].shared_pages.page_header.panels
  } else {
    r = exports.get(net, 'shared_pages').page_header.panels
  }
  debug("Got panels for chain '%s' -> %o.", net, r)
  return r
}

exports.anyHeader = function anyHeader(page, net=this.dbs[0].id) {
  return page.page_header.show_img == true || page.page_header.show_title == true || (page.page_header.show_last_updated && page.page_header.show_last_updated == true) || page.page_header.show_description == true
}

exports.allHeaders = function allHeaders(page, net=this.dbs[0].id) {
  return page.page_header.show_img == true && page.page_header.show_title == true && page.page_header.show_last_updated &&  page.page_header.show_description == true && ((page.page_header.show_last_updated && page.page_header.show_last_updated == true) || page.page_header.show_last_updated == false)
}

// call with settings.get(net, 'first-level-key-like-shared-pages-or-claim_address_page')
// TODO: FIX NET IS NULL
exports.get = function get(net, key) {
  debug("Get '%s' for chain '%s'.", key, net)
  const orig = exports[key]
  var value = null
  
  if (exports['net']) {
    value = structuredClone(exports['net'])
    if (value[net]) 
      value = value[net]
    else
      return orig
    if (value[key]) {
      value = value[key]
      Object.keys(orig).forEach((key1) => {
        if (typeof(value[key1]) === 'undefined') {
          if (key != 'algos') {
            debug("Use key %s from default -> %o", key1, orig[key1])
            value[key1] = orig[key1]
          }
        } else {
          if (value[key1] === Object(value[key1])) {
            // deep copy and merge
            if (key1 == 'exchanges') {
              // value[key1]
            } else {
              debug("Merge %s -> %o", key1, value[key1])
              const toOverwrite = structuredClone(value[key1])
              value[key1] = structuredClone(orig[key1])
              _.add(value[key1], toOverwrite)
              _.merge(value[key1], toOverwrite)
            }
          } else {
            // NOOP
          }
        }
      })
    }
    else
      return orig
  }
  debug("Got '%s' with value '%s' for chain '%o'.", key, value, net)
  return value
}

exports.hasUpstream = function hasUpstream(net, peers) {
  return exports.needsUpstream(net)  && peers.length > 0
}

exports.needsUpstream = function needsUpstream(net) {
  const db = exports.getDbOrNull(net)
  return db && db.peers && db.peers.mode && db.peers.mode === 'upstream'
}

exports.loadSettings = function loadSettings() {
  const settings_filename = process.env.SETTINGS || "./settings.json"
  // exception list of setting.json paths (period separated) that do not have defaults and should not throw an 'unknown setting' error
  var exceptions = ['labels', 'net']
  var settings
  var json_settings
  
  // read settings.json into a string if present
  if (fs.existsSync(settings_filename)) {
    try {
      settings = fs.readFileSync(settings_filename).toString()
    } catch(e) {
      console.error("The '%s' file is missing. Stop.", settings_filename)
      process.exit(0)
    }
  } else {
    console.error("The '%s' file is missing. Stop.", settings_filename)
    process.exit(0)
  }

  // minify settings.json and populate JSON object json_settings
  try {
    if (settings) {
      // get settings string ready for json conversion
      settings = jsonminify(settings).replace(",]","]").replace(",}","}")
      json_settings = JSON.parse(settings)
    }
  } catch(e) {
    console.error("There was an error processing your '%s' file: %s. Stop.", settings_filename, e.message)
    process.exit(0)
  }

  // merge settings.json and check for missing paths based on settings.js.
  if (json_settings != null) {
    for (var current_setting in json_settings) {
      merge_settings(json_settings, exceptions, json_settings[current_setting], current_setting)
    }
    
    // re-initialize the exceptions list
    exceptions = [
      'anyHeader',
      'allHeaders',
      'get',
      'getAllNet',
      'getDefaultNet',
      'getNet',
      'getNetOrNull',
      'getCoin',
      'getWallet',
      'getRemoteIp',
      'isMultiAlgo',
      'isBitoreum',
      'isRaptoreum',
      'isPepew',
      'isVkax',
      'isMagpie',
      'getAlgoFromBlock',
      'getDbConnectionString',
      'getDbOrNull',
      'getLogo',
      'getTitleLogo',
      'panelOffset',
      'panel',
      'panels',
      'loadSettings',
      'formatDateTime',
      'formatCurrency',
      'formatDecimal',
      'formatInt',
      'formatUnixtime',
      'formatShortId',
      'hasUpstream',
      'needsUpstream']

    for (var current_setting in exports) {
      check_missing_settings(json_settings, exceptions, exports[current_setting], current_setting)
    }
  }
}

// define a function to ensure json parent elements are not null
ensure_parent_elements_exist = function(json_settings, path) {
  var split = path.split('.')
  // check if the setting has parent elements
  if (split.length > 1) {
    var running_path = ''
    // loop through the parent elements and create dummy containers for each non-existant parent setting
    for (i = 0; i < split.length - 1; i++) {
      // add to the running path
      running_path += (running_path == '' ? '' : '.') + split[i]
      // get the current setting value
      var current_value = Object.byString(json_settings, running_path)
      // check if this setting exists
      if (current_value == null || typeof current_value !== 'object') {
        // the setting does not exist or it is not an object, so overwrite the value with a dummy container for now
        eval('json_settings' + fix_object_path(running_path) + ' = {}')
      }
    } 
  }

  return json_settings
}

// define a recursive function used to merge settings from different json objects
merge_settings = function(json_settings, exceptions, current_setting, path) {
  // check if this is an object with more properties
  if (typeof current_setting === 'object' && current_setting !== null) {
    // this is an object
    // check if this object already exists in the default settings (settings.js)
    if (Object.byString(exports, path) == null) {
      // this setting object does not exist in settings.js
      console.warn("Unknown setting object '%s' has been ignored. This setting doesn't exist or was removed.", path)
    } else {
      // the object exists in the loaded settings
      // check if the object is an array or is one of the exceptions
      if (Array.isArray(current_setting) || exceptions.indexOf(path) > -1) {
        // the object is an array or is an exception
        // merge the object into settings.js without checking object keys
        eval('exports' + fix_object_path(path) + ' = ' + JSON.stringify(Object.byString(json_settings, path)))
      } else {
        // the object is not an array or an exception
        // loop through the object keys to continue checking for missing properties
        for (var setting_name in current_setting) {
          // recursively step through all properties of this object and merge setting values
          merge_settings(json_settings, exceptions, current_setting[setting_name], path + '.' + setting_name)
        }
      }
    }
  } else {
    // this is a property
    // check if this property already exists in the default settings (settings.js)
    if (Object.byString(exports, path) == null) {
      // this setting property does not exist in settings.js
      console.warn("Unknown setting property '%s' has been ignored. This setting doesn't exist or was removed.", path)
    } else {
      // the property exists in the loaded settings
      // get the settings.json value
      var setting_value = Object.byString(json_settings, path)
      // overwrite the property value with the value from settings.json
      eval('exports' + fix_object_path(path) + ' = ' + (typeof setting_value === "string" ? '"' : '') + setting_value + (typeof setting_value === "string" ? '"' : ''))
    }
  }
}

/* Check settings for missing entries between json objects */
check_missing_settings = function(json_settings, exceptions, current_setting, path) {
  // check if this is an object with more properties
  if (typeof current_setting === 'object' && current_setting !== null) {
    // this is an object
    // check if this object exists in the json settings (settings.json)
    if (Object.byString(json_settings, path) == null) {
      // this setting object does not exist in settings.json
      // check if it is an exception
      if (exceptions.indexOf(path) == -1) {
        // this is not one of the exceptions
        if (!path.startsWith('shared_pages.page_header.network_charts.'))
          console.warn("setting '%s' is missing. Loading default value.", path)
      }
    } else {
      // the object exists in the json settings
      // loop through the object keys to continue checking for missing properties
      for (var setting_name in current_setting) {
        // recursively step through all properties of this object
        check_missing_settings(json_settings, exceptions, current_setting[setting_name], path + '.' + setting_name)
      }
    }
  } else {
    // this is a property
    // check if this property exists in the json settings (settings.json)
    if (Object.byString(json_settings, path) == null) {
      // this setting property does not exist in settings.json
      // check if it is an exception
      if (exceptions.indexOf(path) == -1) {
        // this is not one of the exceptions
        if (!path.startsWith('shared_pages.page_header.network_charts.'))
          console.warn("setting '%s' is missing. Loading default value.", path)
      }
    }
  }
}

/* Fix object paths. */
fix_object_path = function(path) {
  return "['" + path.replace(/\./g, "']['") + "']";
}

/* Special thanks to Alnitak for the Object.byString function: https://stackoverflow.com/a/6491621/3038650 */
Object.byString = function(o, s) {
  s = s.replace(/\[(\w+)\]/g, '.$1') // convert indexes to properties
  s = s.replace(/^\./, '')          // strip a leading dot
  var a = s.split('.')
  for (var i = 0, n = a.length; i < n; ++i) {
    var k = a[i]
    if (typeof o === 'object' && o !== null && k in o)
      o = o[k]
    else
      return
  }
  return o
}

// populate settings
exports.loadSettings()