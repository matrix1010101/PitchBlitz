const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

// Game Config
const TICK_RATE = 64;
const FIELD_WIDTH = 1200;
const FIELD_HEIGHT = 600;
const GOAL_TOP = 200;
const GOAL_BOTTOM = 400;
const BALL_FRICTION = 0.985; // Slightly less friction for faster gameplay
const PLAYER_FRICTION = 0.92;
const BOT_ACC = 0.18; // Slower bots for a more human feel
const PLAYER_ACC = 0.35;

function getFieldSize(maxPlayers) {
    // Scale field dynamically with player count
    if (maxPlayers <= 2)  return { w: 800,  h: 500,  gTop: 167, gBot: 333 };
    if (maxPlayers <= 4)  return { w: 1000, h: 550,  gTop: 183, gBot: 367 };
    if (maxPlayers <= 6)  return { w: 1200, h: 600,  gTop: 200, gBot: 400 };
    if (maxPlayers <= 8)  return { w: 1400, h: 650,  gTop: 217, gBot: 433 };
    if (maxPlayers <= 10) return { w: 1600, h: 700,  gTop: 233, gBot: 467 };
    return                       { w: 1900, h: 800,  gTop: 267, gBot: 533 };
}

const ROOMS = new Map();

function generateId() {
    return Math.random().toString(36).substring(2, 9);
}

