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

// --- Profile Preview ---
const previewCanvas = document.getElementById('preview-canvas');
const pCtx = previewCanvas.getContext('2d');
function drawPreview() {
    pCtx.clearRect(0,0,80,80);
    pCtx.beginPath();
    pCtx.arc(40, 40, 30, 0, Math.PI * 2);
    pCtx.fillStyle = '#1e293b'; // Base neutral circle
    pCtx.fill();
    pCtx.lineWidth = 3;
    pCtx.strokeStyle = '#000';
    pCtx.stroke();
    
    // Draw Flag
    pCtx.font = '28px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla"';
    pCtx.textAlign = 'center';
    pCtx.textBaseline = 'middle';
    const flag = document.getElementById('input-flag').value;
    pCtx.fillStyle = 'white';
    pCtx.fillText(flag, 40, 30); // Draw slightly above center

    // Draw Number
    pCtx.fillStyle = 'white';
    pCtx.strokeStyle = 'black';
    pCtx.lineWidth = 3;
    pCtx.font = 'bold 16px Inter';
    const num = document.getElementById('input-number').value || '?';
    pCtx.strokeText(num, 40, 52);
    pCtx.fillText(num, 40, 52);
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
    if (val.length >= 1 && val.length <= 5) {
        myNickname = val;
        myFlag = document.getElementById('input-flag').value;
        myNumber = document.getElementById('input-number').value || 10;
        loadRooms();
        showModal(roomListModal);
    } else {
        alert("Must be 1-5 letters.");
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

document.getElementById('btn-refresh-rooms').onclick = loadRooms;
document.getElementById('btn-open-create-room').onclick = () => showModal(createRoomModal);
document.getElementById('btn-cancel-create').onclick = () => showModal(roomListModal);

document.getElementById('btn-create-room').onclick = () => {
    const name = document.getElementById('input-room-name').value;
    const pwd = document.getElementById('input-room-password').value;
    const max = parseInt(document.getElementById('input-room-max').value);
    const mode = document.getElementById('input-room-mode').value;
    const tourneyTeams = parseInt(document.getElementById('input-tourney-teams').value);
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

    const mapPlayers = list => list.map(p => `
        <li>
            <span><b>${p.number}</b> ${p.nickname} ${p.flag} ${p.id === data.adminId ? '👑' : ''}</span>
            ${isRoomAdmin ? `<div class="player-controls">
                <button class="btn tiny ghost" onclick="adminMove('${p.id}', 'red')">R</button>
                <button class="btn tiny ghost" onclick="adminMove('${p.id}', 'spec')">S</button>
                <button class="btn tiny ghost" onclick="adminMove('${p.id}', 'blue')">B</button>
            </div>` : ''}
        </li>
    `).join('');
    
    document.getElementById('lobby-red-list').innerHTML = mapPlayers(data.players.filter(p => p.team === 'red'));
    document.getElementById('lobby-blue-list').innerHTML = mapPlayers(data.players.filter(p => p.team === 'blue'));
    document.getElementById('lobby-spec-list').innerHTML = mapPlayers(data.players.filter(p => p.team === 'spec'));
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
    gameLayer.classList.add('hidden');
    uiLayer.style.display = 'flex';
    showModal(roomLobbyModal);
    if(result && result.msg) alert(result.msg);
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

// --- Game/Canvas Logic ---
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const FIELD_W = 1200;
const FIELD_H = 600;

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

let lastStateTime = Date.now();
socket.on('gameState', state => {
    if (gameStatus !== 'PLAYING') return;
    
    lastStateTime = Date.now();
    gameState = state;
    // Show event overlay if present
    const overlay = document.getElementById('game-event-overlay');
    if (state.eventMsg) {
        document.getElementById('game-event-text').innerText = state.eventMsg;
        overlay.classList.remove('hidden');
    } else {
        overlay.classList.add('hidden');
    }

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
    
    // Extrapolate logic Delta calculation
    const now = Date.now();
    let dt = (now - lastStateTime) / (1000 / 60); // 1.0 dt = 1 tick elapsed
    if (dt > 3) dt = 3; // Clamp huge lag spikes

    ctx.clearRect(0, 0, FIELD_W, FIELD_H);
    
    // Draw Field Map
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(FIELD_W/2, 0); ctx.lineTo(FIELD_W/2, FIELD_H); ctx.stroke();
    ctx.beginPath(); ctx.arc(FIELD_W/2, FIELD_H/2, 50, 0, Math.PI*2); ctx.stroke();
    ctx.strokeRect(0, FIELD_H/4, 100, FIELD_H/2);
    ctx.strokeRect(FIELD_W-100, FIELD_H/4, 100, FIELD_H/2);
    
    // Goals - Using black/white checker or simple contrast
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 200, 20, 200);   // Red Goal Net inside
    ctx.fillRect(FIELD_W - 20, 200, 20, 200); // Blue Goal Net inside
    
    // Goal posts
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, 200, 8, 0, Math.PI*2); ctx.fill(); // Top left
    ctx.beginPath(); ctx.arc(0, 400, 8, 0, Math.PI*2); ctx.fill(); // Bot left
    ctx.beginPath(); ctx.arc(FIELD_W, 200, 8, 0, Math.PI*2); ctx.fill(); // Top right
    ctx.beginPath(); ctx.arc(FIELD_W, 400, 8, 0, Math.PI*2); ctx.fill(); // Bot right

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
        
        // Draw Flag Emoji (Fallbacks will use correct white context if missing OS emoji fonts)
        ctx.fillStyle = 'white';
        ctx.font = '22px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla"';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.flag || '🏳️', ex, ey - 4);

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

// Input handling
const inputs = { up: false, down: false, left: false, right: false, kick: false };

function updateInputs() {
    if (currentRoomId) socket.emit('inputs', inputs);
}

window.addEventListener('keydown', e => {
    if (!currentRoomId) return;
    let changed = false;
    if (['w', 'ArrowUp'].includes(e.key.toLowerCase())) { inputs.up = true; changed = true; }
    if (['s', 'ArrowDown'].includes(e.key.toLowerCase())) { inputs.down = true; changed = true; }
    if (['a', 'ArrowLeft'].includes(e.key.toLowerCase())) { inputs.left = true; changed = true; }
    if (['d', 'ArrowRight'].includes(e.key.toLowerCase())) { inputs.right = true; changed = true; }
    if (e.code === 'Space' && !inputs.kick) { inputs.kick = true; changed = true; }
    
    if (changed) updateInputs();
});

window.addEventListener('keyup', e => {
    if (!currentRoomId) return;
    let changed = false;
    if (['w', 'ArrowUp'].includes(e.key.toLowerCase())) { inputs.up = false; changed = true; }
    if (['s', 'ArrowDown'].includes(e.key.toLowerCase())) { inputs.down = false; changed = true; }
    if (['a', 'ArrowLeft'].includes(e.key.toLowerCase())) { inputs.left = false; changed = true; }
    if (['d', 'ArrowRight'].includes(e.key.toLowerCase())) { inputs.right = false; changed = true; }
    if (e.code === 'Space') { inputs.kick = false; changed = true; }
    
    if (changed) updateInputs();
});
