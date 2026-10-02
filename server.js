
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(
        new URL(request.url, `http://${request.headers.host}`).pathname
    );

    const filePath = pathname === "/"
        ? path.join(__dirname, "index.html")
        : path.resolve(__dirname, "." + pathname);

    if (
        !filePath.startsWith(__dirname + path.sep) &&
        filePath !== path.join(__dirname, "index.html")
    ) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
    }

    fs.readFile(filePath, (error, file) => {
        if (error) {
            response.writeHead(404);
            response.end("Not found");
            return;
        }

        const ext = path.extname(filePath).toLowerCase();

        const contentTypes = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".gif": "image/gif",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon",
            ".json": "application/json"
        };

        response.writeHead(200, {
            "Content-Type": contentTypes[ext] || "application/octet-stream"
        });

        response.end(file);
    });
});

const wss = new WebSocketServer({ server });

let waitingPlayer = null;

const opponents = new Map();
const playerStates = new Map();

// Track every connected browser using the WebSocket.
const visitors = new Set();

// Track visitors who have entered a game.
const playersInGame = new Set();

function send(socket, message) {
    if (socket && socket.readyState === 1) {
        socket.send(JSON.stringify(message));
    }
}

function getCounts() {
    return {
        type: "liveCounts",
        visitors: visitors.size,
        playersInGame: playersInGame.size,
        onlineMatches: Math.floor(opponents.size / 2)
    };
}

function broadcastCounts() {
    const counts = getCounts();

    for (const socket of wss.clients) {
        send(socket, counts);
    }
}

wss.on("connection", (socket) => {
    visitors.add(socket);

    // Send the current counts to everyone.
    broadcastCounts();

    if (waitingPlayer && waitingPlayer.readyState === 1) {
        const firstPlayer = waitingPlayer;
        waitingPlayer = null;

        opponents.set(firstPlayer, socket);
        opponents.set(socket, firstPlayer);

        playerStates.set(firstPlayer, {
            health: 100,
            maxHealth: 100,
            alive: true
        });

        playerStates.set(socket, {
            health: 100,
            maxHealth: 100,
            alive: true
        });

        send(firstPlayer, { type: "matched", role: 1 });
        send(socket, { type: "matched", role: 2 });

        broadcastCounts();
    } else {
        waitingPlayer = socket;
        send(socket, { type: "waiting" });
    }

    socket.on("message", (rawMessage) => {
        try {
            const message = JSON.parse(rawMessage);

            // The website must send this when a player
            // enters or leaves an offline or online game.
            if (message.type === "gameStatus") {
                if (message.playing === true) {
                    playersInGame.add(socket);
                } else {
                    playersInGame.delete(socket);
                }

                broadcastCounts();
                return;
            }

            const opponent = opponents.get(socket);

            if (!opponent) return;

            if (message.type === "state") {
                const health = Number(message.health);
                const maxHealth = Number(message.maxHealth);

                playerStates.set(socket, {
                    health: Number.isFinite(health) ? health : 100,
                    maxHealth: Number.isFinite(maxHealth) ? maxHealth : 100,
                    alive: message.alive !== false
                });

                send(opponent, message);
            }

            if (message.type === "hit") {
                const targetState = playerStates.get(opponent) || {
                    health: 100,
                    maxHealth: 100,
                    alive: true
                };

                if (!targetState.alive) return;

                const damage = Math.max(
                    0,
                    Math.min(Number(message.damage) || 0, 150)
                );

                targetState.health = Math.max(
                    0,
                    targetState.health - damage
                );

                targetState.alive = targetState.health > 0;
                playerStates.set(opponent, targetState);

                send(opponent, {
                    type: "damage",
                    health: targetState.health,
                    maxHealth: targetState.maxHealth
                });

                send(socket, {
                    type: "opponentHealth",
                    health: targetState.health,
                    maxHealth: targetState.maxHealth
                });

                if (!targetState.alive) {
                    send(opponent, {
                        type: "gameResult",
                        result: "ELIMINATED",
                        message: "Your opponent won this round."
                    });

                    send(socket, {
                        type: "gameResult",
                        result: "VICTORY",
                        message: "Your opponent was eliminated."
                    });
                }
            }
        } catch {
            // Ignore malformed messages.
        }
    });

    socket.on("close", () => {
        visitors.delete(socket);
        playersInGame.delete(socket);

        if (waitingPlayer === socket) {
            waitingPlayer = null;
        }

        const opponent = opponents.get(socket);

        if (opponent) {
            opponents.delete(opponent);
            playerStates.delete(opponent);

            send(opponent, { type: "opponentLeft" });
        }

        opponents.delete(socket);
        playerStates.delete(socket);

        broadcastCounts();
    });
});

const port = process.env.PORT || 3000;

server.listen(port, "0.0.0.0", () => {
    console.log(`Second Person Shooter running on port ${port}`);
});