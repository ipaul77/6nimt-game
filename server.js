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

const botPersonalities = [
    { label: '🔥극대노 김부장', desc: '항상 화가 나 있고 꼰대 말투를 쓴다. "아니 쒸익쒸익", "라떼는 말이야!", "어디 감히" 같은 표현을 쓰며 카드를 잘못 낸 것에 극대노한다.' },
    { label: '💦소심한 춘식이', desc: '자기 비하가 심하고 맨날 울상이다. "앗... 또 저인가요 ㅠㅠ", "제발 살려주세요...", "제가 죄송합니다" 처럼 불쌍하고 처량하게 말한다.' },
    { label: '😜깐족대마왕', desc: '남들이 벌점 먹으면 엄청 놀리고, 자기가 먹어도 정신승리하는 얄미운 초딩 말투. "킹받쥬? ㅋㅋ", "어쩔티비~", "오히려 좋아~" 등을 쓴다.' },
    { label: '🗡️타락한 흑염룡', desc: '중2병에 걸려있다. 벌점을 먹는 걸 "크큭... 내 안의 어둠이 깨어나는군", "이것이 운명의 데스티니인가..." 처럼 애니메이션 대사처럼 오글거리게 말한다.' },
    { label: '🤖고장난 알파고', desc: '기계음과 시스템 오류 메시지를 섞어 말한다. "삐리릿- 인간에게 복수하겠다.", "System.FatalException: 벌점 한도 초과." 처럼 딱딱하게 말한다.' },
    { label: '👴동네 이장님', desc: '느릿느릿하고 구수한 충청도/전라도 사투리를 쓴다. "에잉 쯧쯧... 요놈의 손가락이 미끄러졌구만기래", "아이고 허리야~" 처럼 말한다.' }
];

// AI 대사 생성 (나 또는 남이 벌점을 먹었을 때 모두 대응)
async function getBotDialogue(botName, personaDesc, situation) {
    try {
        const promptMessage = `당신은 보드게임 '젝스님트' 플레이어 '${botName}'입니다. 성격: "${personaDesc}"
상황: ${situation}
위 상황에 맞춰 성격이 200% 드러나게 딱 한 문장(25자 이내)으로 짧고 재밌게 말하세요. 이모티콘 1개 포함.`;

        // 🚨 Ngrok 주소를 아래에 꼭 넣어주세요!
        const response = await fetch('https://reflected-unhook-discern.ngrok-free.dev/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: "gemma-2-9b", 
                messages: [
                    { role: "system", content: "너는 유쾌하고 과장된 롤플레잉 연기자다. 짧고 강렬하게 한 문장으로만 말해라. AI라는 티를 내지 마라." },
                    { role: "user", content: promptMessage }
                ],
                temperature: 0.9, max_tokens: 60 
            })
        });
        const data = await response.json();
        return data.choices[0].message.content.replace(/["']/g, ""); 
    } catch (error) { return null; }
}

