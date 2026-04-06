const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname)); // Fallback if files are uploaded directly to the root folder

const PORT = process.env.PORT || 3000;

// Game Config
const TICK_RATE = 60;
const FIELD_WIDTH = 1200;
const FIELD_HEIGHT = 600;
const GOAL_TOP = 200;
const GOAL_BOTTOM = 400;
const BALL_FRICTION = 0.99;
const PLAYER_FRICTION = 0.92;

const ROOMS = new Map();

function generateId() {
    return Math.random().toString(36).substring(2, 9);
}

io.on('connection', socket => {
    let currentRoom = null;

    socket.on('getRooms', (cb) => {
        const roomList = Array.from(ROOMS.values()).map(r => ({
            id: r.id, name: r.name, hasPassword: !!r.password, 
            playersCount: r.players.size, maxPlayers: r.maxPlayers
        }));
        cb(roomList);
    });

    socket.on('createRoom', (data, cb) => {
        const id = generateId();
        const room = {
            id, name: data.name, password: data.password || '', maxPlayers: data.maxPlayers,
            mode: data.mode || 'single', // 'single' or 'tournament'
            status: 'LOBBY',
            adminId: socket.id,
            players: new Map(),
            ball: { x: FIELD_WIDTH/2, y: FIELD_HEIGHT/2, vx: 0, vy: 0, radius: 10, mass: 1 },
            score: { red: 0, blue: 0 },
            timeRemaining: 0,
            timeLimit: 3,
            scoreLimit: 3,
            ticksPassed: 0,
            tournament: {
                leg: 1,
                aggRed: 0,
                aggBlue: 0
            }
        };
        ROOMS.set(id, room);
        
        joinRoom(socket, id, data.nickname, data.color, data.number);
        currentRoom = id;
        cb({ success: true, roomId: id });
    });

    socket.on('joinRoom', (data, cb) => {
        const room = ROOMS.get(data.roomId);
        if (!room) return cb({ success: false, error: 'Room not found' });
        if (room.players.size >= room.maxPlayers) return cb({ success: false, error: 'Room full' });
        if (room.password && room.password !== data.password) return cb({ success: false, error: 'Wrong password' });
        
        joinRoom(socket, data.roomId, data.nickname, data.color, data.number);
        currentRoom = data.roomId;
        cb({ success: true });
    });

    socket.on('changeTeam', () => {
        // Obsolete: Admin strictly manages teams via adminMovePlayer
    });

    socket.on('adminMovePlayer', (data) => {
        if (!currentRoom) return;
        const room = ROOMS.get(currentRoom);
        if (!room || room.adminId !== socket.id || room.status !== 'LOBBY') return;
        
        const p = room.players.get(data.playerId);
        if (p && ['red', 'blue', 'spec'].includes(data.team)) {
            p.team = data.team;
            broadcastLobbyUpdate(room);
        }
    });

    socket.on('startGame', (opts) => {
        if (!currentRoom) return;
        const room = ROOMS.get(currentRoom);
        if (!room || room.adminId !== socket.id || room.status !== 'LOBBY') return;
        
        room.timeLimit = opts.timeLimit || 3;
        room.scoreLimit = opts.scoreLimit || 3;

        if (room.mode === 'tournament') {
            generateBracket(room);
            room.status = 'BRACKET';
            io.to(room.id).emit('showBracket', getBracketData(room));
        } else {
            room.status = 'PLAYING';
            room.score = { red: 0, blue: 0 };
            room.timeRemaining = room.timeLimit * 60;
            room.ticksPassed = 0;
            resetPositions(room);
            io.to(room.id).emit('gameStarted');
        }
    });

    socket.on('advanceBracket', () => {
        if (!currentRoom) return;
        const room = ROOMS.get(currentRoom);
        if (!room || room.adminId !== socket.id || room.status !== 'BRACKET') return;
        
        // Find next pending match
        const match = getNextMatch(room);
        if (!match) return; // Tournament over
        
        room.currentMatch = match;
        room.status = 'PLAYING';
        room.score = { red: 0, blue: 0 };
        room.timeRemaining = room.timeLimit * 60;
        room.ticksPassed = 0;
        room.tournament = { leg: 1, aggRed: 0, aggBlue: 0 };
        
        // Assign match players to red/blue
        room.players.forEach(p => p.team = 'spec');
        
        if (match.team1) {
            match.team1.playerIds.forEach(id => {
                const p = room.players.get(id);
                if(p) p.team = 'red';
            });
        }
        if (match.team2) {
            match.team2.playerIds.forEach(id => {
                const p = room.players.get(id);
                if(p) p.team = 'blue';
            });
        }

        resetPositions(room);
        io.to(room.id).emit('gameStarted');
    });

    socket.on('returnToLobby', () => {
        if (!currentRoom) return;
        const room = ROOMS.get(currentRoom);
        if (room && room.adminId === socket.id && room.status === 'PLAYING') {
            room.status = 'LOBBY';
            io.to(room.id).emit('gameEnded', { msg: "Admin returned to lobby." });
            broadcastLobbyUpdate(room);
        }
    });

    socket.on('inputs', inputs => {
        if (!currentRoom) return;
        const room = ROOMS.get(currentRoom);
        if (!room) return;
        const p = room.players.get(socket.id);
        if (p) {
            p.inputs = inputs;
        }
    });

    socket.on('leaveRoom', () => {
        if (currentRoom) leaveRoom(socket, currentRoom);
        currentRoom = null;
    });

    socket.on('disconnect', () => {
        if (currentRoom) leaveRoom(socket, currentRoom);
    });
});

