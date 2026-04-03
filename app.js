import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const sentencesRef = collection(db, "sentences");
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

let currentUser = null; 
let localSentences = JSON.parse(localStorage.getItem('myLocalSentences')) || [];
let firebaseSentences = []; 

let editingId = null;
let visibleCount = 20;
let currentFilter = 'all';
let searchQuery = ''; 
let currentTranscriptionText = ''; 

const form = document.getElementById('sentenceForm');
const contentInput = document.getElementById('contentInput');
const sourceInput = document.getElementById('sourceInput');
const submitBtn = document.getElementById('submitBtn');
const sentenceList = document.getElementById('sentenceList');
const loadMoreBtn = document.getElementById('loadMoreBtn');
const authSection = document.getElementById('authSection');
const searchInput = document.getElementById('searchInput');
const tabLikedBtn = document.getElementById('tab-liked'); 

document.addEventListener('click', function(e) {
    const menuBtn = e.target.closest('.menu-btn');
    if (!menuBtn) {
        document.querySelectorAll('.dropdown-content.show').forEach(el => el.classList.remove('show'));
        return;
    }
    const dropdown = menuBtn.nextElementSibling;
    const isShowing = dropdown.classList.contains('show');
    document.querySelectorAll('.dropdown-content.show').forEach(el => el.classList.remove('show'));
    if (!isShowing) dropdown.classList.add('show');
});

searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    visibleCount = 20;
    renderSentences();
});

const savedTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);

window.toggleTheme = function() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
};

function getCombinedSentences() {
    const combined = [...firebaseSentences, ...localSentences];
    return combined.sort((a, b) => b.createdAt - a.createdAt);
}

function formatDate(timestamp) {
    return new Date(timestamp).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        const displayName = user.displayName || user.email.split('@')[0];
        authSection.innerHTML = `
            <div class="user-info">
                <span>${displayName}님</span>
                <span class="logout-text" onclick="window.handleLogout()">로그아웃</span>
            </div>
        `;
        tabLikedBtn.style.display = "block"; 
    } else {
        currentUser = null;
        authSection.innerHTML = `
            <div class="auth-init" id="authInit">
                <button class="auth-btn" onclick="window.showAuthOptions()">로그인</button>
            </div>
            <div class="auth-options hidden" id="authOptions">
                <button class="auth-btn" onclick="window.handleGoogleLogin()">Google</button>
                <span style="color: var(--border-color);">|</span>
                <button class="auth-btn" onclick="window.showEmailAuth()">이메일</button>
                <button class="auth-cancel-btn" onclick="window.hideAuthOptions()">취소</button>
            </div>
            <div class="email-auth-form hidden" id="emailAuthForm">
                <div class="auth-input-group">
                    <input type="email" id="emailInput" class="auth-input" placeholder="이메일">
                    <input type="password" id="pwInput" class="auth-input" placeholder="비밀번호(6자~)">
                </div>
                <div class="auth-btn-group">
                    <button class="auth-submit-btn" onclick="window.submitEmailAuth()">확인</button>
                    <button class="auth-cancel-btn" onclick="window.hideEmailAuth()">취소</button>
                </div>
            </div>
        `;
        tabLikedBtn.style.display = "none"; 
        if (currentFilter === 'liked') window.setFilter('all'); 
    }
    renderSentences(); 
});

window.showAuthOptions = () => { document.getElementById('authInit').classList.add('hidden'); document.getElementById('authOptions').classList.remove('hidden'); };
window.hideAuthOptions = () => { document.getElementById('authOptions').classList.add('hidden'); document.getElementById('authInit').classList.remove('hidden'); };
window.showEmailAuth = () => { document.getElementById('authOptions').classList.add('hidden'); document.getElementById('emailAuthForm').classList.remove('hidden'); };
window.hideEmailAuth = () => { document.getElementById('emailAuthForm').classList.add('hidden'); document.getElementById('authOptions').classList.remove('hidden'); };

window.submitEmailAuth = async () => {
    const email = document.getElementById('emailInput').value.trim();
    const pw = document.getElementById('pwInput').value;
    if(!email || pw.length < 6) return alert("이메일과 6자 이상의 비밀번호를 입력해주세요.");
    try { await signInWithEmailAndPassword(auth, email, pw); } 
    catch(err) {
        if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
            if(confirm("가입되지 않은 계정이거나 비밀번호가 다릅니다.\n새로 시작할까요?")) {
                try { await createUserWithEmailAndPassword(auth, email, pw); } 
                catch(e) { alert(e.code === 'auth/email-already-in-use' ? "이미 가입된 이메일입니다." : "오류: " + e.message); }
            }
        } else { alert("오류: " + err.message); }
    }
};