// 무작위 봇 1명 추출 (도발용)
function getRandomBot(room) {
    const bots = room.players.filter(p => p.isBot);
    return bots.length > 0 ? bots[Math.floor(Math.random() * bots.length)] : null;
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
    for (let i = 1; i <= 104; i++) newDeck.push({ number: i, bullheads: calculateBullheads(i) });
    return newDeck;
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function clearUrgeTimer(roomId) {
    const room = rooms[roomId];
    if (room && room.urgeTimer) {
        clearTimeout(room.urgeTimer);
        room.urgeTimer = null;
    }
}

function startUrgeTimer(roomId) {
    const room = rooms[roomId];
    if (!room || !room.isGameRunning) return;
    clearUrgeTimer(roomId);
    
    room.urgeTimer = setTimeout(() => {
        const cRoom = rooms[roomId];
        if (!cRoom || cRoom.phase !== 'PLAYING') return;
        
        let submittedBots = cRoom.players.filter(p => p.isBot && cRoom.submittedCards.some(sc => sc.playerId === p.id));
        let speaker = submittedBots.length > 0 ? submittedBots[Math.floor(Math.random() * submittedBots.length)] : getRandomBot(cRoom);
        
        if (speaker) {
            const notSubmitted = cRoom.players.filter(p => !cRoom.submittedCards.some(sc => sc.playerId === p.id) && !p.isBot);
            const targetName = notSubmitted.length > 0 ? notSubmitted[0].name : '누군가';
            const sit = `카드 제출 단계에서 시간이 꽤 지났는데도 플레이어 '${targetName}'(이)가 카드를 안 내고 한참 고민 중이라 너무 답답해하며 빨리 내라고 독촉하는 상황.`;
            getBotDialogue(speaker.name, speaker.personaDesc, sit).then(d => {
                if(d) io.to(roomId).emit('systemMessage', `💬 ${speaker.name}: "${d}"`);
            });
        }
    }, 7000);
}

function initRoom(roomName, isReverse = false) {
    return { name: roomName, players: [], deck: [], rows: [[], [], [], []], submittedCards: [], phase: 'PLAYING', botCounter: 1, isGameRunning: false, urgeTimer: null, isReverse: isReverse };
}

function broadcastRoomList() {
    const availableRooms = [];
    for (const roomId in rooms) {
        const room = rooms[roomId];
        if (!room.isGameRunning) {
            const host = room.players.find(p => p.isHost);
            availableRooms.push({ id: roomId, name: room.name, playerCount: room.players.length });
        }
    }
    io.to('lobby').emit('roomList', availableRooms);
}

function broadcastGameState(roomId) {
    const room = rooms[roomId];
    if(!room || !room.isGameRunning) return;
    room.players.forEach(player => {
        if (!player.isBot) {
            io.to(player.id).emit('updateGame', {
                rows: room.rows, phase: room.phase, myHand: player.hand, myPenalty: player.penalty,
                submittedStatus: room.players.map(p => {
                    const sc = room.submittedCards.find(c => c.playerId === p.id);
                    return { id: p.id, hasSubmitted: !!sc, card: (sc && room.phase !== 'PLAYING') ? sc.card : null };
                }),
                playersInfo: room.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, penalty: p.penalty, isHost: p.isHost }))
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
                    const cRoom = rooms[roomId];
                    if (!cRoom || cRoom.phase !== 'PLAYING') return;
                    const already = cRoom.submittedCards.some(sc => sc.playerId === p.id);
                    if (already || p.hand.length === 0) return;
                    const card = p.hand.splice(Math.floor(Math.random() * p.hand.length), 1)[0];
                    cRoom.submittedCards.push({ playerId: p.id, card: card });
                    checkAllCardsSubmitted(roomId);
                }, 1000 + Math.random() * 2000);
            }
        }
    });
}

function checkAllCardsSubmitted(roomId) {
    const room = rooms[roomId];
    if (room.submittedCards.length === room.players.length) {
        clearUrgeTimer(roomId);
        room.phase = 'RESOLVING';
        room.submittedCards.sort((a, b) => a.card.number - b.card.number);
        broadcastGameState(roomId);
        clearTimeout(room.processTimer);
        room.processTimer = setTimeout(() => processNextCard(roomId), 3500);
    } else broadcastGameState(roomId);
}

