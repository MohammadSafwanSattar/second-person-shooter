const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const server = http.createServer((request, response) => {
    const filePath = request.url === "/" ? "index.html" : request.url.slice(1);
    const resolvedPath = path.join(__dirname, filePath);

    if (!resolvedPath.startsWith(__dirname)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
    }

    fs.readFile(resolvedPath, (error, file) => {
        if (error) {
            response.writeHead(404);
            response.end("Not found");
            return;
        }
        response.writeHead(200, { "Content-Type": filePath.endsWith(".html") ? "text/html" : "text/plain" });
        response.end(file);
    });
});

const wss = new WebSocketServer({ server });
let waitingPlayer = null;
const opponents = new Map();

function send(socket, message) {
    if (socket && socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(message));
    }
}

wss.on("connection", (socket) => {
    if (waitingPlayer) {
        const firstPlayer = waitingPlayer;
        waitingPlayer = null;
        opponents.set(firstPlayer, socket);
        opponents.set(socket, firstPlayer);
        send(firstPlayer, { type: "matched", role: 1 });
        send(socket, { type: "matched", role: 2 });
    } else {
        waitingPlayer = socket;
        send(socket, { type: "waiting" });
    }

    socket.on("message", (rawMessage) => {
        const opponent = opponents.get(socket);
        if (!opponent) return;

        try {
            const message = JSON.parse(rawMessage);
            if (["state", "hit", "defeated"].includes(message.type)) send(opponent, message);
        } catch {
            // Ignore malformed client messages.
        }
    });

    socket.on("close", () => {
        if (waitingPlayer === socket) waitingPlayer = null;
        const opponent = opponents.get(socket);
        if (opponent) {
            opponents.delete(opponent);
            send(opponent, { type: "opponentLeft" });
        }
        opponents.delete(socket);
    });
});

const port = process.env.PORT || 3000;
server.listen(port, "0.0.0.0", () => console.log(`Second Person Shooter running on http://localhost:${port}`));
