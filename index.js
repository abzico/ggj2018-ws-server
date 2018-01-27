const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 6666 });

wss.on('connection', function(ws, req) {
	console.log('new connection from client ip[' + req.headers['x-forwarded-for'] + ']');

	ws.on('message', function(message) {
		console.log('received message: ' + message);

		ws.on('error', (e) => { console.log(e); });
    
		try {
      if (message.toLowerCase() == 'ping') {
        ws.send("PONG");
      }
      else {
        ws.send(message);
      }
		}
		catch(e) {
			console.log('error: ', e);
		}
	});
});

console.log('server started');
