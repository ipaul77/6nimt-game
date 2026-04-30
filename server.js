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

// 1. 젝스님트 벌점(소머리) 계산 함수
function calculateBullheads(number) {
    if (number === 55) return 7;
    if (number % 11 === 0) return 5;
    if (number % 10 === 0) return 3;
    if (number % 5 === 0) return 2;
    return 1;
}

// 2. 1부터 104까지의 카드 덱 생성
function createDeck() {
    let newDeck = [];
    for (let i = 1; i <= 104; i++) {
        newDeck.push({
            number: i,
            bullheads: calculateBullheads(i)
        });
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

// 3. 방 초기화 구조 변경 (4개의 행, 제출된 카드 상태 추가)
function initRoom(roomName) {
    return {
        name: roomName,
        players: [], 
        deck: [], 
        rows: [[], [], [], []], // 4개의 바닥 카드 행
        submittedCards: [], // 이번 라운드에 플레이어들이 엎어놓은 카드
        phase: 'PLAYING', // PLAYING(카드 선택 중), RESOLVING(카드 처리 중), WAITING_ROW(행 선택 대기)
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

// 게임 상태 브로드캐스트
function broadcastGameState(roomId) {
    const room = rooms[roomId];
    if(!room || !room.isGameRunning || room.players.length === 0) return;
    
    room.players.forEach(player => {
        if (!player.isBot) {
            io.to(player.id).emit('updateGame', {
                rows: room.rows,
                phase: room.phase,
                myHand: player.hand,
                myPenalty: player.penalty,
                // 누가 카드를 냈는지 상태만 전달 (카드의 숫자는 숨김)
                submittedStatus: room.players.map(p => ({
                    id: p.id, 
                    hasSubmitted: room.submittedCards.some(sc => sc.playerId === p.id)
                })),
                playersInfo: room.players.map(p => ({ 
                    id: p.id, name: p.name, avatar: p.avatar, cardCount: p.hand.length, penalty: p.penalty, isHost: p.isHost 
                }))
            });
        }
    });
}

// 봇이 무작위 카드를 내는 로직
function triggerBots(roomId) {
    const room = rooms[roomId];
    if (!room || !room.isGameRunning || room.phase !== 'PLAYING') return;

    room.players.forEach(p => {
        if (p.isBot && p.hand.length > 0) {
            // 이미 카드를 냈는지 확인
            const hasSubmitted = room.submittedCards.some(sc => sc.playerId === p.id);
            if (!hasSubmitted) {
                setTimeout(() => {
                    if (room.phase !== 'PLAYING') return;
                    const randomIdx = Math.floor(Math.random() * p.hand.length);
                    const playedCard = p.hand.splice(randomIdx, 1)[0];
                    
                    room.submittedCards.push({ playerId: p.id, card: playedCard });
                    checkAllCardsSubmitted(roomId);
                }, 1000 + Math.random() * 2000); // 1~3초 사이 무작위 지연
            }
        }
    });
}

// 모든 플레이어가 카드를 냈는지 확인하고 처리 단계로 넘어가는 함수
function checkAllCardsSubmitted(roomId) {
    const room = rooms[roomId];
    broadcastGameState(roomId); // 누가 냈는지 UI 업데이트

    if (room.submittedCards.length === room.players.length) {
        room.phase = 'RESOLVING';
        // 숫자 오름차순(작은 숫자부터)으로 정렬
        room.submittedCards.sort((a, b) => a.card.number - b.card.number);
        
        io.to(roomId).emit('systemMessage', `모든 카드가 공개되었습니다! 숫자 순서대로 배치합니다.`);
        setTimeout(() => processNextCard(roomId), 1500); // 1.5초 후 처리 시작
    }
}

// 4. 핵심 알고리즘: 제출된 카드를 하나씩 배치하는 로직
function processNextCard(roomId) {
    const room = rooms[roomId];
    if (!room || !room.isGameRunning) return;

    if (room.submittedCards.length === 0) {
        // 모든 카드가 처리됨
        const isRoundOver = room.players.every(p => p.hand.length === 0);
        if (isRoundOver) {
            endRound(roomId);
        } else {
            room.phase = 'PLAYING';
            broadcastGameState(roomId);
            triggerBots(roomId); // 다음 턴 봇 시작
        }
        return;
    }

    const currentPlay = room.submittedCards.shift();
    const player = room.players.find(p => p.id === currentPlay.playerId);
    const card = currentPlay.card;

    let targetRowIndex = -1;
    let minDiff = Infinity;

    // 카드가 들어갈 행 찾기
    for (let i = 0; i < 4; i++) {
        const row = room.rows[i];
        const lastCard = row[row.length - 1];
        if (card.number > lastCard.number) {
            const diff = card.number - lastCard.number;
            if (diff < minDiff) {
                minDiff = diff;
                targetRowIndex = i;
            }
        }
    }

    // 어떤 행의 마지막 카드보다도 작은 숫자를 냈을 경우
    if (targetRowIndex === -1) {
        if (player.isBot) {
            // 봇: 가장 벌점이 적은 행을 자동으로 선택
            let minBullheads = Infinity;
            let bestRow = 0;
            for(let i=0; i<4; i++) {
                let bh = room.rows[i].reduce((sum, c) => sum + c.bullheads, 0);
                if(bh < minBullheads) { minBullheads = bh; bestRow = i; }
            }
            executeRowSelection(roomId, player, bestRow, card);
        } else {
            // 실제 플레이어: 행을 고르도록 이벤트 전송
            room.phase = 'WAITING_ROW';
            room.pendingPlayerId = player.id;
            room.pendingCard = card;
            
            io.to(roomId).emit('systemMessage', `${player.name}님이 카드가 너무 작아 교체할 행을 선택 중입니다...`);
            io.to(player.id).emit('requireRowSelection', { card: card, rows: room.rows });
            broadcastGameState(roomId);
        }
        return; // 사용자가 행을 고를 때까지 일시 정지
    }

    // 카드를 행에 추가
    room.rows[targetRowIndex].push(card);
    
    // 6번째 카드가 된 경우
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
    setTimeout(() => processNextCard(roomId), 1500); // 1.5초 후 다음 카드 처리
}

// 플레이어가 교체할 행을 선택했을 때 실행
function executeRowSelection(roomId, player, rowIndex, card) {
    const room = rooms[roomId];
    
    const penaltyCards = room.rows[rowIndex];
    const penaltyScore = penaltyCards.reduce((sum, c) => sum + c.bullheads, 0);
    player.penalty += penaltyScore;
    
    io.to(roomId).emit('systemMessage', `🔄 ${player.name}님이 행을 교체하고 벌점 ${penaltyScore}점을 가져갔습니다.`);
    io.to(roomId).emit('actionSound', 'penalty');

    room.rows[rowIndex] = [card]; // 새 카드로 행 덮어쓰기
    room.phase = 'RESOLVING';
    room.pendingPlayerId = null;
    room.pendingCard = null;

    broadcastGameState(roomId);
    setTimeout(() => processNextCard(roomId), 1500);
}

function endRound(roomId) {
    const room = rooms[roomId];
    room.isGameRunning = false;
    
    // 벌점 적은 순으로 정렬하여 승자 발표
    room.players.sort((a, b) => a.penalty - b.penalty);
    io.to(roomId).emit('gameOver', room.players); // 결과 배열 전송
    io.to(roomId).emit('systemMessage', `라운드 종료! 1등: ${room.players[0].name} (벌점 ${room.players[0].penalty}점)`);
    broadcastRoomList();
}

io.on('connection', (socket) => {
    socket.join('lobby');
    broadcastRoomList();

    // ... (createRoom, joinRoom, addBots, toggleReady 로직은 우노와 거의 동일) ...
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
        if (room.isGameRunning) return socket.emit('joinError', '현재 게임이 진행 중인 방입니다.');
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
        
        const currentBots = room.players.filter(p => p.isBot).length;
        const botsToAdd = Math.min(count, 10 - room.players.length); // 젝스님트는 10명까지 가능!
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

    // 게임 시작 로직 수정 (10장씩 분배 및 행 4개 초기화)
    socket.on('startGame', () => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.isHost || room.players.length < 2 || !room.players.every(p => p.isReady)) return; 

        room.deck = shuffle(createDeck());
        room.players.forEach(p => { 
            p.hand = room.deck.splice(0, 10); 
            p.hand.sort((a, b) => a.number - b.number); // 손패를 오름차순 정렬
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

        triggerBots(roomId); // 봇 턴 시작
    });

    // 클라이언트가 카드를 엎어놓음
    socket.on('submitCard', (cardIndex) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        if (room.phase !== 'PLAYING' || !room.isGameRunning) return;
        
        const player = room.players.find(p => p.id === socket.id);
        const alreadySubmitted = room.submittedCards.some(sc => sc.playerId === player.id);
        if (alreadySubmitted) return; // 이미 냈으면 무시

        const playedCard = player.hand.splice(cardIndex, 1)[0];
        room.submittedCards.push({ playerId: player.id, card: playedCard });
        
        checkAllCardsSubmitted(roomId);
    });

    // 클라이언트가 벌점을 먹을 행을 선택함 (제일 작은 숫자를 냈을 때)
    socket.on('selectRow', (rowIndex) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        if (room.phase !== 'WAITING_ROW' || room.pendingPlayerId !== socket.id) return;
        
        const player = room.players.find(p => p.id === socket.id);
        executeRowSelection(roomId, player, rowIndex, room.pendingCard);
    });

    socket.on('disconnect', () => { /* 기존 이탈 로직 유지 */ });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`젝스님트 서버 실행 중. 포트: ${PORT}`));