window.handleGoogleLogin = () => {
    if (navigator.userAgent.toLowerCase().match(/kakaotalk|instagram|naver|line|facebook/i)) {
        return alert("인앱 브라우저에서는 로그인이 차단됩니다.\n대신 [이메일] 버튼을 이용해주세요!");
    }
    signInWithPopup(auth, provider).catch(e => { if (e.code === 'auth/popup-blocked') alert("팝업 차단을 해제해 주세요."); });
};

window.handleLogout = () => signOut(auth).catch(e => console.error(e));

window.setFilter = function(filterType) {
    currentFilter = filterType;
    visibleCount = 20; 
    document.querySelectorAll('.filter-tab').forEach(btn => btn.classList.remove('active'));
    document.getElementById('tab-' + filterType).classList.add('active');
    renderSentences(); 
};

function renderSentences() {
    sentenceList.innerHTML = '';
    const allSentences = getCombinedSentences();
    
    let filteredSentences = allSentences;
    
    if (currentFilter === 'mine') {
        filteredSentences = allSentences.filter(s => s.authorId === 'local' || (currentUser && s.authorId === currentUser.uid));
    } else if (currentFilter === 'liked') {
        filteredSentences = allSentences.filter(s => currentUser && s.likedBy && s.likedBy.includes(currentUser.uid));
    }
    
    if (searchQuery) {
        filteredSentences = filteredSentences.filter(s => {
            const contentMatch = s.content && s.content.toLowerCase().includes(searchQuery);
            const sourceMatch = s.source && s.source.toLowerCase().includes(searchQuery);
            return contentMatch || sourceMatch;
        });
    }

    if (filteredSentences.length === 0) {
        let msg = '문장이 없습니다.';
        if (searchQuery) msg = '검색된 문장이 없습니다.';
        else if (currentFilter === 'liked') msg = '아직 좋아요 한 문장이 없습니다.';
        
        sentenceList.innerHTML = `<div class="empty-message">${msg}</div>`;
        loadMoreBtn.classList.add('hidden');
        return;
    }

    const displaySentences = filteredSentences.slice(0, visibleCount);

    displaySentences.forEach(sentence => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'sentence-item';
        itemDiv.id = `item-${sentence.id}`; 
        
        const safeContent = escapeHTML(sentence.content);
        const safeSource = escapeHTML(sentence.source);
        const dateString = formatDate(sentence.createdAt);
        const sourceHtml = safeSource ? `<div class="sentence-source">— ${safeSource}</div>` : '<div class="sentence-source"></div>';
        
        const isLocal = sentence.authorId === 'local';
        const isMine = isLocal || (currentUser && sentence.authorId === currentUser.uid);
        const badgeHtml = (isMine && currentFilter === 'all') ? `<span class="badge-mine ${isLocal ? 'badge-local' : ''}">${isLocal ? '로컬 저장됨' : '내 문장'}</span>` : '';
        
        const likedBy = sentence.likedBy || [];
        const likeCount = likedBy.length;
        const hasLiked = currentUser && likedBy.includes(currentUser.uid);

        const heartSvg = hasLiked 
            ? `<svg fill="currentColor" viewBox="0 0 24 24" width="16" height="16"><path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" /></svg>`
            : `<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="16" height="16"><path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" /></svg>`;

        const myDropdownItems = isMine ? `
            <div class="dropdown-divider"></div>
            <button class="dropdown-item" onclick="window.editSentence('${sentence.id}')">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                수정
            </button>
            <button class="dropdown-item delete" onclick="window.deleteSentence('${sentence.id}')">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                삭제
            </button>
        ` : '';

        const kebabMenuHtml = `
            <div class="card-menu">
                <button class="menu-btn" title="더 보기">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="12" cy="5" r="1.5"></circle><circle cx="12" cy="12" r="1.5"></circle><circle cx="12" cy="19" r="1.5"></circle></svg>
                </button>
                <div class="dropdown-content">
                    <button class="dropdown-item" onclick="window.openTranscription('${sentence.id}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect><path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M6 12h.001M10 12h.001M14 12h.001M18 12h.001M8 16h8"></path></svg>
                        필사 하기
                    </button>
                    <button class="dropdown-item" onclick="window.copySentence('${sentence.id}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        복사
                    </button>
                    <button class="dropdown-item" onclick="window.downloadImage('${sentence.id}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                        이미지 저장
                    </button>
                    ${myDropdownItems}
                </div>
            </div>
        `;

        itemDiv.innerHTML = `
            <div class="sentence-content">"${safeContent}"</div>
            <div class="sentence-bottom">${sourceHtml}</div>
            ${kebabMenuHtml}
            <div class="bottom-right-group">
                <div class="date-wrapper">
                    ${badgeHtml}
                    <div class="sentence-date">${dateString}</div>
                </div>
                <button type="button" class="like-btn ${hasLiked ? 'liked' : ''}" onclick="window.toggleLike('${sentence.id}')">
                    ${heartSvg} ${likeCount > 0 ? `<span>${likeCount}</span>` : ''}
                </button>
            </div>
        `;
        sentenceList.appendChild(itemDiv);
    });

    if (filteredSentences.length > visibleCount) loadMoreBtn.classList.remove('hidden');
    else loadMoreBtn.classList.add('hidden');
}

