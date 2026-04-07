const socket = io();

// UI Elements
const uiLayer = document.getElementById('ui-layer');
const gameLayer = document.getElementById('game-layer');
const landingModal = document.getElementById('landing-modal');
const nicknameModal = document.getElementById('nickname-modal');
const roomListModal = document.getElementById('room-list-modal');
const createRoomModal = document.getElementById('create-room-modal');
const passwordModal = document.getElementById('password-modal');
const roomLobbyModal = document.getElementById('room-lobby-modal');

let myNickname = '';
let myFlag = '🏳️';
let myNumber = 10;
let currentRoomId = null;
let isRoomAdmin = false;
let gameStatus = 'LOBBY'; // LOBBY, BRACKET, PLAYING

// --- Flag Image Cache ---
const flagImageCache = {};
function getFlagImage(code) {
    if (flagImageCache[code]) return flagImageCache[code];
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = `https://flagcdn.com/w40/${code}.png`;
    img.onload = () => { flagImageCache[code] = img; drawPreview(); };
    flagImageCache[code] = img;
    return img;
}

// --- Profile Preview ---
const previewCanvas = document.getElementById('preview-canvas');
const pCtx = previewCanvas.getContext('2d');
function drawPreview() {
    pCtx.clearRect(0,0,80,80);
    pCtx.beginPath();
    pCtx.arc(40, 40, 30, 0, Math.PI * 2);
    pCtx.fillStyle = '#1e293b';
    pCtx.fill();
    pCtx.lineWidth = 3;
    pCtx.strokeStyle = '#000';
    pCtx.stroke();
    
    // Draw Flag Image
    const code = document.getElementById('input-flag').value;
    const flagImg = getFlagImage(code);
    if (flagImg.complete && flagImg.naturalWidth > 0) {
        pCtx.save();
        pCtx.beginPath();
        pCtx.arc(40, 33, 14, 0, Math.PI * 2);
        pCtx.clip();
        pCtx.drawImage(flagImg, 26, 19, 28, 28);
        pCtx.restore();
    }

    // Draw Number
    pCtx.fillStyle = 'white';
    pCtx.strokeStyle = 'black';
    pCtx.lineWidth = 3;
    pCtx.font = 'bold 16px Inter';
    pCtx.textAlign = 'center';
    pCtx.textBaseline = 'middle';
    const num = document.getElementById('input-number').value || '?';
    pCtx.strokeText(num, 40, 55);
    pCtx.fillText(num, 40, 55);
}
document.getElementById('input-flag').addEventListener('change', drawPreview);
document.getElementById('input-number').addEventListener('input', drawPreview);
drawPreview();

// --- UI Navigation ---
function showModal(modal) {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
    modal.classList.add('active');
}

document.getElementById('btn-play-now').onclick = () => showModal(nicknameModal);

document.getElementById('btn-submit-nickname').onclick = () => {
    const val = document.getElementById('input-nickname').value.toUpperCase();
    if (val.length >= 1 && val.length <= 20) {
        myNickname = val;
        myFlag = document.getElementById('input-flag').value;
        myNumber = document.getElementById('input-number').value || 10;
        loadRooms();
        showModal(roomListModal);
    } else {
        alert("Must be 1-20 letters.");
    }
};

document.getElementById('input-room-mode').addEventListener('change', (e) => {
    const isTourney = e.target.value === 'tournament';
    if (isTourney) {
        document.getElementById('tourney-teams-group').classList.remove('hidden');
        document.getElementById('max-players-group').classList.add('hidden');
    } else {
        document.getElementById('tourney-teams-group').classList.add('hidden');
        document.getElementById('max-players-group').classList.remove('hidden');
    }
});

document.getElementById('input-tourney-teams').addEventListener('change', (e) => {
    // Keep max value in sync for server but hidden from user
    document.getElementById('input-room-max').value = parseInt(e.target.value) * 2;
});

document.getElementById('btn-refresh-rooms').onclick = loadRooms;
document.getElementById('btn-open-create-room').onclick = () => showModal(createRoomModal);
document.getElementById('btn-cancel-create').onclick = () => showModal(roomListModal);