io.on('connection', socket => {
    let currentRoom = null;

    socket.on('getRooms', (cb) => {
        const roomList = Array.from(ROOMS.values())
            .filter(r => !r.isPractice) // Don't show practice rooms in the list
            .map(r => ({
                id: r.id, name: r.name, hasPassword: !!r.password, 
                playersCount: r.players.size, maxPlayers: r.maxPlayers
            }));
        cb(roomList);
    });

    socket.on('createRoom', (data, cb) => {
        const id = generateId();
        const field = getFieldSize(data.maxPlayers);
        const room = {
            id, name: data.name, password: data.password || '', maxPlayers: data.maxPlayers,
            mode: data.mode || 'single',
            isPractice: !!data.isPractice,
            practiceType: data.practiceType || '',
            tourneyTeams: data.tourneyTeams || 4,
            status: 'LOBBY',
            adminId: socket.id,
            players: new Map(),
            fieldWidth: field.w, fieldHeight: field.h,
            goalTop: field.gTop, goalBottom: field.gBot,
            ball: { x: field.w/2, y: field.h/2, vx: 0, vy: 0, radius: 10, mass: 1 },
            score: { red: 0, blue: 0 },
            timeRemaining: 0,
            timeLimit: 3,
            scoreLimit: 3,
            ticksPassed: 0,
            tournament: { leg: 1, aggRed: 0, aggBlue: 0 }
        };
        ROOMS.set(id, room);
        
        joinRoom(socket, id, data.nickname, data.flag, data.number);
        
        // Auto-configure for Practice Mode
        if (room.isPractice) {
            setupPracticeMode(room);
        }

        currentRoom = id;
        cb({ success: true, roomId: id });
    });

    socket.on('joinRoom', (data, cb) => {
        const room = ROOMS.get(data.roomId);
        if (!room) return cb({ success: false, error: 'Room not found' });
        if (room.players.size >= room.maxPlayers) return cb({ success: false, error: 'Room full' });
        if (room.password && room.password !== data.password) return cb({ success: false, error: 'Wrong password' });
        
        joinRoom(socket, data.roomId, data.nickname, data.flag, data.number);
        currentRoom = data.roomId;
        cb({ success: true });
    });

    socket.on('changeTeam', () => {
        // Obsolete: Admin strictly manages teams via adminMovePlayer
    });

    socket.on('adminMovePlayer', (data) => {
        const room = ROOMS.get(currentRoom);
        if (!room || room.adminId !== socket.id) return;
        const target = room.players.get(data.playerId);
        if (target) target.team = data.team;
        broadcastLobbyUpdate(room);
    });

    socket.on('chatMessage', (text) => {
        if (typeof text !== 'string' || !text.trim()) return;
        const room = ROOMS.get(currentRoom);
        if (!room) return;
        const player = room.players.get(socket.id);
        if (!player) return;
        
        io.to(room.id).emit('chatMessage', {
            id: generateId(),
            sender: player.nickname,
            team: player.team,
            text: text.substring(0, 100)
        });
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

    socket.on('inputs', data => {
        if (!currentRoom) return;
        const room = ROOMS.get(currentRoom);
        if (!room) return;
        const p = room.players.get(socket.id);
        if (p) {
            p.inputs = data.p1 || data; // handle old and new format
            if (data.p2 && room.isPractice && room.practiceType === 'local_1v1') {
                const p2 = Array.from(room.players.values()).find(pl => pl.isLocalP2);
                if (p2) p2.inputs = data.p2;
            }
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

function joinRoom(socket, roomId, nickname, flag, number) {
    const room = ROOMS.get(roomId);
    socket.join(roomId);

    room.players.set(socket.id, {
        id: socket.id,
        nickname,
        flag,
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
            mode: room.mode,
            tourneyTeams: room.tourneyTeams,
            players: Array.from(room.players.values()).map(p => ({
                id: p.id,
                nickname: p.nickname,
                team: p.team,
                number: p.number,
                flag: p.flag
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
            fieldWidth: room.fieldWidth,
            fieldHeight: room.fieldHeight,
            goalTop: room.goalTop,
            goalBottom: room.goalBottom,
            players: Array.from(room.players.values()).filter(p => ['red','blue'].includes(p.team)).map(p => ({
                id: p.id, x: p.x, y: p.y, vx: p.vx, vy: p.vy, radius: p.radius, team: p.team, nickname: p.nickname, flag: p.flag, number: p.number, inputs: p.inputs
            })),
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
            const winner = room.score.red > room.score.blue ? 'red' :
                           room.score.blue > room.score.red ? 'blue' : null;
            const resultMsg = winner === 'red' ? 'RED Team Wins!' :
                              winner === 'blue' ? 'BLUE Team Wins!' : 'Match ended in a DRAW!';
            finishMatch(room, resultMsg, winner);
        }
    }
}

function finishMatch(room, msg, winner = null) {
    room.status = 'LOBBY';
    io.to(room.id).emit('gameEnded', { msg, winner });
    // Reset all players to spec so lobby is clean
    room.players.forEach(p => { p.team = 'spec'; });
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
    const FW = room.fieldWidth, FH = room.fieldHeight;
    const GT = room.goalTop, GB = room.goalBottom;

    if (room.isPractice) {
        updateBotsLogic(room);
    }

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
        
        const acc = 0.35; // Increased acc because tick rate is lower (64 vs 128)
        if (player.inputs.up) player.vy -= acc;
        if (player.inputs.down) player.vy += acc;
        if (player.inputs.left) player.vx -= acc;
        if (player.inputs.right) player.vx += acc;
        
        player.x += player.vx;
        player.y += player.vy;
        
        // Field constraints - use room's actual field dimensions
        player.x = Math.max(player.radius, Math.min(FW - player.radius, player.x));
        player.y = Math.max(player.radius, Math.min(FH - player.radius, player.y));
    }
    
    // ball physics
    room.ball.vx *= BALL_FRICTION;
    room.ball.vy *= BALL_FRICTION;
    room.ball.x += room.ball.vx;
    room.ball.y += room.ball.vy;

    // Check Goal Posts (Circular Static Colliders)
    const posts = [
        { x: 0, y: GT, r: 12 }, { x: 0, y: GB, r: 12 },
        { x: FW, y: GT, r: 12 }, { x: FW, y: GB, r: 12 }
    ];

    posts.forEach(post => {
        const dx = room.ball.x - post.x;
        const dy = room.ball.y - post.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const minDist = room.ball.radius + post.r;
        if (dist < minDist) {
            // Elastic collision with static point
            const nx = dx / dist;
            const ny = dy / dist;
            const scalar = room.ball.vx * nx + room.ball.vy * ny;
            room.ball.vx = (room.ball.vx - 2 * scalar * nx) * 0.8;
            room.ball.vy = (room.ball.vy - 2 * scalar * ny) * 0.8;
            const overlap = minDist - dist;
            room.ball.x += nx * overlap;
            room.ball.y += ny * overlap;
        }
    });

    // Check players collision with posts
    for (let p of room.players.values()) {
        posts.forEach(post => {
            const dx = p.x - post.x;
            const dy = p.y - post.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            const minDist = p.radius + post.r;
            if (dist < minDist) {
                const nx = dx / dist;
                const ny = dy / dist;
                const overlap = minDist - dist;
                p.x += nx * overlap;
                p.y += ny * overlap;
                // Bounce player slightly
                p.vx = (p.vx * -0.2) + (nx * 2);
                p.vy = (p.vy * -0.2) + (ny * 2);
            }
        });
    }
    
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
                room.ball.vx += nx * 3;  // Reduced kick power (was 6)
                room.ball.vy += ny * 3;
            }
        }
    }
    
    // Ball wall collisions (Top and Bottom)
    if (room.ball.y < room.ball.radius) { room.ball.y = room.ball.radius; room.ball.vy *= -1; }
    if (room.ball.y > FH - room.ball.radius) { room.ball.y = FH - room.ball.radius; room.ball.vy *= -1; }
    
    // Goal mechanics & Side constraints
    if (room.ball.x < room.ball.radius) {
        if (room.ball.y > GT && room.ball.y < GB) {
            room.score.blue++;
            room.goalPause = TICK_RATE * 3;
            io.to(room.id).emit('goalScored', { team: 'blue', score: room.score });
        } else {
            room.ball.x = room.ball.radius;
            room.ball.vx *= -1;
        }
    }
    if (room.ball.x > FW - room.ball.radius) {
        if (room.ball.y > GT && room.ball.y < GB) {
            room.score.red++;
            room.goalPause = TICK_RATE * 3;
            io.to(room.id).emit('goalScored', { team: 'red', score: room.score });
        } else {
            room.ball.x = FW - room.ball.radius;
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
        
        let elasticity = type === 'player_player' ? 0.3 : 
                         type === 'player_ball' ? 0.05 : 0.8; // Very low elasticity for 'dribbling' touch
                         
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

// ----- Practice & Bot AI Logic -----

function setupPracticeMode(room) {
    room.status = 'PLAYING';
    room.timeLimit = 5;
    room.scoreLimit = 5;
    room.timeRemaining = room.timeLimit * 60;
    
    // Clear spectators and move p1 to red
    const p1 = Array.from(room.players.values())[0];
    if (p1) p1.team = 'red';

    if (room.practiceType === 'local_1v1') {
        // Add a second local player
        const p2Id = 'local_p2_' + room.id;
        room.players.set(p2Id, {
            id: p2Id, isLocalP2: true, nickname: 'Player 2', flag: p1.flag, number: 11, team: 'blue',
            x: 0, y: 0, vx: 0, vy: 0, radius: 15, mass: 2,
            inputs: { up: false, down: false, left: false, right: false, kick: false }
        });
    } else {
        // Spawning bots
        const count = parseInt(room.practiceType.split('_')[1][0]);
        // Red team bots (to fill)
        for(let i=1; i<count; i++) {
            addBot(room, 'red', `Bot Red ${i}`);
        }
        // Blue team bots
        for(let i=0; i<count; i++) {
            addBot(room, 'blue', `Bot Blue ${i+1}`);
        }
    }
    resetPositions(room);
    io.to(room.id).emit('gameStarted');
}

function addBot(room, team, name) {
    const id = 'bot_' + generateId();
    room.players.set(id, {
        id, isBot: true, nickname: name, flag: 'un', number: Math.floor(Math.random()*99),
        team, x: 0, y: 0, vx: 0, vy: 0, radius: 15, mass: 2,
        inputs: { up: false, down: false, left: false, right: false, kick: false }
    });
}

function updateBotsLogic(room) {
    const ball = room.ball;
    const players = Array.from(room.players.values());
    
    players.forEach(p => {
        if (!p.isBot) return;

        // Freeze logic: 2s pause every 7s total cycle (5s active, 2s pause)
        const cycle = 7;
        const phase = (room.timeRemaining) % cycle;
        if (phase < 2) {
            p.inputs = { up: false, down: false, left: false, right: false, kick: false };
            p.lastDecision = { ...p.inputs };
            return;
        }

        // Reset inputs
        p.inputs = { up: false, down: false, left: false, right: false, kick: false };

        const dx = ball.x - p.x;
        const dy = ball.y - p.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const isRed = p.team === 'red';
        
        // Humanizing: Introduce a tiny bit of target jitter and reaction lag
        if (room.ticksPassed % 10 !== 0 && p.lastDecision) {
            Object.assign(p.inputs, p.lastDecision);
        } else {
            // Simple Role: closest to ball attacks, others defend
            const teammates = players.filter(pl => pl.team === p.team);
            const dists = teammates.map(pl => Math.sqrt(Math.pow(ball.x - pl.x, 2) + Math.pow(ball.y - pl.y, 2)));
            const minDist = Math.min(...dists);
            const isAttacker = dist === minDist;

            if (isAttacker) {
                // Move towards ball BUT try to get behind it relative to goal
                const targetGoalX = isRed ? room.fieldWidth : 0;
                const targetGoalY = room.fieldHeight / 2;
                
                // Point slightly behind the ball to aim at goal
                const aimX = ball.x - (isRed ? 30 : -30);
                const aimY = ball.y;

                if (p.x < aimX - 5) p.inputs.right = true;
                else if (p.x > aimX + 5) p.inputs.left = true;
                
                if (p.y < aimY - 5) p.inputs.down = true;
                else if (p.y > aimY + 5) p.inputs.up = true;
                
                // Kick if close
                if (dist < p.radius + ball.radius + 15) {
                    const towardsOpponentGoal = isRed ? dx > 0 : dx < 0;
                    if (towardsOpponentGoal) p.inputs.kick = true;
                }
            } else {
                // Defensive position: don't just stand there, shadow the ball
                const defX = isRed ? room.fieldWidth * 0.15 : room.fieldWidth * 0.85;
                const defY = (room.fieldHeight / 2) + (ball.y - room.fieldHeight/2) * 0.4;
                
                if (p.x < defX - 10) p.inputs.right = true;
                else if (p.x > defX + 10) p.inputs.left = true;
                if (p.y < defY - 10) p.inputs.down = true;
                else if (p.y > defY + 10) p.inputs.up = true;
            }
            p.lastDecision = { ...p.inputs };
        }

        // Apply bot acceleration
        const acc = BOT_ACC;
        if (p.inputs.up) p.vy -= acc;
        if (p.inputs.down) p.vy += acc;
        if (p.inputs.left) p.vx -= acc;
        if (p.inputs.right) p.vx += acc;
    });
}

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
