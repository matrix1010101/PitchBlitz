const socket = io();

window.onerror = function(msg, url, line, col, error) {
    alert(`CRITICAL ERROR:\n${msg}\nAt: ${url}:${line}:${col}`);
    return false;
};

// UI Elements
const uiLayer = document.getElementById('ui-layer');
const gameLayer = document.getElementById('game-layer');
const landingModal = document.getElementById('landing-modal');
const nicknameModal = document.getElementById('nickname-modal');
const roomListModal = document.getElementById('room-list-modal');
const createRoomModal = document.getElementById('create-room-modal');
const passwordModal = document.getElementById('password-modal');
const roomLobbyModal = document.getElementById('room-lobby-modal');
const practiceRoomModal = document.getElementById('practice-room-modal');

let myNickname = '';
let myFlag = '🏳️';
let myNumber = 10;
let currentRoomId = null;
let isRoomAdmin = false;
let gameStatus = 'LOBBY'; 
const VERSION = 'v1.0.7';
console.log("Zoccer Client Version:", VERSION);
alert("Zoccer " + VERSION + " Loaded!");

window.DEBUG_START = () => {
    console.warn("DEBUG: Forcing game start signal...");
    socket.emit('startGame', { timeLimit: 3, scoreLimit: 3 });
};

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
    
    const codeInput = document.getElementById('input-flag');
    if (!codeInput) return;
    const code = codeInput.value;
    const flagImg = getFlagImage(code);
    if (flagImg.complete && flagImg.naturalWidth > 0) {
        pCtx.save();
        pCtx.beginPath();
        pCtx.arc(40, 33, 14, 0, Math.PI * 2);
        pCtx.clip();
        pCtx.drawImage(flagImg, 26, 19, 28, 28);
        pCtx.restore();
    }

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
function hideModal(modal) {
    if (modal) modal.classList.remove('active');
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

const inputRoomMode = document.getElementById('input-room-mode');
inputRoomMode.addEventListener('change', (e) => {
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
    document.getElementById('input-room-max').value = parseInt(e.target.value) * 2;
});

document.getElementById('btn-refresh-rooms').onclick = loadRooms;
document.getElementById('btn-open-create-room').onclick = () => showModal(createRoomModal);
document.getElementById('btn-cancel-create').onclick = () => showModal(roomListModal);
document.getElementById('btn-open-practice').onclick = () => showModal(practiceRoomModal);
document.getElementById('btn-cancel-practice').onclick = () => showModal(roomListModal);

document.getElementById('btn-create-room').onclick = () => {
    const name = document.getElementById('input-room-name').value;
    const pwd = document.getElementById('input-room-password').value;
    const mode = inputRoomMode.value;
    const isTourney = mode === 'tournament';
    const tourneyTeams = parseInt(document.getElementById('input-tourney-teams').value) || 4;
    const max = isTourney ? tourneyTeams * 2 : parseInt(document.getElementById('input-room-max').value);
    
    if (!name) return alert("Room name required");
    
    socket.emit('createRoom', { 
        name, password: pwd, maxPlayers: max, mode, tourneyTeams, 
        nickname: myNickname, flag: myFlag, number: myNumber 
    }, (res) => {
        if (res.success) enterLobby(res.roomId);
        else alert(res.error);
    });
};

document.getElementById('btn-start-practice').addEventListener('click', () => {
    alert("ACTION: Start Practice Clicked!");
    const type = document.getElementById('input-practice-type').value;
    socket.emit('createRoom', {
        name: myNickname + "'s Practice",
        password: '',
        maxPlayers: type === 'bots_3v3' ? 6 : (type === 'bots_2v2' ? 4 : 2),
        mode: 'single',
        isPractice: true,
        practiceType: type,
        nickname: myNickname,
        flag: myFlag,
        number: myNumber
    }, (res) => {
        if (res.success) {
            console.log("Practice room created:", res.roomId);
            currentRoomId = res.roomId;
            hideModal(practiceRoomModal);
            hideModal(roomListModal);
            alert("SUCCESS: Practice Mode Started! Moving to court...");
            goToCourt();
        } else {
            console.error("Practice creation failed:", res.error);
            alert("SERVER ERROR: " + res.error);
        }
    });
});

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
        if (res.success) enterLobby(id);
        else {
            alert(res.error);
            showModal(roomListModal);
        }
    });
}

function enterLobby(roomId) {
    currentRoomId = roomId;
    gameStatus = 'LOBBY';
    gameLayer.classList.add('hidden');
    uiLayer.classList.remove('hidden');
    showModal(roomLobbyModal);
    document.getElementById('lobby-room-name').innerText = "Room Lobby";
}