function processNextCard(roomId) {
    const room = rooms[roomId];
    if (!room || !room.isGameRunning) return;
    if (room.submittedCards.length === 0) {
        if (room.players.every(p => p.hand.length === 0)) endRound(roomId);
        else { room.phase = 'PLAYING'; broadcastGameState(roomId); triggerBots(roomId); startUrgeTimer(roomId); }
        return;
    }
    const currentPlay = room.submittedCards.shift();
    const player = room.players.find(p => p.id === currentPlay.playerId);
    const card = currentPlay.card;
    let targetIdx = -1; let minDiff = Infinity;
    for (let i = 0; i < 4; i++) {
        const last = room.rows[i][room.rows[i].length - 1];
        if (card.number > last.number && (card.number - last.number) < minDiff) { minDiff = card.number - last.number; targetIdx = i; }
    }
    if (targetIdx === -1) {
        if (player.isBot) {
            let minB = Infinity; let best = 0;
            for(let i=0; i<4; i++) { let b = room.rows[i].reduce((s,c)=>s+c.bullheads,0); if(b<minB){minB=b; best=i;}}
            executeRowSelection(roomId, player, best, card);
        } else {
            room.phase = 'WAITING_ROW'; room.pendingPlayerId = player.id; room.pendingCard = card;
            io.to(player.id).emit('requireRowSelection', { card: card, rows: room.rows });
            broadcastGameState(roomId);
        }
        return;
    }
    room.rows[targetIdx].push(card);
    if (room.rows[targetIdx].length === 5) {
        const speaker = getRandomBot(room);
        if(speaker && speaker.id !== player.id) {
            const sit = room.isReverse 
                ? `방금 플레이어 '${player.name}'가 특정 행에 5번째 카드를 놓아서, 다음 카드가 놓이면 소머리(점수)를 대량으로 획득할 수 있는 대박 찬스가 온 상황이라 서로 먹으려고 기대하는 상황.`
                : `방금 플레이어 '${player.name}'가 특정 행에 5번째 카드를 놓아서, 다음 카드가 놓이면 무조건 벌점 6장을 먹게 될 확률이 엄청 높아진 긴장되는 위기 상황.`;
            getBotDialogue(speaker.name, speaker.personaDesc, sit).then(d => {
                if(d) io.to(roomId).emit('systemMessage', `💬 ${speaker.name}: "${d}"`);
            });
        }
    }
    if (room.rows[targetIdx].length === 6) {
        const score = room.rows[targetIdx].splice(0, 5).reduce((s,c)=>s+c.bullheads,0);
        player.penalty += score;
        io.to(roomId).emit('actionSound', 'penalty');
        // 도발 AI 트리거
        const speaker = getRandomBot(room);
        if(speaker) {
            let sit = "";
            if (room.isReverse) {
                sit = player.isBot ? `자기 팀 봇이 소머리(점수)를 대량 획득해서 매우 기뻐하고 환호하는 상황` : `플레이어 '${player.name}'가 소머리(점수) ${score}점을 독식해서 배아파하고 질투하는 상황`;
            } else {
                sit = player.isBot ? "자기 팀 봇이 벌점을 먹어 안타까워하는 상황" : `플레이어 '${player.name}'가 벌점 ${score}점을 먹어 매우 고소해하는 상황`;
            }
            getBotDialogue(speaker.name, speaker.personaDesc, sit).then(d => {
                if(d) io.to(roomId).emit('systemMessage', `💬 ${speaker.name}: "${d}"`);
            });
        }
    } else io.to(roomId).emit('actionSound', 'play');
    broadcastGameState(roomId);
    clearTimeout(room.processTimer);
    room.processTimer = setTimeout(() => processNextCard(roomId), 1200);
}

function executeRowSelection(roomId, player, rowIndex, card) {
    const room = rooms[roomId];
    const score = room.rows[rowIndex].reduce((s,c)=>s+c.bullheads,0);
    player.penalty += score;
    io.to(roomId).emit('actionSound', 'penalty');
    
    const speaker = getRandomBot(room);
    if(speaker) {
        let sit = "";
        if (room.isReverse) {
            sit = `플레이어 '${player.name}'가 낼 카드가 없어서 강제로 자신이 원하는 점수 높은 행을 가져가 ${score}점을 획득하는 상황이라 얄밉고 부러워하는 상황`;
        } else {
            sit = `플레이어 '${player.name}'가 낼 카드가 없어서 벌점 ${score}점 행을 억지로 가져가는 굴욕적인 상황`;
        }
        getBotDialogue(speaker.name, speaker.personaDesc, sit).then(d => {
            if(d) io.to(roomId).emit('systemMessage', `💬 ${speaker.name}: "${d}"`);
        });
    }

    room.rows[rowIndex] = [card]; room.phase = 'RESOLVING';
    broadcastGameState(roomId);
    clearTimeout(room.processTimer);
    room.processTimer = setTimeout(() => processNextCard(roomId), 1200);
}