document.getElementById('btn-create-room').onclick = () => {
    const name = document.getElementById('input-room-name').value;
    const pwd = document.getElementById('input-room-password').value;
    const mode = document.getElementById('input-room-mode').value;
    const isTourney = mode === 'tournament';
    const tourneyTeams = parseInt(document.getElementById('input-tourney-teams').value) || 4;
    const max = isTourney ? tourneyTeams * 2 : parseInt(document.getElementById('input-room-max').value);
    if (!name) return alert("Room name required");
    
    socket.emit('createRoom', { name, password: pwd, maxPlayers: max, mode, tourneyTeams, nickname: myNickname, flag: myFlag, number: myNumber }, (res) => {
        if (res.success) enterLobby(res.roomId);
        else alert(res.error);
    });
};

function loadRooms() {
    socket.emit('getRooms', (rooms) => {
        const tbody = document.getElementById('rooms-tbody');
        tbody.innerHTML = '';
        rooms.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${r.name}</td>
                <td>${r.playersCount}/${r.maxPlayers}</td>
                <td>${r.hasPassword ? 'Yes' : 'No'}</td>
                <td><button class="btn small primary" onclick="joinRoom('${r.id}', ${r.hasPassword})">Join</button></td>
            `;
            tbody.appendChild(tr);
        });
    });
}

// Make globally accessible for inline onclick
window.joinRoom = function(id, hasPassword) {
    if (hasPassword) {
        showModal(passwordModal);
        document.getElementById('btn-submit-password').onclick = () => {
            const pwd = document.getElementById('input-join-password').value;
            attemptJoin(id, pwd);
        };
        document.getElementById('btn-cancel-password').onclick = () => showModal(roomListModal);
    } else {
        attemptJoin(id, '');
    }
}

function attemptJoin(id, password) {
    socket.emit('joinRoom', { roomId: id, password, nickname: myNickname, flag: myFlag, number: myNumber }, (res) => {
        if (res.success) {
            enterLobby(id);
        } else {
            alert(res.error);
            showModal(roomListModal);
        }
    });
}

function enterLobby(roomId) {
    currentRoomId = roomId;
    gameStatus = 'LOBBY';
    gameLayer.classList.add('hidden');
    uiLayer.style.display = 'flex';
    showModal(roomLobbyModal);
    document.getElementById('lobby-room-name').innerText = "Room Lobby";
}

socket.on('lobbyUpdate', data => {
    if (gameStatus !== 'LOBBY') return;
    
    const adminPanel = document.getElementById('admin-controls-panel');
    isRoomAdmin = (data.adminId === socket.id);
    if(isRoomAdmin) {
        adminPanel.classList.remove('hidden');
    } else {
        adminPanel.classList.add('hidden');
    }

    const flagImg = code => `<img src="https://flagcdn.com/w20/${code || 'un'}.png" style="width:18px;height:12px;border-radius:2px;vertical-align:middle;margin-right:4px;">`;
    const container = document.getElementById('lobby-container');

    if (data.mode === 'tournament') {
        // ---- TOURNAMENT DRAW VIEW ----
        const numTeams = data.tourneyTeams || 4;
        const teamMap = {};
        for (let i = 1; i <= numTeams; i++) teamMap[i] = [];
        data.players.filter(p => p.team !== 'spec' && p.team.startsWith('t')).forEach(p => {
            const idx = parseInt(p.team.replace('t', ''));
            if (teamMap[idx]) teamMap[idx].push(p);
        });
        const waitingPool = data.players.filter(p => p.team === 'spec');

        let html = `<div class="draw-layout">
            <div class="draw-waiting">
                <div class="draw-waiting-title">Waiting Pool</div>
                ${waitingPool.map(p => `
                    <div class="draw-player">
                        ${flagImg(p.flag)}<b>${p.nickname}</b> #${p.number} ${p.id === data.adminId ? '👑' : ''}
                        ${isRoomAdmin ? `<div class="player-controls" style="margin-top:4px">
                            ${Array.from({length: numTeams}, (_, i) => `<button class="btn tiny ghost" onclick="adminMove('${p.id}','t${i+1}')">→T${i+1}</button>`).join('')}
                        </div>` : ''}
                    </div>
                `).join('')}
            </div>
            <div class="draw-teams">`;

        for (let i = 1; i <= numTeams; i++) {
            html += `<div class="draw-team-slot">
                <div class="draw-team-label">Team ${i}</div>
                ${teamMap[i].map(p => `
                    <div class="draw-player assigned">
                        ${flagImg(p.flag)}<b>${p.nickname}</b> #${p.number}
                        ${isRoomAdmin ? `<button class="btn tiny ghost" onclick="adminMove('${p.id}','spec')" style="margin-left:4px">✕</button>` : ''}
                    </div>
                `).join('')}
                ${teamMap[i].length < 2 ? `<div class="draw-player empty">+ ${2 - teamMap[i].length} player(s) needed</div>` : ''}
            </div>`;
        }
        html += `</div></div>`;
        container.innerHTML = html;
    } else {
        // ---- SINGLE MATCH 3-COLUMN VIEW ----
        const mapPlayers = list => list.map(p => `
            <li>
                <span>${flagImg(p.flag)}<b>${p.number}</b> ${p.nickname} ${p.id === data.adminId ? '👑' : ''}</span>
                ${isRoomAdmin ? `<div class="player-controls">
                    <button class="btn tiny ghost" onclick="adminMove('${p.id}', 'red')">R</button>
                    <button class="btn tiny ghost" onclick="adminMove('${p.id}', 'spec')">S</button>
                    <button class="btn tiny ghost" onclick="adminMove('${p.id}', 'blue')">B</button>
                </div>` : ''}
            </li>
        `).join('');
        
        container.innerHTML = `
            <div class="team-column red-col">
                <div class="team-header red-header">Red</div>
                <ul class="player-list">${mapPlayers(data.players.filter(p => p.team === 'red'))}</ul>
            </div>
            <div class="team-column spec-col">
                <div class="team-header spec-header">Spectators</div>
                <ul class="player-list">${mapPlayers(data.players.filter(p => p.team === 'spec'))}</ul>
            </div>
            <div class="team-column blue-col">
                <div class="team-header blue-header">Blue</div>
                <ul class="player-list">${mapPlayers(data.players.filter(p => p.team === 'blue'))}</ul>
            </div>`;
    }
});

// Admin global function
window.adminMove = function(playerId, team) {
    socket.emit('adminMovePlayer', { playerId, team });
}

document.getElementById('btn-start-game').onclick = () => {
    const timeLimit = parseInt(document.getElementById('input-time-limit').value) || 3;
    const scoreLimit = parseInt(document.getElementById('input-score-limit').value) || 3;
    socket.emit('startGame', { timeLimit, scoreLimit });
};

document.getElementById('btn-lobby-leave').onclick = () => {
    leaveCurrentRoom();
};

document.getElementById('btn-leave-room').onclick = () => {
    socket.emit('returnToLobby');
};

socket.on('showBracket', (bracketData) => {
    gameStatus = 'BRACKET';
    uiLayer.style.display = 'none';
    gameLayer.classList.add('hidden');
    document.getElementById('bracket-layer').classList.remove('hidden');
    
    if (isRoomAdmin) {
        document.getElementById('btn-advance-bracket').classList.remove('hidden');
    }

    // Render tree visually
    const container = document.getElementById('bracket-container');
    container.innerHTML = '';
    
    bracketData.rounds.forEach((round, roundIdx) => {
        const roundDiv = document.createElement('div');
        roundDiv.className = 'bracket-round';
        round.forEach(match => {
            const box = document.createElement('div');
            box.className = `match-box ${match.status === 'playing' ? 'active' : ''}`;
            
            const renderTeam = (teamObj) => {
                if(!teamObj) return `<div class="match-team">TBD</div>`;
                const isWinner = match.winner === teamObj.id;
                return `<div class="match-team ${isWinner?'winner':''}">
                    <span>${teamObj.name}</span>
                    <span>${match.status === 'finished' ? teamObj.score : ''}</span>
                </div>`;
            };

            box.innerHTML = renderTeam(match.team1) + renderTeam(match.team2);
            roundDiv.appendChild(box);
        });
        container.appendChild(roundDiv);
    });
});

document.getElementById('btn-advance-bracket').onclick = () => {
    socket.emit('advanceBracket');
};

socket.on('gameStarted', (state) => {
    gameStatus = 'PLAYING';
    uiLayer.style.display = 'none';
    document.getElementById('bracket-layer').classList.add('hidden');
    gameLayer.classList.remove('hidden');
    resizeCanvas();
});

socket.on('gameEnded', (result) => {
    gameStatus = 'LOBBY';
    // Show win celebration before going back to lobby
    if (result && result.winner) {
        const color = result.winner === 'red' ? '#ef4444' : '#3b82f6';
        showCelebration(
            result.winner === 'red' ? '🔴 RED WINS!' : '🔵 BLUE WINS!',
            'Returning to lobby...',
            color,
            true
        );
        setTimeout(() => {
            hideCelebration();
            gameLayer.classList.add('hidden');
            uiLayer.style.display = 'flex';
            showModal(roomLobbyModal);
        }, 4000);
    } else {
        gameLayer.classList.add('hidden');
        uiLayer.style.display = 'flex';
        showModal(roomLobbyModal);
        if(result && result.msg) alert(result.msg);
    }
});

function leaveCurrentRoom() {
    socket.emit('leaveRoom');
    currentRoomId = null;
    gameStatus = 'LOBBY';
    gameLayer.classList.add('hidden');
    uiLayer.style.display = 'flex';
    loadRooms();
    showModal(roomListModal);
}

// --- Celebration System (Goals & Wins) ---
const celebOverlay = document.getElementById('celebration-overlay');
const celebTitle = document.getElementById('celebration-title');
const celebSub = document.getElementById('celebration-sub');
let confettiTimeout = null;

function spawnConfetti(count = 80) {
    const colors = ['#ef4444','#3b82f6','#fbbf24','#10b981','#f97316','#8b5cf6','#ec4899','#ffffff'];
    for (let i = 0; i < count; i++) {
        const el = document.createElement('div');
        el.className = 'confetti-piece';
        const side = Math.random() > 0.5;
        el.style.left = (side ? Math.random() * 30 : 70 + Math.random() * 30) + 'vw';
        el.style.top = '-20px';
        el.style.background = colors[Math.floor(Math.random() * colors.length)];
        el.style.width = (8 + Math.random() * 12) + 'px';
        el.style.height = (8 + Math.random() * 12) + 'px';
        el.style.animationDuration = (2 + Math.random() * 3) + 's';
        el.style.animationDelay = (Math.random() * 0.8) + 's';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 5000);
    }
}

function showCelebration(title, sub, bgColor, isWin = false) {
    celebTitle.textContent = title;
    celebSub.textContent = sub;
    celebOverlay.style.background = bgColor
        ? `radial-gradient(ellipse at center, ${bgColor}55 0%, rgba(0,0,0,0.7) 100%)`
        : 'rgba(0,0,0,0.6)';
    celebOverlay.classList.add('active');
    spawnConfetti(isWin ? 150 : 80);
}

function hideCelebration() {
    celebOverlay.classList.remove('active');
}

// Listen for goal events from server
socket.on('goalScored', (data) => {
    const color = data.team === 'red' ? '#ef4444' : '#3b82f6';
    showCelebration(`⚽ GOAL! ${data.team.toUpperCase()}`, `Score: ${data.score.red} - ${data.score.blue}`, color);
    setTimeout(hideCelebration, 2800);
});

// --- Prediction state for local player ---
let localPredicted = { x: 0, y: 0, vx: 0, vy: 0, active: false };

// Canvas setup (now after celebrationSystem is defined)
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
let FIELD_W = 1200; // Dynamic: updated from server on first gameState
let FIELD_H = 600;
let GOAL_T = 200;
let GOAL_B = 400;

function resizeCanvas() {
    const ratio = FIELD_W / FIELD_H;
    let w = window.innerWidth;
    let h = window.innerHeight;
    if (w / h > ratio) {
        w = h * ratio;
    } else {
        h = w / ratio;
    }
    canvas.width = FIELD_W;
    canvas.height = FIELD_H;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.style.alignSelf = 'center';
    canvas.style.margin = 'auto';
}
window.addEventListener('resize', resizeCanvas);

let gameState = null;
let lastStateTime = Date.now();
socket.on('gameState', state => {
    if (gameStatus !== 'PLAYING') return;
    
    lastStateTime = Date.now();
    // Update dynamic field dimensions from server
    if (state.fieldWidth) {
        FIELD_W = state.fieldWidth;
        FIELD_H = state.fieldHeight;
        GOAL_T = state.goalTop;
        GOAL_B = state.goalBottom;
        resizeCanvas();
    }
    gameState = state;

    // Sync local prediction with authoritative server position
    const me = state.players.find(p => p.id === socket.id);
    if (me) {
        // Snap if very far off (reconciliation)
        const dx = me.x - localPredicted.x;
        const dy = me.y - localPredicted.y;
        const drift = Math.sqrt(dx*dx + dy*dy);
        if (drift > 40) {
            localPredicted.x = me.x;
            localPredicted.y = me.y;
        } else {
            // Smooth blend toward server truth
            localPredicted.x += dx * 0.35;
            localPredicted.y += dy * 0.35;
        }
        localPredicted.vx = me.vx || 0;
        localPredicted.vy = me.vy || 0;
        localPredicted.active = true;
    }
    // Show event overlay - use new celebration system instead of old overlay
    // (goalScored socket event handles goal animations)

    document.getElementById('score-red').innerText = state.score.red;
    document.getElementById('score-blue').innerText = state.score.blue;
    
    // Formatting timer string manually to ensure exactly MM:SS shape
    const pad = n => n.toString().padStart(2, '0');
    const mins = Math.floor(state.timeRemaining / 60);
    const secs = state.timeRemaining % 60;
    document.getElementById('game-timer').innerText = `${pad(mins)}:${pad(secs)}`;

    if(state.tournament) {
        document.getElementById('tournament-banner').classList.remove('hidden');
        document.getElementById('agg-red').innerText = state.tournament.aggRed;
        document.getElementById('agg-blue').innerText = state.tournament.aggBlue;
        document.getElementById('tourney-leg').innerText = `Leg ${state.tournament.leg}`;
    } else {
        document.getElementById('tournament-banner').classList.add('hidden');
    }
});

// Render Loop
function render() {
    if (!gameState) {
        requestAnimationFrame(render);
        return;
    }
    
    // Extrapolate with tighter clamp optimized for 128Hz packets
    const now = Date.now();
    let dt = (now - lastStateTime) / (1000 / 128); // 1.0 = 1 server tick (128hz)
    if (dt > 2) dt = 2; // Short clamp: packets arrive frequently at 128Hz

    ctx.clearRect(0, 0, FIELD_W, FIELD_H);
    
    // Draw Field Map
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 40;
    // Alternating stripe stripes
    for (let x = 0; x < FIELD_W; x += 120) {
        ctx.fillStyle = x % 240 === 0 ? '#4ade80' : '#3dd56a';
        ctx.fillRect(x, 0, 120, FIELD_H);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(FIELD_W/2, 0); ctx.lineTo(FIELD_W/2, FIELD_H); ctx.stroke();
    ctx.beginPath(); ctx.arc(FIELD_W/2, FIELD_H/2, Math.min(FIELD_H * 0.1, 60), 0, Math.PI*2); ctx.stroke();
    ctx.strokeRect(0, FIELD_H/4, FIELD_W * 0.08, FIELD_H/2);
    ctx.strokeRect(FIELD_W - FIELD_W * 0.08, FIELD_H/4, FIELD_W * 0.08, FIELD_H/2);
    
    // Goals
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, GOAL_T, 20, GOAL_B - GOAL_T);
    ctx.fillRect(FIELD_W - 20, GOAL_T, 20, GOAL_B - GOAL_T);
    
    // Goal posts
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, GOAL_T, 8, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, GOAL_B, 8, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(FIELD_W, GOAL_T, 8, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(FIELD_W, GOAL_B, 8, 0, Math.PI*2); ctx.fill();

    // Draw Players
    gameState.players.forEach(p => {
        // Interpolate Positions visually bridging the 60hz limit constraints
        let ex = p.x + ((p.inputs ? (p.vx || 0) : 0) * dt);
        let ey = p.y + ((p.inputs ? (p.vy || 0) : 0) * dt);
        ex = Math.max(p.radius, Math.min(FIELD_W - p.radius, ex));
        ey = Math.max(p.radius, Math.min(FIELD_H - p.radius, ey));

        // Player body
        ctx.beginPath();
        ctx.arc(ex, ey, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.team === 'red' ? '#ef4444' : '#3b82f6';
        ctx.fill();
        
        ctx.beginPath();
        ctx.arc(ex, ey, p.radius - 3, 0, Math.PI * 2);
        ctx.strokeStyle = p.team === 'red' ? '#991b1b' : '#1e40af';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(ex, ey, p.radius, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#000';
        ctx.stroke();
        
        // Draw Flag Image (circular clipped)
        const flagImg = getFlagImage(p.flag || 'un');
        if (flagImg.complete && flagImg.naturalWidth > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(ex, ey - 4, 10, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(flagImg, ex - 10, ey - 14, 20, 20);
            ctx.restore();
        }

        // Print jersey number below flag inside circle
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 2;
        ctx.font = 'bold 12px Inter';
        ctx.strokeText(p.number || '', ex, ey + 8);
        ctx.fillText(p.number || '', ex, ey + 8);

        // Nickname below the player
        ctx.font = 'bold 12px Inter';
        ctx.strokeText(p.nickname, ex, ey + 25);
        ctx.fillText(p.nickname, ex, ey + 25);
        
        // Draw kick indicator if pressing kick
        if (p.inputs && p.inputs.kick) {
            ctx.beginPath();
            ctx.arc(ex, ey, p.radius + 4, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.lineWidth = 3;
            ctx.stroke();
        }
    });
    
    // Draw Ball
    const b = gameState.ball;
    let bx = b.x + (b.vx || 0) * dt;
    let by = b.y + (b.vy || 0) * dt;
    bx = Math.max(b.radius, Math.min(FIELD_W - b.radius, bx));
    by = Math.max(b.radius, Math.min(FIELD_H - b.radius, by));

    ctx.beginPath();
    ctx.arc(bx, by, b.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.stroke();
    
    // Ball simple pattern
    ctx.beginPath();
    ctx.arc(bx, by, b.radius/2, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
    
    requestAnimationFrame(render);
}
requestAnimationFrame(render);

// Input handling with client-side prediction
const inputs = { up: false, down: false, left: false, right: false, kick: false };

function updateInputs() {
    if (currentRoomId) socket.emit('inputs', inputs);
}

const PRED_ACC = 0.18;
const PRED_FRICTION = 0.92;

window.addEventListener('keydown', e => {
    if (!currentRoomId || gameStatus !== 'PLAYING') return;
    let changed = false;
    if (['w', 'arrowup'].includes(e.key.toLowerCase())) { inputs.up = true; changed = true; }
    if (['s', 'arrowdown'].includes(e.key.toLowerCase())) { inputs.down = true; changed = true; }
    if (['a', 'arrowleft'].includes(e.key.toLowerCase())) { inputs.left = true; changed = true; }
    if (['d', 'arrowright'].includes(e.key.toLowerCase())) { inputs.right = true; changed = true; }
    if (e.code === 'Space' && !inputs.kick) { inputs.kick = true; changed = true; }
    
    e.preventDefault(); // Stop page scroll from arrow keys
    if (changed) updateInputs();
});

window.addEventListener('keyup', e => {
    if (!currentRoomId) return;
    let changed = false;
    if (['w', 'arrowup'].includes(e.key.toLowerCase())) { inputs.up = false; changed = true; }
    if (['s', 'arrowdown'].includes(e.key.toLowerCase())) { inputs.down = false; changed = true; }
    if (['a', 'arrowleft'].includes(e.key.toLowerCase())) { inputs.left = false; changed = true; }
    if (['d', 'arrowright'].includes(e.key.toLowerCase())) { inputs.right = false; changed = true; }
    if (e.code === 'Space') { inputs.kick = false; changed = true; }
    
    if (changed) updateInputs();
});