socket.on('lobbyUpdate', data => {
    if (gameStatus !== 'LOBBY') return;
    
    const adminPanel = document.getElementById('admin-controls-panel');
    isRoomAdmin = (data.adminId === socket.id);
    if(isRoomAdmin) adminPanel.classList.remove('hidden');
    else adminPanel.classList.add('hidden');

    const flagImg = code => `<img src="https://flagcdn.com/w20/${code || 'un'}.png" style="width:18px;height:12px;border-radius:2px;vertical-align:middle;margin-right:4px;">`;
    const container = document.getElementById('lobby-container');

    if (data.mode === 'tournament') {
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

window.adminMove = function(playerId, team) {
    socket.emit('adminMovePlayer', { playerId, team });
}

document.getElementById('btn-start-game').addEventListener('click', () => {
    alert("ACTION: Start Game Clicked!");
    const timeLimit = parseInt(document.getElementById('input-time-limit').value) || 3;
    const scoreLimit = parseInt(document.getElementById('input-score-limit').value) || 3;
    console.log("Requesting Match Start...", { timeLimit, scoreLimit });
    alert("SIGNAL: Start Match Request Sent to Server...");
    socket.emit('startGame', { timeLimit, scoreLimit });
});

document.getElementById('btn-lobby-leave').onclick = () => {
    socket.emit('leaveRoom');
    currentRoomId = null;
    gameStatus = 'LOBBY';
    gameLayer.classList.add('hidden');
    uiLayer.classList.remove('hidden');
    loadRooms();
    showModal(roomListModal);
};

document.getElementById('btn-leave-room').onclick = () => {
    socket.emit('returnToLobby');
};

socket.on('showBracket', (bracketData) => {
    gameStatus = 'BRACKET';
    uiLayer.classList.add('hidden');
    gameLayer.classList.add('hidden');
    document.getElementById('bracket-layer').classList.remove('hidden');
    
    if (isRoomAdmin) {
        document.getElementById('btn-advance-bracket').classList.remove('hidden');
    }

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

socket.on('gameStarted', () => {
    console.log("Event: gameStarted received from server");
    alert("Game Started! Moving to court...");
    goToCourt();
});

function goToCourt() {
    try {
        console.log("Transitioning to court view...");
        gameStatus = 'PLAYING';
        uiLayer.classList.add('hidden');
        const bracket = document.getElementById('bracket-layer');
        if (bracket) bracket.classList.add('hidden');
        gameLayer.classList.remove('hidden');
        resizeCanvas();
    } catch (e) {
        alert("Error in goToCourt: " + e.message);
    }
}

socket.on('gameEnded', (result) => {
    gameStatus = 'LOBBY';
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
            uiLayer.classList.remove('hidden');
            showModal(roomLobbyModal);
        }, 4000);
    } else {
        gameLayer.classList.add('hidden');
        uiLayer.classList.remove('hidden');
        showModal(roomLobbyModal);
        if(result && result.msg) alert(result.msg);
    }
});

// --- Celebration System ---
const celebOverlay = document.getElementById('celebration-overlay');
const celebTitle = document.getElementById('celebration-title');
const celebSub = document.getElementById('celebration-sub');

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
    celebOverlay.style.background = bgColor ? `radial-gradient(ellipse at center, ${bgColor}55 0%, rgba(0,0,0,0.7) 100%)` : 'rgba(0,0,0,0.6)';
    celebOverlay.classList.add('active');
    spawnConfetti(isWin ? 150 : 80);
}

function hideCelebration() {
    celebOverlay.classList.remove('active');
}

socket.on('goalScored', (data) => {
    const color = data.team === 'red' ? '#ef4444' : '#3b82f6';
    showCelebration(`⚽ GOAL! ${data.team.toUpperCase()}`, `Score: ${data.score.red} - ${data.score.blue}`, color);
    setTimeout(hideCelebration, 2800);
});

// --- Game Loop & Rendering ---
let localPredicted = { x: 0, y: 0, vx: 0, vy: 0, active: false };
let localPredicted2 = { x: 0, y: 0, vx: 0, vy: 0, active: false };

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
let FIELD_W = 1200;
let FIELD_H = 600;
let GOAL_T = 200;
let GOAL_B = 400;

function resizeCanvas() {
    const ratio = FIELD_W / FIELD_H;
    let w = window.innerWidth;
    let h = window.innerHeight;
    if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
    canvas.width = FIELD_W;
    canvas.height = FIELD_H;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
}
window.addEventListener('resize', resizeCanvas);

let gameState = null;
let lastStateTime = Date.now();
socket.on('gameState', state => {
    if (gameStatus !== 'PLAYING') return;
    lastStateTime = Date.now();
    if (state.fieldWidth) {
        FIELD_W = state.fieldWidth;
        FIELD_H = state.fieldHeight;
        GOAL_T = state.goalTop;
        GOAL_B = state.goalBottom;
        resizeCanvas();
    }
    gameState = state;

    const me = state.players.find(p => p.id === socket.id);
    if (me) {
        const dx = me.x - localPredicted.x, dy = me.y - localPredicted.y;
        if (Math.sqrt(dx*dx + dy*dy) > 40) { localPredicted.x = me.x; localPredicted.y = me.y; }
        else { localPredicted.x += dx * 0.35; localPredicted.y += dy * 0.35; }
        localPredicted.vx = me.vx || 0; localPredicted.vy = me.vy || 0; localPredicted.active = true;
    }

    const p2 = state.players.find(p => p.isLocalP2);
    if (p2) {
        const dx = p2.x - localPredicted2.x, dy = p2.y - localPredicted2.y;
        if (Math.sqrt(dx*dx + dy*dy) > 40) { localPredicted2.x = p2.x; localPredicted2.y = p2.y; }
        else { localPredicted2.x += dx * 0.35; localPredicted2.y += dy * 0.35; }
        localPredicted2.vx = p2.vx || 0; localPredicted2.vy = p2.vy || 0; localPredicted2.active = true;
    }

    document.getElementById('score-red').innerText = state.score.red;
    document.getElementById('score-blue').innerText = state.score.blue;
    const pad = n => n.toString().padStart(2, '0');
    document.getElementById('game-timer').innerText = `${pad(Math.floor(state.timeRemaining / 60))}:${pad(state.timeRemaining % 60)}`;

    if(state.tournament) {
        document.getElementById('tournament-banner').classList.remove('hidden');
        document.getElementById('agg-red').innerText = state.tournament.aggRed;
        document.getElementById('agg-blue').innerText = state.tournament.aggBlue;
        document.getElementById('tourney-leg').innerText = `Leg ${state.tournament.leg}`;
    } else document.getElementById('tournament-banner').classList.add('hidden');
});

const PRED_ACC = 0.35; 
const PRED_FRICTION = 0.92;

function render() {
    if (!gameState) { requestAnimationFrame(render); return; }
    const now = Date.now();
    let dt = (now - lastStateTime) / (1000 / 64); // Optimized for 64hz
    if (dt > 2) dt = 2;

    ctx.clearRect(0, 0, FIELD_W, FIELD_H);
    for (let x = 0; x < FIELD_W; x += 120) {
        ctx.fillStyle = x % 240 === 0 ? '#4ade80' : '#3dd56a';
        ctx.fillRect(x, 0, 120, FIELD_H);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(FIELD_W/2, 0); ctx.lineTo(FIELD_W/2, FIELD_H); ctx.stroke();
    ctx.beginPath(); ctx.arc(FIELD_W/2, FIELD_H/2, Math.min(FIELD_H * 0.1, 60), 0, Math.PI*2); ctx.stroke();
    ctx.strokeRect(0, FIELD_H/4, FIELD_W * 0.08, FIELD_H/2);
    ctx.strokeRect(FIELD_W - FIELD_W * 0.08, FIELD_H/4, FIELD_W * 0.08, FIELD_H/2);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, GOAL_T, 20, GOAL_B - GOAL_T);
    ctx.fillRect(FIELD_W - 20, GOAL_T, 20, GOAL_B - GOAL_T);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, GOAL_T, 8, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, GOAL_B, 8, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(FIELD_W, GOAL_T, 8, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(FIELD_W, GOAL_B, 8, 0, Math.PI*2); ctx.fill();

    gameState.players.forEach(p => {
        let ex, ey;
        let pred = null;
        if (p.id === socket.id && localPredicted.active) pred = localPredicted;
        else if (p.isLocalP2 && localPredicted2.active) pred = localPredicted2;
        if (pred) {
            pred.vx *= PRED_FRICTION; pred.vy *= PRED_FRICTION;
            pred.x += pred.vx; pred.y += pred.vy;
            pred.x = Math.max(p.radius, Math.min(FIELD_W - p.radius, pred.x));
            pred.y = Math.max(p.radius, Math.min(FIELD_H - p.radius, pred.y));
            ex = pred.x; ey = pred.y;
        } else {
            ex = p.x + ((p.inputs ? (p.vx || 0) : 0) * dt);
            ey = p.y + ((p.inputs ? (p.vy || 0) : 0) * dt);
            ex = Math.max(p.radius, Math.min(FIELD_W - p.radius, ex));
            ey = Math.max(p.radius, Math.min(FIELD_H - p.radius, ey));
        }

        ctx.beginPath(); ctx.arc(ex, ey, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.team === 'red' ? '#ef4444' : '#3b82f6'; ctx.fill();
        ctx.beginPath(); ctx.arc(ex, ey, p.radius - 3, 0, Math.PI * 2);
        ctx.strokeStyle = p.team === 'red' ? '#991b1b' : '#1e40af'; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(ex, ey, p.radius, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.stroke();
        
        const flagImg = getFlagImage(p.flag || 'un');
        if (flagImg.complete && flagImg.naturalWidth > 0) {
            ctx.save(); ctx.beginPath(); ctx.arc(ex, ey - 4, 10, 0, Math.PI * 2); ctx.clip();
            ctx.drawImage(flagImg, ex - 10, ey - 14, 20, 20); ctx.restore();
        }
        ctx.fillStyle = 'white'; ctx.strokeStyle = 'black'; ctx.lineWidth = 2; ctx.font = 'bold 12px Inter';
        ctx.strokeText(p.number || '', ex, ey + 8); ctx.fillText(p.number || '', ex, ey + 8);
        ctx.font = 'bold 12px Inter'; ctx.strokeText(p.nickname, ex, ey + 25); ctx.fillText(p.nickname, ex, ey + 25);
        if (p.inputs && p.inputs.kick) {
            ctx.beginPath(); ctx.arc(ex, ey, p.radius + 4, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'; ctx.lineWidth = 3; ctx.stroke();
        }
    });

    const b = gameState.ball;
    let bx = b.x + (b.vx || 0) * dt, by = b.y + (b.vy || 0) * dt;
    bx = Math.max(b.radius, Math.min(FIELD_W - b.radius, bx));
    by = Math.max(b.radius, Math.min(FIELD_H - b.radius, by));
    ctx.beginPath(); ctx.arc(bx, by, b.radius, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke();
    ctx.beginPath(); ctx.arc(bx, by, b.radius/2, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill();
    requestAnimationFrame(render);
}
requestAnimationFrame(render);

const inputs = { up: false, down: false, left: false, right: false, kick: false };
const inputs2 = { up: false, down: false, left: false, right: false, kick: false };
function updateInputs() { if (currentRoomId) socket.emit('inputs', { p1: inputs, p2: inputs2 }); }

window.addEventListener('keydown', e => {
    if (!currentRoomId || gameStatus !== 'PLAYING') return;
    let changed = false; const key = e.key.toLowerCase(), code = e.code;
    if (key === 'w') { inputs.up = true; changed = true; }
    if (key === 's') { inputs.down = true; changed = true; }
    if (key === 'a') { inputs.left = true; changed = true; }
    if (key === 'd') { inputs.right = true; changed = true; }
    if (code === 'Space') { inputs.kick = true; changed = true; }
    if (code === 'ArrowUp') { inputs2.up = true; changed = true; }
    if (code === 'ArrowDown') { inputs2.down = true; changed = true; }
    if (code === 'ArrowLeft') { inputs2.left = true; changed = true; }
    if (code === 'ArrowRight') { inputs2.right = true; changed = true; }
    if (key === '+' || code === 'NumpadAdd') { inputs2.kick = true; changed = true; }
    if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(key)) e.preventDefault();
    if (changed) {
        updateInputs();
        if (localPredicted.active) {
            if (inputs.up) localPredicted.vy -= PRED_ACC; if (inputs.down) localPredicted.vy += PRED_ACC;
            if (inputs.left) localPredicted.vx -= PRED_ACC; if (inputs.right) localPredicted.vx += PRED_ACC;
        }
        if (localPredicted2.active) {
            if (inputs2.up) localPredicted2.vy -= PRED_ACC; if (inputs2.down) localPredicted2.vy += PRED_ACC;
            if (inputs2.left) localPredicted2.vx -= PRED_ACC; if (inputs2.right) localPredicted2.vx += PRED_ACC;
        }
    }
});

window.addEventListener('keyup', e => {
    if (!currentRoomId) return;
    let changed = false; const key = e.key.toLowerCase(), code = e.code;
    if (key === 'w') { inputs.up = false; changed = true; }
    if (key === 's') { inputs.down = false; changed = true; }
    if (key === 'a') { inputs.left = false; changed = true; }
    if (key === 'd') { inputs.right = false; changed = true; }
    if (code === 'Space') { inputs.kick = false; changed = true; }
    if (code === 'ArrowUp') { inputs2.up = false; changed = true; }
    if (code === 'ArrowDown') { inputs2.down = false; changed = true; }
    if (code === 'ArrowLeft') { inputs2.left = false; changed = true; }
    if (code === 'ArrowRight') { inputs2.right = false; changed = true; }
    if (key === '+' || code === 'NumpadAdd') { inputs2.kick = false; changed = true; }
    if (changed) updateInputs();
});