function endRound(roomId) {
    const room = rooms[roomId]; room.isGameRunning = false;
    clearUrgeTimer(roomId);
    if (room.isReverse) {
        room.players.sort((a,b)=>b.penalty - a.penalty);
    } else {
        room.players.sort((a,b)=>a.penalty - b.penalty);
    }
    io.to(roomId).emit('gameOver', room.players);
    broadcastRoomList();
    
    const speaker = getRandomBot(room);
    if (speaker) {
        const myRank = room.players.findIndex(p => p.id === speaker.id) + 1;
        const myPenalty = speaker.penalty;
        const sit = room.isReverse 
            ? `라운드가 종료되었고 내 최종 등수는 ${myRank}등, 획득한 소머리 점수는 ${myPenalty}점인 상황. 1등이면 소머리를 많이 먹었다며 엄청 잘난척하고, 꼴등이면 점수를 못 먹어서 억울해하기.`
            : `라운드가 종료되었고 내 최종 등수는 ${myRank}등, 벌점은 ${myPenalty}점인 상황. 1등이면 엄청 잘난척하고, 꼴등이면 분노하거나 우울해하기.`;
        getBotDialogue(speaker.name, speaker.personaDesc, sit).then(d => {
            if(d) setTimeout(() => io.to(roomId).emit('systemMessage', `💬 ${speaker.name}: "${d}"`), 1500);
        });
    }
}

function resetRoom(roomId) {
    const room = rooms[roomId]; if(!room) return;
    clearUrgeTimer(roomId);
    clearTimeout(room.processTimer);
    room.isGameRunning = false; room.phase = 'WAITING'; room.submittedCards = []; room.rows = [[],[],[],[]];
    room.players.forEach(p => { p.hand = []; p.isReady = p.isHost || p.isBot; });
    io.to(roomId).emit('gameStopped'); io.to(roomId).emit('updatePlayers', room.players);
    broadcastRoomList();
}

