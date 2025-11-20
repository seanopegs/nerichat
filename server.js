const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve semua file statis (index.html, css, js) dari folder ini
app.use(express.static(path.join(__dirname)));

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("message", (message) => {
    // Broadcast ke semua client
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message.toString());
      }
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

const PORT = process.env.PORT || 25577; // Ptero biasanya pakai PORT env
const HOST = "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`Server berjalan di http://${HOST}:${PORT}`);
});
