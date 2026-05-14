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

// 💡 1. 봇 성격 및 닉네임 대폭 강화 (Gemma 2가 연기하기 쉽도록 구체적인 묘사 추가)
const botPersonalities = [
    { label: '🔥극대노 김부장', desc: '항상 화가 나 있고 꼰대 말투를 쓴다. "아니 쒸익쒸익", "라떼는 말이야!", "어디 감히" 같은 표현을 쓰며 카드를 잘못 낸 것에 극대노한다.' },
    { label: '💦소심한 춘식이', desc: '자기 비하가 심하고 맨날 울상이다. "앗... 또 저인가요 ㅠㅠ", "제발 살려주세요...", "제가 죄송합니다" 처럼 불쌍하고 처량하게 말한다.' },
    { label: '😜깐족대마왕', desc: '남들이 벌점 먹으면 엄청 놀리고, 자기가 먹어도 정신승리하는 얄미운 초딩 말투. "킹받쥬? ㅋㅋ", "어쩔티비~", "오히려 좋아~" 등을 쓴다.' },
    { label: '🗡️타락한 흑염룡', desc: '중2병에 걸려있다. 벌점을 먹는 걸 "크큭... 내 안의 어둠이 깨어나는군", "이것이 운명의 데스티니인가..." 처럼 애니메이션 대사처럼 오글거리게 말한다.' },
    { label: '🤖고장난 알파고', desc: '기계음과 시스템 오류 메시지를 섞어 말한다. "삐리릿- 인간에게 복수하겠다.", "System.FatalException: 벌점 한도 초과." 처럼 딱딱하게 말한다.' },
    { label: '👴동네 이장님', desc: '느릿느릿하고 구수한 충청도/전라도 사투리를 쓴다. "에잉 쯧쯧... 요놈의 손가락이 미끄러졌구만기래", "아이고 허리야~" 처럼 말한다.' }
];

// 💡 2. AI 대사 생성 프롬프트(명령어) 구체화
async function getBotDialogue(botName, personaDesc, situation) {
    try {
        const promptMessage = `당신은 보드게임 '젝스님트'를 플레이 중인 '${botName}'입니다.
당신의 성격과 말투 설정: "${personaDesc}"

현재 게임 상황: ${situation}

지시사항:
1. 설정된 성격과 말투에 200% 빙의하여 대답하세요.
2. 절대로 자신이 AI나 봇이라는 사실을 언급하지 마세요. 실제 사람(또는 해당 캐릭터)처럼 연기하세요.
3. 무미건조한 대답은 금지! 아주 익살스럽고, 과장되고, 극적인 감정을 듬뿍 담아주세요.
4. 대사는 딱 한 문장으로, 30자를 넘지 않게 아주 짧고 굵게 작성하세요.
5. 적절한 이모티콘을 1~2개 섞어주세요.`;

        // 🚨 아래 주소를 용진 님의 Ngrok 주소로 변경하세요! (끝에 /v1/chat/completions 유지)
        const response = await fetch('https://reflected-unhook-discern.ngrok-free.dev/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: "gemma-2-9b", 
                messages: [
                    { role: "system", content: "너는 유쾌하고 과장된 롤플레잉 연기자다. 짧고 강렬하게 한 문장으로만 말해라." },
                    { role: "user", content: promptMessage }
                ],
                temperature: 0.95, // 창의성과 엉뚱함을 극대화
                max_tokens: 60 
            })
        });

        const data = await response.json();
        return data.choices[0].message.content.replace(/["']/g, ""); 
    } catch (error) {
        console.log("LM Studio 통신 실패:", error);
        return null;
    }
}

