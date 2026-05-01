<script>
        const socket = io(); 
        let amIHost = false;
        let isReady = false;
        let selectedAvatar = '😎';
        let myNickname = '';
        let currentPhase = 'WAITING';
        let previousPhase = 'WAITING'; 
        let hasSubmittedThisTurn = false;
        let isFirstTurn = true; 
        let localMyPenalty = 0; 
        
        let currentBotCountInput = 1;

        // 💡 1. 통합된 아이폰 오디오 강제 잠금 해제 로직
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        let audioCtx;
        let isAudioUnlocked = false;

        function forceUnlockAudio() {
            if (isAudioUnlocked) return;

            // ① Web Audio API 잠금 해제 (진동수가 0인 무음 파동을 순간적으로 쏨)
            if (!audioCtx) audioCtx = new AudioContext();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            gain.gain.value = 0; // 완전 무음
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.start(0); osc.stop(audioCtx.currentTime + 0.1);

            // ② 아이폰 TTS 잠금 해제 (실제 단어를 무음으로 읽게 만듦)
            if (window.speechSynthesis) {
                const unlockMsg = new SpeechSynthesisUtterance("unlock");
                unlockMsg.volume = 0; 
                window.speechSynthesis.speak(unlockMsg);
            }

            isAudioUnlocked = true;
        }

        // 재생 전 엔진이 자고 있으면 깨우는 함수
        function wakeUpAudio() {
            if (audioCtx && audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
        }

        // 음성 및 효과음 함수들
        function playStartVoice() {
            if(!window.speechSynthesis) return;
            const msg = new SpeechSynthesisUtterance("Start");
            msg.lang = 'en-US'; msg.rate = 1.1; msg.pitch = 1.0;
            window.speechSynthesis.speak(msg);
        }

        function playNextVoice() {
            if(!window.speechSynthesis) return;
            const msg = new SpeechSynthesisUtterance("Next");
            msg.lang = 'en-US'; msg.rate = 1.1; msg.pitch = 0.9;
            window.speechSynthesis.speak(msg);
        }

        function playCardSlapSound() {
            if (!audioCtx) return;
            wakeUpAudio(); // 💡 실행 전 엔진 깨우기
            const now = audioCtx.currentTime;
            
            const bufferSize = audioCtx.sampleRate * 0.05; 
            const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
            
            const noise = audioCtx.createBufferSource();
            noise.buffer = buffer;
            const noiseFilter = audioCtx.createBiquadFilter();
            noiseFilter.type = 'lowpass'; noiseFilter.frequency.value = 800; 
            const noiseGain = audioCtx.createGain();
            noiseGain.gain.setValueAtTime(0.4, now); noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
            noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(audioCtx.destination);
            noise.start(now);

            const osc = audioCtx.createOscillator();
            const oscGain = audioCtx.createGain();
            osc.type = 'sine'; osc.frequency.setValueAtTime(150, now); osc.frequency.exponentialRampToValueAtTime(40, now + 0.15); 
            oscGain.gain.setValueAtTime(0.8, now); oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
            osc.connect(oscGain); oscGain.connect(audioCtx.destination);
            osc.start(now); osc.stop(now + 0.15);

            const board = document.getElementById('board-rows');
            board.classList.remove('board-shake'); void board.offsetWidth; board.classList.add('board-shake');
        }

        function playPenaltySound() {
            if (!audioCtx) return;
            wakeUpAudio(); // 💡 실행 전 엔진 깨우기
            const now = audioCtx.currentTime;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sawtooth'; osc.frequency.setValueAtTime(100, now); osc.frequency.linearRampToValueAtTime(20, now + 0.5); 
            gain.gain.setValueAtTime(1, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.start(now); osc.stop(now + 0.5);
            
            const playArea = document.getElementById('play-area');
            playArea.classList.remove('board-shake'); void playArea.offsetWidth; playArea.classList.add('board-shake');
        }

        function triggerPenaltyFlash(penaltyAmount) {
            const overlay = document.getElementById('penalty-flash-overlay');
            const textEl = document.getElementById('penalty-popup-text');
            textEl.textContent = `+ ${penaltyAmount} 🐂`;
            overlay.classList.remove('flash-active'); textEl.classList.remove('text-pop');
            void overlay.offsetWidth; 
            overlay.classList.add('flash-active'); textEl.classList.add('text-pop');
        }

        socket.on('actionSound', (type) => {
            wakeUpAudio();
            if (type === 'play') playCardSlapSound();
            else if (type === 'penalty') playPenaltySound();
        });

        // 💡 2. 버튼 클릭 함수에 락 해제 로직 연결
        function changeBotCount(delta) {
            forceUnlockAudio(); 
            currentBotCountInput += delta;
            if (currentBotCountInput < 1) currentBotCountInput = 1;
            if (currentBotCountInput > 9) currentBotCountInput = 9;
            document.getElementById('bot-count-display').textContent = currentBotCountInput;
        }

        function enterMainLobby() {
            forceUnlockAudio(); // 💡 여기서 아이폰 잠금이 뚫립니다!
            myNickname = document.getElementById('nickname-input').value.trim();
            if (!myNickname) return alert('닉네임을 입력해주세요.');
            document.getElementById('login-area').style.display = 'none';
            document.getElementById('main-lobby-area').style.display = 'block';
        }