function joinRoom(socket, roomId, nickname, color, number) {
    const room = ROOMS.get(roomId);
    socket.join(roomId);

    room.players.set(socket.id, {
        id: socket.id,
        nickname,
        color,
        number,
        team: 'spec',
        x: FIELD_WIDTH / 2,
        y: -1000, // hidden
        vx: 0, vy: 0,
        radius: 15, mass: 2,
        inputs: { up: false, down: false, left: false, right: false, kick: false }
    });
    
    broadcastLobbyUpdate(room);
}

function broadcastLobbyUpdate(room) {
    if (room.status === 'LOBBY') {
        io.to(room.id).emit('lobbyUpdate', {
            adminId: room.adminId,
            players: Array.from(room.players.values()).map(p => ({
                id: p.id,
                nickname: p.nickname,
                team: p.team,
                number: p.number
            }))
        });
    }
}

function leaveRoom(socket, roomId) {
    const room = ROOMS.get(roomId);
    if (!room) return;
    
    const p = room.players.get(socket.id);
    if (p && room.status === 'PLAYING' && p.team !== 'spec') {
        room.eventMsg = `${p.nickname} Left!`;
        room.goalPause = 180; // Pause for 3s
    }
    
    room.players.delete(socket.id);
    socket.leave(roomId);
    
    if (room.players.size === 0) {
        ROOMS.delete(roomId);
    } else if (room.adminId === socket.id) {
        // Reassign admin
        const nextPlayer = room.players.values().next().value;
        if(nextPlayer) room.adminId = nextPlayer.id;
        broadcastLobbyUpdate(room);
    } else {
        broadcastLobbyUpdate(room);
    }
}

// Physics Loop - Authoritative state
setInterval(() => {
    ROOMS.forEach(room => {
        if (room.players.size === 0 || room.status !== 'PLAYING') return;
        
        updatePhysics(room);
        
        room.ticksPassed++;
        if (room.ticksPassed >= TICK_RATE) {
            room.timeRemaining--;
            room.ticksPassed = 0;
            checkMatchEnd(room);
        }
        
        const state = {
            timeRemaining: room.timeRemaining,
            ball: room.ball,
            players: Array.from(room.players.values()).filter(p => ['red','blue'].includes(p.team)),
            score: room.score,
            tournament: room.mode === 'tournament' ? room.tournament : null,
            eventMsg: room.eventMsg || ''
        };
        io.to(room.id).emit('gameState', state);
    });
}, 1000 / TICK_RATE);

function checkMatchEnd(room) {
    if (room.timeRemaining <= 0 || room.score.red >= room.scoreLimit || room.score.blue >= room.scoreLimit) {
        if (room.mode === 'tournament') {
            room.tournament.aggRed += room.score.red;
            room.tournament.aggBlue += room.score.blue;
            
            if (room.tournament.leg === 1) {
                // End of Leg 1
                room.tournament.leg = 2;
                room.score = { red: 0, blue: 0 };
                room.timeRemaining = room.timeLimit * 60;
                resetPositions(room);
                io.to(room.id).emit('gameState', {
                    timeRemaining: room.timeRemaining, ball: room.ball, players: Array.from(room.players.values()).filter(p => ['red','blue'].includes(p.team)),
                    score: room.score, tournament: room.tournament
                });
            } else {
                // End of Leg 2
                // Handle tie visually (just give it to red for now if exactly tied)
                if (room.tournament.aggRed === room.tournament.aggBlue) room.tournament.aggRed += 1;
                
                const redWon = room.tournament.aggRed > room.tournament.aggBlue;
                const match = room.currentMatch;
                match.status = 'finished';
                
                if (redWon) {
                    match.winner = match.team1.id;
                    match.team1.score = room.tournament.aggRed;
                    match.team2.score = room.tournament.aggBlue;
                } else {
                    match.winner = match.team2 ? match.team2.id : match.team1.id;
                    match.team1.score = room.tournament.aggRed;
                    if(match.team2) match.team2.score = room.tournament.aggBlue;
                }
                
                // Propagate winner to next round
                advanceWinnerToNextRound(room, match, redWon ? match.team1 : match.team2);

                room.status = 'BRACKET';
                io.to(room.id).emit('showBracket', getBracketData(room));
                
                // Check if it was the final
                const isFinal = !getNextMatch(room);
                if (isFinal) {
                    setTimeout(() => {
                        room.status = 'LOBBY';
                        io.to(room.id).emit('gameEnded', { msg: `Tournament Completed! Winner: ${redWon ? match.team1.name : (match.team2 ? match.team2.name : 'Unknown')}` });
                        broadcastLobbyUpdate(room);
                    }, 5000);
                }
            }
        } else {
            // Single Match ended
            const resultMsg = room.score.red > room.score.blue ? "RED Team Wins!" :
                             room.score.blue > room.score.red ? "BLUE Team Wins!" : "Match ended in a DRAW!";
            finishMatch(room, resultMsg);
        }
    }
}