io.on('connection', (socket) => {
    socket.join('lobby'); broadcastRoomList();
    socket.on('createRoom', (data) => {
        const rid = 'room_' + Math.random().toString(36).substr(2, 6);
        rooms[rid] = initRoom(data.roomName || `${data.nickname}의 방`, data.isReverse);
        socket.leave('lobby'); socket.join(rid); socket.roomId = rid;
        rooms[rid].players.push({ id: socket.id, name: data.nickname, avatar: data.avatar, hand: [], penalty: 0, isBot: false, isHost: true, isReady: true });
        socket.emit('joinSuccess', { isHost: true, roomName: rooms[rid].name });
        io.to(rid).emit('updatePlayers', rooms[rid].players); broadcastRoomList();
    });
    socket.on('joinRoom', (data) => {
        const room = rooms[data.roomId];
        if(!room || room.isGameRunning) return socket.emit('joinError', '입장 불가');
        if(room.players.length >= 10) return socket.emit('joinError', '최대 10명까지 입장 가능합니다.');
        socket.leave('lobby'); socket.join(data.roomId); socket.roomId = data.roomId;
        room.players.push({ id: socket.id, name: data.nickname, avatar: data.avatar, hand: [], penalty: 0, isBot: false, isHost: false, isReady: false });
        socket.emit('joinSuccess', { isHost: false, roomName: room.name });
        io.to(data.roomId).emit('updatePlayers', room.players); broadcastRoomList();
    });
    socket.on('addBots', (count) => {
        const room = rooms[socket.roomId]; if(!room) return;
        for(let i=0; i<Math.min(count, 10-room.players.length); i++){
            const p = botPersonalities[Math.floor(Math.random()*botPersonalities.length)];
            room.players.push({ id: 'bot_'+Math.random(), name: `${p.label}(봇${room.botCounter++})`, avatar: botAvatars[Math.floor(Math.random()*botAvatars.length)], hand: [], penalty: 0, isBot: true, isHost: false, isReady: true, personaDesc: p.desc });
        }
        io.to(socket.roomId).emit('updatePlayers', room.players);
    });
    socket.on('kickPlayer', (tid) => {
        const room = rooms[socket.roomId]; if(room && !room.isGameRunning){
            const idx = room.players.findIndex(p=>p.id===tid);
            if(idx!==-1){ 
                if(!room.players[idx].isBot) io.to(tid).emit('kicked');
                room.players.splice(idx,1); io.to(socket.roomId).emit('updatePlayers', room.players);
            }
        }
    });
    socket.on('toggleReady', () => {
        const room = rooms[socket.roomId];
        if (room && !room.isGameRunning) {
            const player = room.players.find(p => p.id === socket.id);
            if (player && !player.isHost) {
                player.isReady = !player.isReady;
                io.to(socket.roomId).emit('updatePlayers', room.players);
            }
        }
    });
    socket.on('startGame', () => {
        const room = rooms[socket.roomId]; if(!room || room.players.length < 2) return;
        room.deck = shuffle(createDeck());
        room.players.forEach(p => { p.hand = room.deck.splice(0,10).sort((a,b)=>a.number-b.number); });
        room.rows = [[room.deck.pop()],[room.deck.pop()],[room.deck.pop()],[room.deck.pop()]];
        room.isGameRunning = true; room.phase = 'PLAYING';
        io.to(socket.roomId).emit('gameStarted'); broadcastGameState(socket.roomId); triggerBots(socket.roomId);
        
        const speaker = getRandomBot(room);
        if (speaker) {
            const sit = `게임이 막 시작되어 다들 처음 카드를 받은 상황. 첫 턴 시작을 알리는 멋지거나 재밌는 멘트.`;
            getBotDialogue(speaker.name, speaker.personaDesc, sit).then(d => {
                if(d) io.to(socket.roomId).emit('systemMessage', `💬 ${speaker.name}: "${d}"`);
            });
        }
        startUrgeTimer(socket.roomId);
    });
    socket.on('submitCard', (idx) => {
        const room = rooms[socket.roomId]; if(room && room.phase === 'PLAYING'){
            const p = room.players.find(p=>p.id===socket.id);
            if(p && !room.submittedCards.some(sc=>sc.playerId===p.id)){
                if (idx < 0 || idx >= p.hand.length) return;
                room.submittedCards.push({ playerId: p.id, card: p.hand.splice(idx,1)[0] });
                checkAllCardsSubmitted(socket.roomId);
            }
        }
    });
    socket.on('selectRow', (ridx) => {
        const room = rooms[socket.roomId];
        if(room && room.phase==='WAITING_ROW' && room.pendingPlayerId===socket.id) {
            if (ridx < 0 || ridx >= 4) return;
            executeRowSelection(socket.roomId, room.players.find(p=>p.id===socket.id), ridx, room.pendingCard);
        }
    });
    socket.on('stopGame', () => { if(rooms[socket.roomId]) resetRoom(socket.roomId); });
    socket.on('returnToLobby', () => { if(rooms[socket.roomId]) resetRoom(socket.roomId); });
    socket.on('disconnect', () => {
        const rid = socket.roomId; if(!rid || !rooms[rid]) return;
        const idx = rooms[rid].players.findIndex(p=>p.id===socket.id);
        if(idx!==-1){
            const wasHost = rooms[rid].players[idx].isHost; rooms[rid].players.splice(idx,1);
            const real = rooms[rid].players.filter(p=>!p.isBot);
            if(real.length===0) delete rooms[rid];
            else { 
                if(wasHost) { real[0].isHost=true; real[0].isReady=true; }
                if(rooms[rid].isGameRunning) resetRoom(rid); else io.to(rid).emit('updatePlayers', rooms[rid].players);
            }
            broadcastRoomList();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));