function calculateBullheads(number) {
    if (number === 55) return 7;
    if (number % 11 === 0) return 5;
    if (number % 10 === 0) return 3;
    if (number % 5 === 0) return 2;
    return 1;
}

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
                submittedStatus: room.players.map(p => {
                    const sc = room.submittedCards.find(c => c.playerId === p.id);
                    return {
                        id: p.id, 
                        hasSubmitted: !!sc,
                        card: (sc && room.phase !== 'PLAYING') ? sc.card : null
                    };
                }),
                playersInfo: room.players.map(p => ({ 
                    id: p.id, name: p.name, avatar: p.avatar, cardCount: p.hand.length, penalty: p.penalty, isHost: p.isHost 
                }))
            });
        }
    });
}

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
    if (room.submittedCards.length === room.players.length) {
        room.phase = 'RESOLVING';
        room.submittedCards.sort((a, b) => a.card.number - b.card.number);
        broadcastGameState(roomId); 
        io.to(roomId).emit('systemMessage', `모든 카드가 공개되었습니다! (잠시 후 순서대로 배치됩니다)`);
        setTimeout(() => processNextCard(roomId), 3500); 
    } else {
        broadcastGameState(roomId);
    }
}

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

    for (let i = 0; i < 4; i++) {
        const row = room.rows[i];
        const lastCard = row[row.length - 1];
        if (card.number > lastCard.number) {
            const diff = card.number - lastCard.number;
            if (diff < minDiff) { minDiff = diff; targetRowIndex = i; }
        }
    }

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
    
    if (room.rows[targetRowIndex].length === 6) {
        const penaltyCards = room.rows[targetRowIndex].splice(0, 5);
        const penaltyScore = penaltyCards.reduce((sum, c) => sum + c.bullheads, 0);
        player.penalty += penaltyScore;
        io.to(roomId).emit('systemMessage', `💥 ${player.name}님이 6번째 카드를 놓아 벌점 ${penaltyScore}점을 받았습니다!`);
        io.to(roomId).emit('actionSound', 'penalty');

        if (player.isBot) {
            getBotDialogue(player.name, player.personaDesc, `자신이 낸 카드가 6번째 카드가 되어서 벌점 ${penaltyScore}점을 왕창 먹은 상황`).then(dialogue => {
                if(dialogue) io.to(roomId).emit('systemMessage', `💬 ${player.name}: "${dialogue}"`);
            });
        }
    } else {
        io.to(roomId).emit('actionSound', 'play');
    }

    broadcastGameState(roomId);
    setTimeout(() => processNextCard(roomId), 1200); 
}

function executeRowSelection(roomId, player, rowIndex, card) {
    const room = rooms[roomId];
    const penaltyCards = room.rows[rowIndex];
    const penaltyScore = penaltyCards.reduce((sum, c) => sum + c.bullheads, 0);
    player.penalty += penaltyScore;
    
    io.to(roomId).emit('systemMessage', `🔄 ${player.name}님이 행을 교체하고 벌점 ${penaltyScore}점을 가져갔습니다.`);
    io.to(roomId).emit('actionSound', 'penalty');

    if (player.isBot) {
        getBotDialogue(player.name, player.personaDesc, `자신이 낸 카드의 숫자가 너무 작아서, 어쩔 수 없이 벌점 ${penaltyScore}점이 있는 행을 먹어야만 하는 억울한 상황`).then(dialogue => {
            if(dialogue) io.to(roomId).emit('systemMessage', `💬 ${player.name}: "${dialogue}"`);
        });
    }

    room.rows[rowIndex] = [card]; 
    room.phase = 'RESOLVING';
    room.pendingPlayerId = null;
    room.pendingCard = null;

    broadcastGameState(roomId);
    setTimeout(() => processNextCard(roomId), 1200);
}

function endRound(roomId) {
    const room = rooms[roomId];
    room.isGameRunning = false;
    room.players.sort((a, b) => a.penalty - b.penalty);
    io.to(roomId).emit('gameOver', room.players); 
    io.to(roomId).emit('systemMessage', `라운드 종료! 누적 1등: ${room.players[0].name} (벌점 ${room.players[0].penalty}점)`);
    broadcastRoomList();
}

function resetRoom(roomId) {
    const room = rooms[roomId];
    if(!room) return;
    room.isGameRunning = false;
    room.phase = 'WAITING';
    room.submittedCards = [];
    room.rows = [[], [], [], []];
    room.players.forEach(p => { p.hand = []; p.isReady = p.isHost || p.isBot; });
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
            const persona = botPersonalities[Math.floor(Math.random() * botPersonalities.length)];
            room.players.push({ 
                id: `bot_${roomId}_${Math.random()}`, 
                name: `${persona.label} (봇 ${room.botCounter++})`, // 💡 봇 이름에 캐릭터 닉네임 직관적으로 적용
                avatar: botAvatars[Math.floor(Math.random() * botAvatars.length)],
                hand: [], penalty: 0, isBot: true, isHost: false, isReady: true,
                personaDesc: persona.desc 
            });
        }
        io.to(roomId).emit('updatePlayers', room.players);
    });

    socket.on('kickPlayer', (targetId) => {
        const roomId = socket.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        const requester = room.players.find(p => p.id === socket.id);
        if (requester && requester.isHost && !room.isGameRunning) {
            const targetIndex = room.players.findIndex(p => p.id === targetId);
            if (targetIndex !== -1) {
                const targetPlayer = room.players[targetIndex];
                room.players.splice(targetIndex, 1);
                
                if (!targetPlayer.isBot) {
                    io.to(targetPlayer.id).emit('kicked');
                    const targetSocket = io.sockets.sockets.get(targetPlayer.id);
                    if(targetSocket) { targetSocket.leave(roomId); targetSocket.roomId = null; targetSocket.join('lobby'); }
                }
                io.to(roomId).emit('updatePlayers', room.players);
                broadcastRoomList();
            }
        }
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
                    io.to(roomId).emit('systemMessage', `플레이어 이탈로 게임이 중단되었습니다.`);
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