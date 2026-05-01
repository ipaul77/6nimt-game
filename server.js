const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const rooms = {};
const botAvatars = ['👨‍💼', '👩‍💼', '👨‍⚕️', '👩‍⚕️', '👨‍🎓', '👩‍🎓', '👨‍🍳', '👩‍🍳', '👨‍🎤', '👩‍🎤', '👨‍🏫', '👩‍🏫', '🕵️‍♂️', '🕵️‍♀️', '👨‍🚀'];

// 1. 벌점(소머리) 계산 함수
function calculateBullheads(number) {
    if (number === 55) return 7;
    if (number % 11 === 0) return 5;
    if (number % 10 === 0) return 3;
    if (number % 5 === 0) return 2;
    return 1;
}

// 2. 카드 덱 생성 (1~104)
function createDeck() {
    let newDeck = [];
    for (let i = 1; i <= 104; i++) {
        newDeck.push({ number: i, bullheads: calculateBullheads(i) });
    }
    return newDeck;
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// 3. 방 초기화 함수
function initRoom(roomName) {
    return {
        name: roomName,
        players: [], 
        deck: [], 
        rows: [[], [], [], []], 
        submittedCards: [], 
        phase: 'PLAYING', 
        botCounter: 1, 
        isGameRunning: false
    };
}

function broadcastRoomList() {
    const availableRooms = [];
    for (const roomId in rooms) {
        const room = rooms[roomId];
        if (!room.isGameRunning) { 
            const host = room.players.find(p => p.isHost);
            availableRooms.push({
                id: roomId, name: room.name, hostName: host ? host.name : '알 수 없음', playerCount: room.players.length
            });
        }
    }
    io.to('lobby').emit('roomList', availableRooms);
}

function broadcastGameState(roomId) {
    const room = rooms[roomId];
    if(!room || !room.isGameRunning || room.players.length === 0) return;
    
    room.players.forEach(player => {
        if (!player.isBot) {
            io.to(player.id).emit('updateGame', {
                rows: room.rows, phase: room.phase, myHand: player.hand, myPenalty: player.penalty,
                submittedStatus: room.players.map(p => ({
                    id: p.id, hasSubmitted: room.submittedCards.some(sc => sc.playerId === p.id)
                })),
                playersInfo: room.players.map(p => ({ 
                    id: p.id, name: p.name, avatar: p.avatar, cardCount: p.hand.length, penalty: p.penalty, isHost: p.isHost 
                }))
            });
        }
    });
}

// 봇 타이머 실행 방어 로직이 포함된 봇 트리거
function triggerBots(roomId) {
    const room = rooms[roomId];
    if (!room || !room.isGameRunning || room.phase !== 'PLAYING') return;

    room.players.forEach(p => {
        if (p.isBot && p.hand.length > 0) {
            const hasSubmitted = room.submittedCards.some(sc => sc.playerId === p.id);
            if (!hasSubmitted) {
                setTimeout(() => {
                    const currentRoom = rooms[roomId];
                    if (!currentRoom || !currentRoom.isGameRunning || currentRoom.phase !== 'PLAYING') return;

                    // 타이머 실행 시점에 한 번 더 중복 및 손패 검증 (봇 멈춤 방지)
                    const alreadySubmittedNow = currentRoom.submittedCards.some(sc => sc.playerId === p.id);
                    if (alreadySubmittedNow || p.hand.length === 0) return;

                    const randomIdx = Math.floor(Math.random() * p.hand.length);
                    const playedCard = p.hand.splice(randomIdx, 1)[0];
                    currentRoom.submittedCards.push({ playerId: p.id, card: playedCard });
                    checkAllCardsSubmitted(roomId);
                }, 1000 + Math.random() * 2000); 
            }
        }
    });
}

function checkAllCardsSubmitted(roomId) {
    const room = rooms[roomId];
    broadcastGameState(roomId); 

    if (room.submittedCards.length === room.players.length) {
        room.phase = 'RESOLVING';
        // 공개된 카드를 작은 숫자부터 오름차순 정렬
        room.submittedCards.sort((a, b) => a.card.number - b.card.number);
        
        io.to(roomId).emit('systemMessage', `모든 카드가 공개되었습니다! 숫자 순서대로 배치합니다.`);
        setTimeout(() => processNextCard(roomId), 1500); 
    }
}

// 4. 핵심 알고리즘: 카드 배치 및 벌점 판정
function processNextCard(roomId) {
    const room = rooms[roomId];
    if (!room || !room.isGameRunning) return;

    if (room.submittedCards.length === 0) {
        const isRoundOver = room.players.every(p => p.hand.length === 0);
        if (isRoundOver) { endRound(roomId); } 
        else {
            room.phase = 'PLAYING';
            broadcastGameState(roomId);
            triggerBots(roomId); 
        }
        return;
    }

    const currentPlay = room.submittedCards.shift();
    const player = room.players.find(p => p.id === currentPlay.playerId);
    const card = currentPlay.card;

    let targetRowIndex = -1;
    let minDiff = Infinity;

    // 카드가 놓일 위치(행) 찾기
    for (let i = 0; i < 4; i++) {
        const row = room.rows[i];
        const lastCard = row[row.length - 1];
        if (card.number > lastCard.number) {
            const diff = card.number - lastCard.number;
            if (diff < minDiff) { minDiff = diff; targetRowIndex = i; }
        }
    }

    // 어떤 행의 카드보다도 숫자가 작을 때 (벌점 행 선택)
    if (targetRowIndex === -1) {
        if (player.isBot) {
            let minBullheads = Infinity; let bestRow = 0;
            for(let i=0; i<4; i++) {
                let bh = room.rows[i].reduce((sum, c) => sum + c.bullheads, 0);
                if(bh < minBullheads) { minBullheads = bh; bestRow = i; }
            }
            executeRowSelection(roomId, player, bestRow, card);
        } else {
            room.phase = 'WAITING_ROW';
            room.pendingPlayerId = player.id;
            room.pendingCard = card;
            io.to(roomId).emit('systemMessage', `${player.name}님이 교체할 행을 선택 중입니다...`);
            io.to(player.id).emit('requireRowSelection', { card: card, rows: room.rows });
            broadcastGameState(roomId);
        }
        return; 
    }

    room.rows[targetRowIndex].push(card);
    
    // 6번째 카드가 되었을 때 벌점 부여
    if (room.rows[targetRowIndex].length === 6) {
        const penaltyCards = room.rows[targetRowIndex].splice(0, 5);
        const penaltyScore = penaltyCards.reduce((sum, c) => sum + c.bullheads, 0);
        player.penalty += penaltyScore;
        io.to(roomId).emit('systemMessage', `💥 ${player.name}님이 6번째 카드를 놓아 벌점 ${penaltyScore}점을 받았습니다!`);
        io.to(roomId).emit('actionSound', 'penalty');
    } else {
        io.to(roomId).emit('actionSound', 'play');
    }

    broadcastGameState(roomId);
    setTimeout(() => processNextCard(roomId), 1500); 
}

function executeRowSelection(roomId, player, rowIndex, card) {
    const room = rooms[roomId];
    const penaltyCards = room.rows[rowIndex];
    const penaltyScore = penaltyCards.reduce((sum, c) => sum + c.bullheads, 0);
    player.penalty += penaltyScore;
    
    io.to(roomId).emit('systemMessage', `🔄 ${player.name}님이 행을 교체하고 벌점 ${penaltyScore}점을 가져갔습니다.`);
    io.to(roomId).emit('actionSound', 'penalty');

    room.rows[rowIndex] = [card]; 
    room.phase = 'RESOLVING';
    room.pendingPlayerId = null;
    room.pendingCard = null;

    broadcastGameState(roomId);
    setTimeout(() => processNextCard(roomId), 1500);
}

function endRound(roomId) {
    const room = rooms[roomId];
    room.isGameRunning = false;
    room.players.sort((a, b) => a.penalty - b.penalty); // 벌점 적은 순으로 정렬
    io.to(roomId).emit('gameOver', room.players); 
    io.to(roomId).emit('systemMessage', `라운드 종료! 1등: ${room.players[0].name} (벌점 ${room.players[0].penalty}점)`);
    broadcastRoomList();
}

// 방을 깔끔하게 초기화하는 공통 함수 (대기실 복귀 버그 완벽 해결)
function resetRoom(roomId) {
    const room = rooms[roomId];
    if(!room) return;
    room.isGameRunning = false;
    room.phase = 'WAITING';
    room.submittedCards = [];
    room.rows = [[], [], [], []];
    room.players.forEach(p => {
        p.hand = [];
        p.penalty = 0;
        p.isReady = p.isHost || p.isBot;
    });
    io.to(roomId).emit('gameStopped');
    io.to(roomId).emit('updatePlayers', room.players);
    broadcastRoomList();
}

io.on('connection', (socket) => {
    socket.join('lobby');
    broadcastRoomList();

    socket.on('createRoom', (data) => {
        const { nickname, avatar, roomName } = data;
        const roomId = 'room_' + Math.random().toString(36).substr(2, 6);
        rooms[roomId] = initRoom(roomName || `${nickname}의 테이블`);
        const room = rooms[roomId];
        socket.leave('lobby');
        socket.join(roomId);
        socket.roomId = roomId;
        room.players.push({ id: socket.id, name: nickname, avatar: avatar, hand: [], penalty: 0, isBot: false, isHost: true, isReady: true });
        socket.emit('joinSuccess', { isHost: true, roomName: room.name });
        io.to(roomId).emit('updatePlayers', room.players);
        broadcastRoomList(); 
    });

    socket.on('joinRoom', (data) => {
        const { nickname, avatar, roomId } = data;
        const room = rooms[roomId];
        if (!room) return socket.emit('joinError', '존재하지 않는 방입니다.');
        if (room.isGameRunning) return socket.emit('joinError', '현재 진행 중인 방입니다.');
        socket.leave('lobby');
        socket.join(roomId);
        socket.roomId = roomId;
        room.players.push({ id: socket.id, name: nickname, avatar: avatar, hand: [], penalty: 0, isBot: false, isHost: false, isReady: false });
        socket.emit('joinSuccess', { isHost: false, roomName: room.name });
        io.to(roomId).emit('updatePlayers', room.players);
        broadcastRoomList(); 
    });

    socket.on('addBots', (count) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.isHost) return; 
        
        const botsToAdd = Math.min(count, 10 - room.players.length); 
        for (let i = 0; i < botsToAdd; i++) {
            room.players.push({ 
                id: `bot_${roomId}_${Math.random()}`, name: `봇 ${room.botCounter++}`, avatar: botAvatars[Math.floor(Math.random() * botAvatars.length)],
                hand: [], penalty: 0, isBot: true, isHost: false, isReady: true 
            });
        }
        io.to(roomId).emit('updatePlayers', room.players);
    });

    socket.on('toggleReady', () => {
        const roomId = socket.roomId;
        const room = rooms[roomId];
        const player = room?.players.find(p => p.id === socket.id);
        if (player && !player.isHost && !room.isGameRunning) {
            player.isReady = !player.isReady;
            io.to(roomId).emit('updatePlayers', room.players);
        }
    });

    socket.on('startGame', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.isHost || room.players.length < 2 || !room.players.every(p => p.isReady)) return; 

        room.deck = shuffle(createDeck());
        room.players.forEach(p => { 
            p.hand = room.deck.splice(0, 10); 
            p.hand.sort((a, b) => a.number - b.number); 
            p.penalty = 0; 
        });
        
        room.rows = [[room.deck.pop()], [room.deck.pop()], [room.deck.pop()], [room.deck.pop()]];
        room.submittedCards = [];
        room.phase = 'PLAYING';
        room.isGameRunning = true; 
        
        io.to(roomId).emit('gameStarted');
        io.to(roomId).emit('systemMessage', `게임이 시작되었습니다. 카드를 한 장 선택하세요!`);
        broadcastGameState(roomId);
        broadcastRoomList(); 

        triggerBots(roomId); 
    });

    socket.on('submitCard', (cardIndex) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        if (room.phase !== 'PLAYING' || !room.isGameRunning) return;
        
        const player = room.players.find(p => p.id === socket.id);
        const alreadySubmitted = room.submittedCards.some(sc => sc.playerId === player.id);
        if (alreadySubmitted) return; 

        const playedCard = player.hand.splice(cardIndex, 1)[0];
        room.submittedCards.push({ playerId: player.id, card: playedCard });
        
        checkAllCardsSubmitted(roomId);
    });

    socket.on('selectRow', (rowIndex) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        if (room.phase !== 'WAITING_ROW' || room.pendingPlayerId !== socket.id) return;
        const player = room.players.find(p => p.id === socket.id);
        executeRowSelection(roomId, player, rowIndex, room.pendingCard);
    });

    // 게임 중단 및 복귀 시 조건 없이 강제 초기화 보장
    socket.on('stopGame', () => {
        const room = rooms[socket.roomId];
        const player = room?.players.find(p => p.id === socket.id);
        if (player && player.isHost) resetRoom(socket.roomId);
    });

    socket.on('returnToLobby', () => {
        const room = rooms[socket.roomId];
        const player = room?.players.find(p => p.id === socket.id);
        if (player && player.isHost) resetRoom(socket.roomId);
    });

    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== -1) {
            const wasHost = room.players[playerIndex].isHost;
            room.players.splice(playerIndex, 1);
            const realPlayers = room.players.filter(p => !p.isBot);
            
            if (realPlayers.length === 0) {
                delete rooms[roomId]; 
                broadcastRoomList();
            } else {
                if (wasHost) { realPlayers[0].isHost = true; realPlayers[0].isReady = true; }
                if (room.isGameRunning) {
                    io.to(roomId).emit('systemMessage', `플레이어 이탈로 게임이 무효화되었습니다.`);
                    resetRoom(roomId);
                } else {
                    io.to(roomId).emit('updatePlayers', room.players);
                    broadcastRoomList();
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`젝스님트 서버 실행 중. 포트: ${PORT}`));