function finishMatch(room, msg) {
    room.status = 'LOBBY';
    io.to(room.id).emit('gameEnded', { msg });
    broadcastLobbyUpdate(room);
}

// ----- Bracket Logic -----
function generateBracket(room) {
    const players = Array.from(room.players.values());
    const shuffled = players.sort(() => 0.5 - Math.random());
    const teams = [];
    
    // Group into 2s
    for(let i=0; i<shuffled.length; i+=2) {
        const p1 = shuffled[i];
        const p2 = shuffled[i+1];
        teams.push({
            id: `team_${i}`,
            name: p2 ? `${p1.nickname} & ${p2.nickname}` : `${p1.nickname}`,
            playerIds: p2 ? [p1.id, p2.id] : [p1.id]
        });
    }

    // Ensure we have an even power of 2 for a clean bracket (pad with empty if necessary, but keep simple)
    // For this implementation, we will just pair adjacent teams in round 1
    const rounds = [];
    let currentRoundTeams = [...teams];
    let roundNum = 0;

    while(currentRoundTeams.length > 1 || roundNum === 0) {
        const matches = [];
        const nextRoundTeamsPlaceholder = [];
        
        for(let i=0; i<currentRoundTeams.length; i+=2) {
            const t1 = currentRoundTeams[i];
            const t2 = currentRoundTeams[i+1];
            matches.push({
                id: `m_${roundNum}_${i}`,
                team1: t1,
                team2: t2 || null, // bye if null
                status: t2 ? 'pending' : 'finished',
                winner: t2 ? null : (t1 ? t1.id : null),
                nextMatchIndex: matches.length // position in next round
            });
            nextRoundTeamsPlaceholder.push(t2 ? null : t1); // push winner directly if bye
        }
        rounds.push(matches);
        currentRoundTeams = nextRoundTeamsPlaceholder;
        roundNum++;
    }
    
    room.bracket = rounds;
}

function getNextMatch(room) {
    if(!room.bracket) return null;
    for(let r=0; r<room.bracket.length; r++) {
        for(let m=0; m<room.bracket[r].length; m++) {
            const match = room.bracket[r][m];
            if (match.status === 'pending' && match.team1 && match.team2) {
                match.roundIdx = r;
                match.matchIdx = m;
                return match;
            }
        }
    }
    return null;
}

function advanceWinnerToNextRound(room, match, winnerTeam) {
    const nextRoundIdx = match.roundIdx + 1;
    if (nextRoundIdx < room.bracket.length) {
        const nextMatchIdx = Math.floor(match.matchIdx / 2);
        const nextMatch = room.bracket[nextRoundIdx][nextMatchIdx];
        
        if (match.matchIdx % 2 === 0) nextMatch.team1 = winnerTeam;
        else nextMatch.team2 = winnerTeam;

        // Auto-advance if opposite team is null (bye) handled in advanceBracket checks loosely
        if(nextMatch.team1 && nextMatch.team2 === null && match.matchIdx % 2 !== 0) {
            nextMatch.status = 'finished';
            nextMatch.winner = winnerTeam.id;
            advanceWinnerToNextRound(room, nextMatch, winnerTeam);
        }
    }
}

function getBracketData(room) {
    if (!room.bracket) return { rounds: [] };
    return { rounds: room.bracket };
}
// ----- End Bracket Logic -----

