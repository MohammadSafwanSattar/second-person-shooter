
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

        response.writeHead(200, {
            "Content-Type": filePath.endsWith(".html")
                ? "text/html"
                : "text/plain"
        });

        response.end(file);
    });
});

const wss = new WebSocketServer({ server });

let waitingPlayer = null;

const opponents = new Map();

const playerStates = new Map();

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
    } else {
        waitingPlayer = socket;

        send(socket, { type: "waiting" });
    }

    socket.on("message", (rawMessage) => {
        const opponent = opponents.get(socket);

        if (!opponent) return;

        try {
            const message = JSON.parse(rawMessage);

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

        playerStates.delete(socket);
    });
});

const port = process.env.PORT || 3000;

server.listen(port, "0.0.0.0", () => {
    console.log(
        `Second Person Shooter running on http://localhost:${port}`
    );
});