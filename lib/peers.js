class Peers {

  static PEER_VERSION                     = 0

  static UPSTREAM_HANDSHAKE               = 'upstream.handshake/'
  static UPSTREAM_PING                    = 'upstream.ping/'
  static UPSTREAM_PONG                    = 'upstream.pong/'
  static UPSTREAM_GET_COINSTATS           = 'upstream.get_coinstats/'
  static UPSTREAM_GET_DBINDEX             = 'upstream.get_dbindex/'
  static UPSTREAM_GET_ADDRESS             = 'upstream.get_address/'
  static UPSTREAM_GET_ADDRESS_TXES        = 'upstream.get_addresstxes/'
  static UPSTREAM_GET_TXES_BY_BLOCKHASH   = 'upstream.get_txsbyblockhash/'
  static UPSTREAM_GET_LAST_TXES           = 'upstream.get_lasttxs/'
  static UPSTREAM_GET_PEERS               = 'upstream.get_peers/'
  static UPSTREAM_GET_MASTERNODES         = 'upstream.get_masternodes/'
  static UPSTREAM_GET_RICHLIST            = 'upstream.get_richlist/'

}

module.exports.Peers = Peers