window.copySentence = function(id) {
    const target = getCombinedSentences().find(s => s.id === id);
    if (target) {
        const text = `"${target.content}"\n- ${target.source || '작자 미상'}`;
        navigator.clipboard.writeText(text).then(() => alert("문장이 복사되었습니다."));
    }
};

window.downloadImage = function(id) {
    const itemDiv = document.getElementById(`item-${id}`);
    itemDiv.classList.add('capture-mode'); 
    
    setTimeout(() => {
        const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg-color').trim();
        html2canvas(itemDiv, { backgroundColor: bgColor, scale: 2 }).then(canvas => {
            const link = document.createElement('a');
            link.download = `문장보관소_${Date.now()}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            itemDiv.classList.remove('capture-mode'); 
        });
    }, 100);
};

onSnapshot(query(sentencesRef, orderBy("createdAt", "desc")), (snapshot) => {
    firebaseSentences = [];
    snapshot.forEach((doc) => { firebaseSentences.push({ id: doc.id, ...doc.data() }); });
    renderSentences();
});

window.loadMore = function() { visibleCount += 20; renderSentences(); };

window.toggleLike = async function(id) {
    if (String(id).startsWith('local_')) return alert("로컬에 저장된 문장은 좋아요를 누를 수 없습니다.");
    if (!currentUser) return alert("좋아요를 누르려면 로그인이 필요합니다.");

    const target = firebaseSentences.find(s => s.id === id);
    if (!target) return;

    const likedBy = target.likedBy || [];
    const docRef = doc(db, "sentences", id);
    try {
        if (likedBy.includes(currentUser.uid)) await updateDoc(docRef, { likedBy: arrayRemove(currentUser.uid) });
        else await updateDoc(docRef, { likedBy: arrayUnion(currentUser.uid) });
    } catch (error) { console.error(error); }
};

form.addEventListener('submit', async function(e) {
    e.preventDefault();
    const content = contentInput.value.trim();
    const source = sourceInput.value.trim();
    if (!content) return;

    submitBtn.disabled = true;
    submitBtn.textContent = '저장 중...';

    try {
        if (editingId) {
            if (String(editingId).startsWith('local_')) {
                const target = localSentences.find(s => s.id === editingId);
                if(target) { target.content = content; target.source = source; }
                localStorage.setItem('myLocalSentences', JSON.stringify(localSentences));
                renderSentences();
            } else {
                await updateDoc(doc(db, "sentences", editingId), { content, source });
            }
            editingId = null;
        } else {
            if (currentUser) {
                await addDoc(sentencesRef, { content, source, createdAt: Date.now(), authorId: currentUser.uid, likedBy: [] });
            } else {
                localSentences.unshift({ id: 'local_' + Date.now(), content, source, createdAt: Date.now(), authorId: 'local', likedBy: [] });
                localStorage.setItem('myLocalSentences', JSON.stringify(localSentences));
                renderSentences();
            }
            visibleCount = 20;
            window.setFilter('all');
            searchInput.value = ''; 
            searchQuery = '';
        }
        contentInput.value = '';
        sourceInput.value = '';
        contentInput.style.height = 'auto';
    } catch (error) {
        alert("저장 중 오류가 발생했습니다.");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '기록하기';
    }
});

contentInput.addEventListener('input', function() { this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px'; });

window.deleteSentence = async function(id) {
    if (!confirm('정말 이 문장을 삭제하시겠습니까?')) return;
    if (String(id).startsWith('local_')) {
        localSentences = localSentences.filter(s => s.id !== id);
        localStorage.setItem('myLocalSentences', JSON.stringify(localSentences));
        renderSentences();
    } else {
        try { await deleteDoc(doc(db, "sentences", id)); } 
        catch (error) { console.error(error); }
    }
};

window.editSentence = function(id) {
    const allSentences = getCombinedSentences();
    const target = allSentences.find(s => s.id === id);
    
    if (target) {
        if (target.authorId !== 'local' && (!currentUser || target.authorId !== currentUser.uid)) {
            return alert("수정 권한이 없습니다.");
        }
        
        contentInput.value = target.content;
        sourceInput.value = target.source;
        editingId = target.id;
        submitBtn.textContent = '수정 완료';
        contentInput.style.height = 'auto';
        contentInput.style.height = contentInput.scrollHeight + 'px';
        contentInput.focus();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};

/* =========================================
   ✍️ 필사(Transcription) 모드 핵심 로직
========================================= */

// ★ [해결 2] 모바일 키보드 호환성을 위한 터치 방어막
document.getElementById('transcriptionModal').addEventListener('click', function(e) {
    // 닫기 버튼을 누른 게 아니라면 무조건 입력창 포커스 (키보드 강제 소환)
    if (!e.target.closest('.transcription-close')) {
        document.getElementById('transcriptionInput').focus();
    }
});

window.openTranscription = function(id) {
    const allSentences = getCombinedSentences();
    const target = allSentences.find(s => s.id === id);
    if (!target) return;

    currentTranscriptionText = target.content; 
    const modal = document.getElementById('transcriptionModal');
    const tInput = document.getElementById('transcriptionInput');
    const tProg = document.getElementById('transcriptionProgress');

    tInput.value = ''; 
    tProg.innerText = '0%';
    tProg.style.color = 'var(--muted-color)';
    document.getElementById('transcriptionText').classList.remove('finished');
    updateTranscriptionVisuals(''); 

    modal.classList.remove('hidden');
    // ★ [해결 2] setTimeout 없이 즉각적인 포커스로 브라우저 방어 우회
    tInput.focus(); 
};

window.closeTranscription = function() {
    document.getElementById('transcriptionModal').classList.add('hidden');
    document.getElementById('transcriptionInput').blur();
    document.getElementById('transcriptionText').classList.remove('finished');
};

document.getElementById('transcriptionInput').addEventListener('input', function() {
    let typed = this.value;
    
    if (typed.length > currentTranscriptionText.length) {
        this.value = typed.substring(0, currentTranscriptionText.length);
        typed = this.value;
    }

    updateTranscriptionVisuals(typed);

    if (typed.length === currentTranscriptionText.length) {
        const tText = document.getElementById('transcriptionText');
        const prog = document.getElementById('transcriptionProgress');
        
        tText.classList.add('finished'); 
        prog.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        prog.style.color = 'var(--text-color)';
        
        this.blur(); 

        setTimeout(() => {
            window.closeTranscription();
        }, 1200); 
    }
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && !document.getElementById('transcriptionModal').classList.contains('hidden')) {
        window.closeTranscription();
    }
});

// ★ [해결 1] 타이핑 시각 효과 (next-char와 composing-char 완벽 분리)
function updateTranscriptionVisuals(typed) {
    const tText = document.getElementById('transcriptionText');
    const typedArr = typed.split('');
    const originalArr = currentTranscriptionText.split('');

    let html = '';

    for (let i = 0; i < originalArr.length; i++) {
        const char = originalArr[i];
        const typedChar = typedArr[i];

        let className = '';
        let displayCharStr = char; 

        if (i === typed.length) {
            className = 'next-char'; // 다음에 쳐야 할 글자 (흐린 밑줄)
        } else if (typedChar === undefined) {
            className = ''; // 아직 닿지 않은 글자
        } else {
            displayCharStr = typedChar; // 사용자가 친 글자를 무조건 보여줌

            if (typedChar === char) {
                className = 'correct'; 
            } else if (i === typed.length - 1) {
                className = 'composing-char'; // 한글 조합 중 (진한 밑줄+진한 글자, 오타 아님)
            } else {
                className = 'incorrect'; // 넘어갔는데도 틀렸다면 오타 판정
            }
        }

        const displayChar = displayCharStr === ' ' ? '&nbsp;' : displayCharStr === '\n' ? '<br>' : escapeHTML(displayCharStr);
        html += `<span class="${className}">${displayChar}</span>`;
    }

    tText.innerHTML = html;

    if (originalArr.length > 0 && typed.length !== currentTranscriptionText.length) {
        const progress = Math.floor((typed.length / originalArr.length) * 100);
        document.getElementById('transcriptionProgress').innerText = `${progress}%`;
    }
}