function updatePhysics(room) {
    if (room.goalPause && room.goalPause > 0) {
        room.goalPause--;
        if (room.goalPause <= 0) {
            room.eventMsg = '';
            resetPositions(room);
        }
        return; // Physics frozen
    }

    // players physics
    for (let player of room.players.values()) {
        if (!player || !player.inputs) continue; // CRASH PROTECTION
        
        player.vx *= PLAYER_FRICTION;
        player.vy *= PLAYER_FRICTION;
        
        const acc = 0.25; // Slower Acceleration amount
        if (player.inputs.up) player.vy -= acc;
        if (player.inputs.down) player.vy += acc;
        if (player.inputs.left) player.vx -= acc;
        if (player.inputs.right) player.vx += acc;
        
        player.x += player.vx;
        player.y += player.vy;
        
        // Field constraints
        player.x = Math.max(player.radius, Math.min(FIELD_WIDTH - player.radius, player.x));
        player.y = Math.max(player.radius, Math.min(FIELD_HEIGHT - player.radius, player.y));
    }
    
    // ball physics
    room.ball.vx *= BALL_FRICTION;
    room.ball.vy *= BALL_FRICTION;
    room.ball.x += room.ball.vx;
    room.ball.y += room.ball.vy;
    
    // Create an array of active players to avoid checking spectators
    const activePlayers = Array.from(room.players.values()).filter(p => ['red','blue'].includes(p.team));
    for (let i=0; i<activePlayers.length; i++) {
        for (let j=i+1; j<activePlayers.length; j++) {
            resolveCollision(activePlayers[i], activePlayers[j], 'player_player');
        }
        resolveCollision(activePlayers[i], room.ball, 'player_ball');
        
        // Handle kick input (CRASH PROTECTION INCLUDED)
        if (activePlayers[i] && activePlayers[i].inputs && activePlayers[i].inputs.kick) {
            const dx = room.ball.x - activePlayers[i].x;
            const dy = room.ball.y - activePlayers[i].y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist < activePlayers[i].radius + room.ball.radius + 10) { 
                const nx = dx / dist;
                const ny = dy / dist;
                room.ball.vx += nx * 6;
                room.ball.vy += ny * 6;
            }
        }
    }
    
    // Ball wall collisions (Top and Bottom)
    if (room.ball.y < room.ball.radius) { room.ball.y = room.ball.radius; room.ball.vy *= -1; }
    if (room.ball.y > FIELD_HEIGHT - room.ball.radius) { room.ball.y = FIELD_HEIGHT - room.ball.radius; room.ball.vy *= -1; }
    
    // Goal mechanics & Side constraints
    if (room.ball.x < room.ball.radius) {
        if (room.ball.y > GOAL_TOP && room.ball.y < GOAL_BOTTOM) {
            room.score.blue++;
            room.eventMsg = "GOAL BLUE!";
            room.goalPause = 180;
        } else {
            room.ball.x = room.ball.radius;
            room.ball.vx *= -1;
        }
    }
    if (room.ball.x > FIELD_WIDTH - room.ball.radius) {
        if (room.ball.y > GOAL_TOP && room.ball.y < GOAL_BOTTOM) {
            room.score.red++;
            room.eventMsg = "GOAL RED!";
            room.goalPause = 180;
        } else {
            room.ball.x = FIELD_WIDTH - room.ball.radius;
            room.ball.vx *= -1;
        }
    }
}

function resolveCollision(a, b, type) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const minDist = a.radius + b.radius;
    
    if (dist > 0 && dist < minDist) {
        const nx = dx / dist;
        const ny = dy / dist;
        const massSum = a.mass + b.mass;
        const p = 2 * (a.vx * nx + a.vy * ny - b.vx * nx - b.vy * ny) / massSum;
        
        let elasticity = type === 'player_player' ? 0 : 
                         type === 'player_ball' ? 0.2 : 0.8;
                         
        a.vx -= p * b.mass * nx * elasticity; 
        a.vy -= p * b.mass * ny * elasticity;
        b.vx += p * a.mass * nx * elasticity;
        b.vy += p * a.mass * ny * elasticity;
        
        // Penetration resolution to prevent overlapping entities passing through each other
        const overlap = minDist - dist;
        a.x -= nx * overlap * 0.5;
        a.y -= ny * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.y += ny * overlap * 0.5;
    }
}

function resetPositions(room) {
    room.ball.x = FIELD_WIDTH/2;
    room.ball.y = FIELD_HEIGHT/2;
    room.ball.vx = 0; room.ball.vy = 0;
    
    room.players.forEach(p => {
        if (p.team === 'spec') return;
        p.vx = 0; p.vy = 0;
        p.x = p.team === 'red' ? FIELD_WIDTH * 0.25 : FIELD_WIDTH * 0.75;
        p.y = FIELD_HEIGHT/2;
    });
}

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
