const socket = io();

window.onerror = function(msg, url, line, col, error) {
    console.error(`JS ERROR: ${msg} at ${url}:${line}:${col}`);
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
const VERSION = 'v2.0.0';
console.log("Zoccer Client Version:", VERSION);

window.DEBUG_START = () => {
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

document.getElementById('btn-play-now').addEventListener('click', () => showModal(nicknameModal));

document.getElementById('btn-submit-nickname').addEventListener('click', () => {
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
});

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
            currentRoomId = res.roomId;
            hideModal(practiceRoomModal);
            hideModal(roomListModal);
            goToCourt();
        } else {
            console.error("Practice creation failed:", res.error);
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
    const timeLimit = parseInt(document.getElementById('input-time-limit').value) || 3;
    const scoreLimit = parseInt(document.getElementById('input-score-limit').value) || 3;
    socket.emit('startGame', { timeLimit, scoreLimit });
});

document.getElementById('btn-lobby-leave').onclick = () => {
    socket.emit('leaveRoom');
    currentRoomId = null;
    gameStatus = 'LOBBY';
    gameLayer.classList.add('hidden');
    uiLayer.classList.remove('hidden');
    document.getElementById('chat-messages').innerHTML = '';
    loadRooms();
    showModal(roomListModal);
};

document.getElementById('btn-leave-room').onclick = () => {
    socket.emit('returnToLobby');
    document.getElementById('chat-messages').innerHTML = '';
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
    goToCourt();
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

socket.on('gameEnded', (result) => {
    gameStatus = 'LOBBY';
    document.getElementById('chat-messages').innerHTML = '';
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
    }
});

// --- Game Loop & Rendering ---
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
let FIELD_W = 1200;
let FIELD_H = 600;
let GT = 200;
let GB = 400;

const MAP_THEMES = {
    classic:  { grassA: '#4ade80', grassB: '#3dd56a', border: '#166534' },
    arctic:   { grassA: '#7dd3fc', grassB: '#38bdf8', border: '#075985' },
    desert:   { grassA: '#fde047', grassB: '#facc15', border: '#854d0e' },
    midnight: { grassA: '#a78bfa', grassB: '#8b5cf6', border: '#4c1d95' }
};

let crowdSeed = Array.from({length: 40}, () => ({
    x: Math.random() * 1200,
    y: Math.random() > 0.5 ? -40 : 640,
    color: Math.random() > 0.5 ? '#ef4444' : '#3b82f6',
    offset: Math.random() * Math.PI * 2
}));

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

function goToCourt() {
    gameStatus = 'PLAYING';
    uiLayer.classList.add('hidden');
    const b = document.getElementById('bracket-layer');
    if (b) b.classList.add('hidden');
    gameLayer.classList.remove('hidden');
    resizeCanvas();
}

let gameState = null;
let previousGameState = null;
let lastStateTime = Date.now();
let localPlayerPos = { x: 0, y: 0, vx: 0, vy: 0 };

