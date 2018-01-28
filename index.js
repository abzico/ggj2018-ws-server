const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database("/var/lib/ggj2018/ggj2018.db");
const wss = new WebSocket.Server({ port: 6666 });

// management commands
var kInitialConnection = "__initial";
var kCommand_createRoom = "createRoom";
var kCommand_joinRoom = "joinRoom";
var kCommand_quitRoom = "quitRoom";
var kCommand_listRoom = "listRoom";
var kCommand_ping = "ping";
var kCommand_heartbeat = "heartbeat";

// game commands
var kCommand_goUp = "game:goUp";
var kCommand_goLeft = "game:goLeft";
var kCommand_goRight = "game:goRight";
var kCommand_goDown = "game:goDown";

function createResponseMsgStr(ok, data=null, cmd=null) {
  return JSON.stringify({
    ok: ok,
    cmd: cmd,
    response: data
  });
}

function generateRandomString(length){
  if (length <= 0 || length == null || typeof length !== 'number') return null;

  var text = "";
  var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  for (var i = 0; i < length; i++)
    text += possible.charAt(Math.floor(Math.random() * possible.length));

  return text;
}

function noop() {}
function heartbeat() {
  this.isAlive = true;
}

// TODO: Will need to adapt this
function randomPositionForPlayer() {
  return Math.floor(Math.random() * 10);
}

const interval = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) return ws.terminate();
  })
})