socket.on('gameState', state => {
    if (gameStatus !== 'PLAYING') return;
    
    previousGameState = gameState; // Store previous to interpolate
    gameState = state;
    lastStateTime = Date.now();

    if (state.fieldWidth) {
        FIELD_W = state.fieldWidth;
        FIELD_H = state.fieldHeight;
        GT = state.goalTop;
        GB = state.goalBottom;
        resizeCanvas();
    }
    
    // Smooth reconciliation for Local Player
    const me = state.players.find(p => p.id === socket.id);
    if (me) {
        // If drift is too large, snap. Otherwise nudging happens in render loop.
        const dx = me.x - localPlayerPos.x;
        const dy = me.y - localPlayerPos.y;
        if (Math.sqrt(dx*dx + dy*dy) > 100) {
            localPlayerPos.x = me.x;
            localPlayerPos.y = me.y;
        } else {
            // Apply server velocity to our local estimate immediately
            localPlayerPos.vx = me.vx;
            localPlayerPos.vy = me.vy;
        }
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

function drawHexagon(x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        ctx.lineTo(x + r * Math.cos(i * Math.PI / 3), y + r * Math.sin(i * Math.PI / 3));
    }
    ctx.closePath();
}

function drawCrowd(theme) {
    const now = Date.now();
    crowdSeed.forEach(fan => {
        const bounce = Math.sin(now / 200 + fan.offset) * 5;
        ctx.beginPath();
        const fanY = fan.y < 0 ? fan.y + bounce : fan.y - bounce;
        ctx.arc(fan.x, fanY, 8, 0, Math.PI * 2);
        ctx.fillStyle = fan.color;
        ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke();
    });
}

function render() {
    if (!gameState) { requestAnimationFrame(render); return; }
    
    const theme = MAP_THEMES[gameState.mapTheme] || MAP_THEMES.classic;
    const now = Date.now();
    const tickDuration = 1000 / 64; 
    let blend = (now - lastStateTime) / tickDuration;
    if (blend > 1.2) blend = 1.2; // Allow slight extrapolation to hide jitter
    if (blend < 0) blend = 0;

    // Draw Stadium Background
    ctx.fillStyle = theme.border;
    ctx.fillRect(-100, -100, FIELD_W + 200, FIELD_H + 200);

    // Draw Crowd
    drawCrowd(theme);

    // Draw Pitch
    ctx.clearRect(0, 0, FIELD_W, FIELD_H);
    for (let x = 0; x < FIELD_W; x += 120) {
        ctx.fillStyle = x % 240 === 0 ? theme.grassA : theme.grassB;
        ctx.fillRect(x, 0, 120, FIELD_H);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(FIELD_W/2, 0); ctx.lineTo(FIELD_W/2, FIELD_H); ctx.stroke();
    ctx.beginPath(); ctx.arc(FIELD_W/2, FIELD_H/2, 60, 0, Math.PI*2); ctx.stroke();
    ctx.strokeRect(0, FIELD_H/4, FIELD_W * 0.08, FIELD_H/2);
    ctx.strokeRect(FIELD_W - FIELD_W * 0.08, FIELD_H/4, FIELD_W * 0.08, FIELD_H/2);
    
    // Draw Goal Posts
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#333'; ctx.lineWidth = 3;
    const posts = [{x:0, y:GT}, {x:0, y:GB}, {x:FIELD_W, y:GT}, {x:FIELD_W, y:GB}];
    posts.forEach(p => {
        ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    });

    gameState.players.forEach(p => {
        let drawX = p.x;
        let drawY = p.y;

        // Apply Local Response for Player 1
        if (p.id === socket.id) {
            localPlayerPos.x += (p.x - localPlayerPos.x) * 0.2;
            localPlayerPos.y += (p.y - localPlayerPos.y) * 0.2;
            drawX = localPlayerPos.x;
            drawY = localPlayerPos.y;
        } else if (previousGameState) {
            // Smooth Interpolation with velocity-informed extrapolation for zero-lag visuals
            const prevP = previousGameState.players.find(pp => pp.id === p.id);
            if (prevP) {
                const vx = (p.x - prevP.x);
                const vy = (p.y - prevP.y);
                drawX = p.x + vx * (blend - 1);
                drawY = p.y + vy * (blend - 1);
            }
        }

        ctx.beginPath(); ctx.arc(drawX, drawY, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.team === 'red' ? '#ef4444' : '#3b82f6'; ctx.fill();
        ctx.beginPath(); ctx.arc(drawX, drawY, p.radius - 3, 0, Math.PI * 2);
        ctx.strokeStyle = p.team === 'red' ? '#991b1b' : '#1e40af'; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(drawX, drawY, p.radius, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.stroke();
        
        const flagImg = getFlagImage(p.flag || 'un');
        if (flagImg.complete && flagImg.naturalWidth > 0) {
            ctx.save(); ctx.beginPath(); ctx.arc(drawX, drawY - 4, 10, 0, Math.PI * 2); ctx.clip();
            ctx.drawImage(flagImg, drawX - 10, drawY - 14, 20, 20); ctx.restore();
        }
        ctx.fillStyle = 'white'; ctx.strokeStyle = 'black'; ctx.lineWidth = 2; ctx.font = 'bold 12px Inter';
        ctx.strokeText(p.number || '', drawX, drawY + 8); ctx.fillText(p.number || '', drawX, drawY + 8);
        ctx.font = 'bold 12px Inter'; ctx.strokeText(p.nickname, drawX, drawY + 25); ctx.fillText(p.nickname, drawX, drawY + 25);
        if (p.inputs && p.inputs.kick) {
            ctx.beginPath(); ctx.arc(drawX, drawY, p.radius + 4, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'; ctx.lineWidth = 3; ctx.stroke();
        }
    });

    const b = gameState.ball;
    let drawBX = b.x;
    let drawBY = b.y;

    if (previousGameState) {
        const vbx = (b.x - previousGameState.ball.x);
        const vby = (b.y - previousGameState.ball.y);
        drawBX = b.x + vbx * (blend - 1);
        drawBY = b.y + vby * (blend - 1);
    }

    ctx.save();
    ctx.translate(drawBX, drawBY);
    // Draw ball body
    ctx.beginPath(); ctx.arc(0, 0, b.radius, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke();
    // Hexagonal pattern
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 1;
    drawHexagon(0, 0, b.radius * 0.4); ctx.stroke();
    for(let i=0; i<6; i++) {
        const ang = i * Math.PI/3;
        const hx = b.radius * 0.7 * Math.cos(ang);
        const hy = b.radius * 0.7 * Math.sin(ang);
        drawHexagon(hx, hy, b.radius * 0.3); ctx.stroke();
    }
    ctx.restore();

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
        
        // Instant Prediction: Move local position estimate immediately
        const acc = 0.35;
        if (inputs.up) localPlayerPos.vy -= acc;
        if (inputs.down) localPlayerPos.vy += acc;
        if (inputs.left) localPlayerPos.vx -= acc;
        if (inputs.right) localPlayerPos.vx += acc;
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

// --- Chat Logic ---
const chatWidget = document.getElementById('chat-widget');
const chatToggle = document.getElementById('chat-toggle');
const chatContent = document.getElementById('chat-content');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('input-chat');

chatToggle.addEventListener('click', () => {
    chatContent.classList.toggle('minimized');
});

chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        const text = chatInput.value.trim();
        if (text) {
            socket.emit('chatMessage', text);
            chatInput.value = '';
        }
    }
    e.stopPropagation(); // Avoid triggering game inputs while typing
});

socket.on('chatMessage', data => {
    const el = document.createElement('div');
    el.className = 'chat-msg';
    const color = data.team === 'red' ? '#fca5a5' : (data.team === 'blue' ? '#93c5fd' : '#fff');
    el.innerHTML = `<b style="color:${color}">${data.sender}:</b> ${data.text}`;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Auto-expand if minimized and new message arrives
    if (chatContent.classList.contains('minimized')) {
        chatContent.classList.remove('minimized');
    }
});

window.addEventListener('keydown', e => {
    if (e.key === 'Enter' && document.activeElement !== chatInput) {
        chatInput.focus();
        e.preventDefault();
    }
});