wss.on('connection', function(ws, req) {
  console.log('new connection from client ip[' + req.headers['x-forwarded-for'] + ']');

  //ws.isAlive = true;
  //ws.on('pong', heartbeat);

  ws['_playerData'] = {};

  // generate id and assign to such player
  ws._playerData['id'] = generateRandomString(6);
  // send back message
  ws.send(createResponseMsgStr(true, ws._playerData.id, kInitialConnection));
  // cache room id for later (optimize performance)
  ws._playerData['roomId'] = -1;

  var id = ws._playerData.id;

  ws.on('error', (e) => { 
    console.log(e);
  });

  ws.on('close', () => {
    console.log('client ' + id + ' closed connection');
    // update all rows to set this player id to null, so it allow room for other player to join
    db.run(`update room set player1Id = null where player1Id = '${id}'`, function(e) {
      if (e) {
        console.log('error trying to set null for player1Id');
        ws.send(createResponseMsgStr(false, e.message, cmd));
      }
      else {
        if (this.changes > 0)
          console.log('set null for player1Id [' + id +'] for all rooms from db');

        // player 2
        db.run(`update room set player2Id = null where player2Id = '${id}'`, function(e) {
          if (e) {
            console.log('error trying to set null for player2Id');
            ws.send(createResponseMsgStr(false, e.message, cmd));
          }
          else {
            if (this.changes > 0)
              console.log('set null for player2Id [' + id +'] for all rooms from db');

            // take this chance to clear all empty room
            db.run(`delete from room where player1Id is null AND player2Id is null`, function(e) {
              if (e) {
                console.log('error trying to delete empty room');
                ws.send(createResponseMsgStr(false, e.message, cmd));
              }
              else {
                console.log('deleted all empty rooms from db');
              }
            });
          }
        });
      }
    });
  });

	ws.on('message', function(message) {
		console.log('received message: ' + message);
    
    // get command input
    var cmdObj = null;
    try {
      cmdObj = JSON.parse(message);
    }
    catch(e) {
      ws.send(createResponseMsgStr(false, "Invalid message format"));
      return;
    }

    // check whether we get null at the end of nor
    if (!cmdObj) {
      ws.send(createResponseMsgStr(false, "Invalid message format"));
      return;
    }

    // ok
    // get command
    var cmd = cmdObj.cmd;
    try {
      switch(cmd) {
        case kCommand_heartbeat:
          // just send anything back to keep connection alive
          ws.send(createResponseMsgStr(true, "OK", cmd));
          break;
        case kCommand_ping:
          ws.send(createResponseMsgStr(true, "PONG", cmd));
          break;
        case kCommand_createRoom:
        {
          db.run(`insert into room (player1Id) values ('${cmdObj.data.playerId}')`, function(e) {
            if (e) {
              ws.send(createResponseMsgStr(false, e.message, cmd));
            }
            else {
              // cache room id for use later
              ws._playerData.roomId = this.lastID;
              ws.send(createResponseMsgStr(true, { roomId: this.lastID }, cmd));
            }
          });
          break;
        }
        case kCommand_listRoom:
        {
          // result to response back
          var retArr = [];

          db.each(`select * from room where player1Id != '${id}' or player2Id != '${id}'`, function(e, row) {
            if (e) {
              ws.send(createResponseMsgStr(false, e.message, cmd));
            }
            else {
              var cond1 = (row.player1Id == null || row.player1Id == undefined) && (row.player2Id != null && row.player2Id != undefined);
              var cond2 = (row.player2Id == null || row.player2Id == undefined) && (row.player1Id != null && row.player1Id != undefined);

              // filter to only row that has one slot available
              if (cond1 || cond2) {
                retArr.push(row);
              }
            }
          }, function() {
            ws.send(createResponseMsgStr(true, retArr, cmd));
          });
          break;
        }
        case kCommand_quitRoom:
        {
          var retArr = [];

          db.each(`select * from room where player1Id = '${id}' or player2Id = '${id}'`, function(e, row) {
            if (e) {
              ws.send(createResponseMsgStr(false, e.message, cmd));
            }
            else {
              retArr.push(row);
            }
          }, function() {
            if (retArr.length > 0) {
              // try to set null for all rooms
              db.run(`update room set player1Id = null where player1Id = '${id}'`, function(e) {
                if (e) {
                  ws.send(createResponseMsgStr(false, e.message, cmd));
                }
                else {
                  db.run(`update room set player2Id = null where player2Id = '${id}'`, function(e) {
                    if (e) {
                      ws.send(createResponseMsgStr(false, e.message, cmd));
                    }
                    else {
                      // reset room id
                      ws._playerData.roomId = -1;
                      // yes, done either for player1Id or player2Id
                      ws.send(createResponseMsgStr(true, "You've quit the room", cmd));
                    }
                  });
                }
              });
            }
            else {
              ws.send(createResponseMsgStr(true, "You currently didn't join any room", cmd));
            }
          });

          break;
        }
        case kCommand_joinRoom:
        {
          // parameter: roomId
          if (cmdObj.data.roomId === undefined || cmdObj.data.roomId == null) {
            ws.send(createResponseMsgStr(false, "Invalid roomId parameter", cmd));
          }
          else {
            // check if such room id exists
            db.all(`select * from room where roomId = ${cmdObj.data.roomId}`, function(e, rows) {
              if (e) {
                ws.send(createResponseMsgStr(false, e.message, cmd));
              }
              else {
                if (rows.length > 0) {
                  // found it, join as intend
                  db.run(`update room set player1Id = '${id}' where roomId = ${cmdObj.data.roomId} and player1Id is null`, function(e) {
                    if (e) {
                      ws.send(createResponseMsgStr(false, e.message, cmd));
                    }
                    else {
                      if (this.changes > 0) {
                        // cache room id
                        ws._playerData.roomId = cmdObj.data.roomId;

                        // random players' location
                        var loc1 = { x: randomPositionForPlayer(), y: randomPositionForPlayer() };
                        var loc2 = { x: randomPositionForPlayer(), y: randomPositionForPlayer() };
                        var color1 = '#ff0000';
                        var color2 = '#0000ff';

                        // if it's truly happened
                        ws.send(createResponseMsgStr(true, { loc1: loc1, loc2: loc2, color1: color1, color2: color2, desc: "You've joined the room" }, cmd));

                        console.log('1another player id: ' + rows[0].player2Id);

                        // notify another player
                        var found = false;
                        wss.clients.forEach(function(client) {
                          if (client._playerData.id === rows[0].player2Id && !found) {
                            found = true;
                            client.send(createResponseMsgStr(true, { loc1: loc1, loc2: loc2, color1: color1, color2: color2, ready: true, des: "Another player has joined the room" }, cmd));
                            console.log("notify another player");
                          }
                        });
                      }
                      else {
                        // not yet, need to update for player2Id
                        db.run(`update room set player2Id = '${id}' where roomId = ${cmdObj.data.roomId} and player2Id is null`, function(e) {
                          if (e) {
                            ws.send(createResponseMsgStr(false, e.message, cmd));
                          }
                          else {
                            if (this.changes > 0) {
                              // cache room id
                              ws._playerData.roomId = cmdObj.data.roomId;

                              // random players' location
                              var loc1 = { x: randomPositionForPlayer(), y: randomPositionForPlayer() };
                              var loc2 = { x: randomPositionForPlayer(), y: randomPositionForPlayer() };
                              var color1 = '#ff0000';
                              var color2 = '#0000ff';

                              // if it's truly happened
                              ws.send(createResponseMsgStr(true, { loc1: loc1, loc2: loc2, color1: color1, color2: color2, desc: "You've joined the room"}, cmd));

                              console.log('another player id: ' + rows[0].player1Id);

                              // notify another player
                              var found = false;
                              wss.clients.forEach(function(client) {
                                if (client._playerData.id === rows[0].player1Id && !found) {
                                  found = true;
                                  client.send(createResponseMsgStr(true, { loc1: loc1, loc2: loc2, color1: color1, color2: color2, ready: true, des: "Another player has joined the room" }, cmd));
                                  console.log("notify another player");
                                }
                              });
                            }
                            else {
                              ws.send(createResponseMsgStr(false, "Cannot find room to join", cmd));
                            }
                          }
                        });
                      }
                    }
                  });
                }
                else {
                  // not found
                  ws.send(createResponseMsgStr(false, "Room ID not found", cmd));
                }
              }
            });
          }
          break;
        }
        case kCommand_goUp:
          // check if player is in a room with another player
          db.all(`select * from room where player1Id = '${id}' or player2Id = '${id}'`, function(e, rows) {
            if (e) {
              ws.send(createResponseMsgStr(false, e.message, cmd));
            }
            else {
              if (rows.length > 0) {
                // found
                // send message back for such command to be processed from same state on both side on client side
                var anotherPlayerId = rows[0].player1Id;
                if (id == anotherPlayerId) {
                  // another player id should be on player 2
                  anotherPlayerId = rows[0].player2Id;
                }

                ws.send(createResponseMsgStr(true, { you: true, desc: "You can go up" }, cmd));
                // find from list of clients to send
                var found = false;
                wss.clients.forEach(function(client) {
                  if (client._playerData.id === anotherPlayerId && !found) {
                    found = true;
                    client.send(createResponseMsgStr(true, { you: false, desc: "Another player will go up" }, cmd));
                  }
                });
              }
            }
          });
          break;
        default:
          ws.send(createResponseStr(false, "Unrecognized command"));
          break;
      }
    }
    catch(e) {
      console.log('error: ', e);
      ws.send(createResponseMsgStr(false, "Server internal error. Try again later.", cmd));
    }
	});
});

console.log('server started');
