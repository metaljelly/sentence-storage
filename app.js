import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, limit, startAfter, deleteDoc, doc, updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const sentencesRef = collection(db, "sentences");
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

let currentUser = null; 
let localSentences = JSON.parse(localStorage.getItem('myLocalSentences')) || [];
let firebaseSentences = []; 
let lastVisible = null; 
let isFetching = false;

let editingId = null;
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

// 해킹/태그 깨짐 방지를 위한 특수문자 변환 함수
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
}

function formatDate(timestamp) {
    return new Date(timestamp).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// [데이터 초기화 및 로드]
async function initLoad() {
    firebaseSentences = [];
    lastVisible = null;
    await fetchSentences();
}

async function fetchSentences() {
    if (isFetching) return;
    isFetching = true;
    
    try {
        let q;
        if (lastVisible) {
            q = query(sentencesRef, orderBy("createdAt", "desc"), startAfter(lastVisible), limit(20));
        } else {
            q = query(sentencesRef, orderBy("createdAt", "desc"), limit(20));
        }

        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            lastVisible = snapshot.docs[snapshot.docs.length - 1];
            snapshot.forEach(doc => {
                firebaseSentences.push({ id: doc.id, ...doc.data() });
            });
            if (snapshot.docs.length === 20) loadMoreBtn.classList.remove('hidden');
            else loadMoreBtn.classList.add('hidden');
        } else {
            loadMoreBtn.classList.add('hidden');
        }
        renderSentences();
    } catch (err) {
        console.error("데이터 로드 오류:", err);
    } finally {
        isFetching = false;
    }
}

window.loadMore = fetchSentences;

// [드롭다운 메뉴 제어]
document.addEventListener('click', e => {
    const menuBtn = e.target.closest('.menu-btn');
    if (!menuBtn) { document.querySelectorAll('.dropdown-content.show').forEach(el => el.classList.remove('show')); return; }
    const dropdown = menuBtn.nextElementSibling;
    const isShowing = dropdown.classList.contains('show');
    document.querySelectorAll('.dropdown-content.show').forEach(el => el.classList.remove('show'));
    if (!isShowing) dropdown.classList.add('show');
});

// [다크모드 및 아이콘 제어]
const themeBtn = document.querySelector('.theme-btn');

const sunIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
const moonIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;

function updateThemeIcon(theme) {
    if (!themeBtn) return;
    themeBtn.innerHTML = theme === 'dark' ? sunIcon : moonIcon;
}

const savedTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);
updateThemeIcon(savedTheme);

window.toggleTheme = () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
};

// [검색 및 필터링]
searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    renderSentences();
});

window.setFilter = (type) => {
    currentFilter = type;
    document.querySelectorAll('.filter-tab').forEach(btn => btn.classList.remove('active'));
    document.getElementById('tab-' + type).classList.add('active');
    renderSentences();
};

// [인증 상태 확인]
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    if (user) {
        const name = user.displayName || user.email.split('@')[0];
        authSection.innerHTML = `<div class="user-info"><span>${name}님</span><span class="logout-text" onclick="window.handleLogout()">로그아웃</span></div>`;
        tabLikedBtn.style.display = "block";
    } else {
        authSection.innerHTML = `<div class="auth-init" id="authInit"><button class="auth-btn" onclick="window.showAuthOptions()">로그인</button></div>
        <div class="auth-options hidden" id="authOptions"><button class="auth-btn" onclick="window.handleGoogleLogin()">Google</button><span style="color:var(--border-color)">|</span><button class="auth-btn" onclick="window.showEmailAuth()">이메일</button><button class="auth-cancel-btn" onclick="window.hideAuthOptions()">취소</button></div>
        <div class="email-auth-form hidden" id="emailAuthForm"><div class="auth-input-group"><input type="email" id="emailInput" class="auth-input" placeholder="이메일"><input type="password" id="pwInput" class="auth-input" placeholder="비밀번호(6자 이상)"></div><div class="auth-btn-group"><button class="auth-submit-btn" onclick="window.submitEmailAuth()">확인</button><button class="auth-cancel-btn" onclick="window.hideEmailAuth()">취소</button></div></div>`;
        tabLikedBtn.style.display = "none";
        if (currentFilter === 'liked') window.setFilter('all');
    }
    initLoad(); 
});

// [로그인 로직]
window.showAuthOptions = () => { document.getElementById('authInit').classList.add('hidden'); document.getElementById('authOptions').classList.remove('hidden'); };
window.hideAuthOptions = () => { document.getElementById('authOptions').classList.add('hidden'); document.getElementById('authInit').classList.remove('hidden'); };
window.showEmailAuth = () => { document.getElementById('authOptions').classList.add('hidden'); document.getElementById('emailAuthForm').classList.remove('hidden'); };
window.hideEmailAuth = () => { document.getElementById('emailAuthForm').classList.add('hidden'); document.getElementById('authOptions').classList.remove('hidden'); };
window.handleGoogleLogin = () => signInWithPopup(auth, provider);
window.handleLogout = () => signOut(auth);
window.submitEmailAuth = async () => {
    const email = document.getElementById('emailInput').value.trim();
    const pw = document.getElementById('pwInput').value;
    try { await signInWithEmailAndPassword(auth, email, pw); } catch(err) {
        if(confirm("계정이 없거나 비번이 다릅니다. 새로 가입할까요?")) {
            try { await createUserWithEmailAndPassword(auth, email, pw); } catch(e) { alert(e.message); }
        }
    }
};

// [문장 리스트 렌더링]
function renderSentences() {
    sentenceList.innerHTML = '';
    const combined = [...firebaseSentences, ...localSentences].sort((a, b) => b.createdAt - a.createdAt);
    
    let filtered = combined;
    if (currentFilter === 'mine') {
        filtered = combined.filter(s => s.authorId === 'local' || (currentUser && s.authorId === currentUser.uid));
    } else if (currentFilter === 'liked') {
        filtered = combined.filter(s => currentUser && s.likedBy?.includes(currentUser.uid));
    }
    
    if (searchQuery) {
        filtered = filtered.filter(s => s.content.toLowerCase().includes(searchQuery) || (s.source && s.source.toLowerCase().includes(searchQuery)));
    }

    if (filtered.length === 0) {
        sentenceList.innerHTML = `<div class="empty-message">문장이 없습니다.</div>`;
        return;
    }

    filtered.forEach(sentence => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'sentence-item';
        itemDiv.id = `item-${sentence.id}`;
        
        const isMine = sentence.authorId === 'local' || (currentUser && sentence.authorId === currentUser.uid);
        const hasLiked = currentUser && sentence.likedBy?.includes(currentUser.uid);
        const likeCount = sentence.likedBy?.length || 0;

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
                        필사
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
            <div class="sentence-content">"${escapeHTML(sentence.content)}"</div>
            <div class="sentence-bottom">${sentence.source ? '— ' + escapeHTML(sentence.source) : ''}</div>
            ${kebabMenuHtml}
            <div class="bottom-right-group">
                <div class="date-wrapper">
                    ${sentence.authorId === 'local' ? '<span class="badge-mine badge-local">로컬</span>' : ''}
                    <div class="sentence-date">${formatDate(sentence.createdAt)}</div>
                </div>
                <button class="like-btn ${hasLiked ? 'liked' : ''}" onclick="window.toggleLike('${sentence.id}')">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="${hasLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" /></svg>
                    ${likeCount > 0 ? `<span>${likeCount}</span>` : ''}
                </button>
            </div>
        `;
        sentenceList.appendChild(itemDiv);
    });
}

// [문장 저장 기능]
form.addEventListener('submit', async e => {
    e.preventDefault();
    const content = contentInput.value.trim();
    const source = sourceInput.value.trim();
    
    if (!content || content.length > 500) return alert("문장을 1~500자 사이로 입력해주세요.");

    submitBtn.disabled = true;
    try {
        if (editingId) {
            if (String(editingId).startsWith('local_')) {
                const target = localSentences.find(s => s.id === editingId);
                if(target) { target.content = content; target.source = source; }
            } else {
                await updateDoc(doc(db, "sentences", editingId), { content, source });
                const idx = firebaseSentences.findIndex(s => s.id === editingId);
                if(idx !== -1) { firebaseSentences[idx].content = content; firebaseSentences[idx].source = source; }
            }
            editingId = null;
            submitBtn.textContent = '기록하기';
        } else {
            const newDoc = { content, source, createdAt: Date.now(), likedBy: [] };
            if (currentUser) {
                const docRef = await addDoc(sentencesRef, { ...newDoc, authorId: currentUser.uid });
                firebaseSentences.unshift({ id: docRef.id, ...newDoc, authorId: currentUser.uid });
            } else {
                const localDoc = { id: 'local_' + Date.now(), ...newDoc, authorId: 'local' };
                localSentences.unshift(localDoc);
            }
        }
        localStorage.setItem('myLocalSentences', JSON.stringify(localSentences));
        contentInput.value = ''; sourceInput.value = ''; contentInput.style.height = 'auto';
        renderSentences();
    } catch (err) { 
        alert("저장에 실패했습니다."); 
        console.error(err);
    } finally { 
        submitBtn.disabled = false; 
    }
});

contentInput.addEventListener('input', function() { this.style.height = 'auto'; this.style.height = this.scrollHeight + 'px'; });

// [기타 액션 로직]
window.copySentence = (id) => {
    const s = [...firebaseSentences, ...localSentences].find(x => x.id === id);
    if (s) navigator.clipboard.writeText(`"${s.content}"\n— ${s.source || '작자 미상'}`).then(() => alert("복사되었습니다."));
};

window.downloadImage = (id) => {
    const el = document.getElementById(`item-${id}`);
    el.classList.add('capture-mode');
    setTimeout(() => {
        html2canvas(el, { backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-color').trim(), scale: 2 }).then(canvas => {
            const link = document.createElement('a'); link.download = `sentence_${Date.now()}.png`; link.href = canvas.toDataURL(); link.click();
            el.classList.remove('capture-mode');
        });
    }, 100);
};

window.deleteSentence = async (id) => {
    if(!confirm("정말 삭제할까요?")) return;
    if (String(id).startsWith('local_')) {
        localSentences = localSentences.filter(s => s.id !== id);
    } else {
        await deleteDoc(doc(db, "sentences", id));
        firebaseSentences = firebaseSentences.filter(s => s.id !== id);
    }
    localStorage.setItem('myLocalSentences', JSON.stringify(localSentences));
    renderSentences();
};

window.editSentence = (id) => {
    const s = [...firebaseSentences, ...localSentences].find(x => x.id === id);
    if(s) { contentInput.value = s.content; sourceInput.value = s.source; editingId = s.id; submitBtn.textContent = '수정 완료'; contentInput.focus(); window.scrollTo(0,0); }
};

window.toggleLike = async (id) => {
    if (String(id).startsWith('local_')) return alert("로컬 문장은 좋아요를 누를 수 없습니다.");
    if (!currentUser) return alert("로그인이 필요합니다.");
    
    const s = firebaseSentences.find(x => x.id === id);
    if (!s) return;
    if (!s.likedBy) s.likedBy = []; 
    
    const likedBy = s.likedBy;
    const docRef = doc(db, "sentences", id);

    if (likedBy.includes(currentUser.uid)) {
        await updateDoc(docRef, { likedBy: arrayRemove(currentUser.uid) });
        s.likedBy = likedBy.filter(u => u !== currentUser.uid);
    } else {
        await updateDoc(docRef, { likedBy: arrayUnion(currentUser.uid) });
        s.likedBy.push(currentUser.uid);
    }
    renderSentences();
};

/* =========================================
   ✍️ 몰입형 필사(Transcription) 모드 
========================================= */
const tInput = document.getElementById('transcriptionInput');

const lockCaretToEnd = (el) => {
    const len = el.value.length;
    el.setSelectionRange(len, len);
};

['click', 'select', 'focus', 'keyup', 'touchstart'].forEach(evt => {
    tInput.addEventListener(evt, () => lockCaretToEnd(tInput));
});

document.getElementById('transcriptionModal').addEventListener('click', function(e) {
    if (!e.target.closest('.transcription-close') && !e.target.closest('.transcription-skip')) {
        tInput.focus();
    }
});

window.openTranscription = (id) => {
    const s = [...firebaseSentences, ...localSentences].find(x => x.id === id);
    if(!s) return;
    
    let cleanText = s.content.replace(/\([\u4e00-\u9fa5\uF900-\uFAFF]+\)/g, '').replace(/[\u4e00-\u9fa5\uF900-\uFAFF]/g, '').trim();
    currentTranscriptionText = cleanText;

    tInput.value = '';
    document.getElementById('transcriptionProgress').innerText = '0%';
    document.getElementById('transcriptionText').classList.remove('finished');
    
    document.body.style.overflow = 'hidden'; 
    document.getElementById('transcriptionModal').classList.remove('hidden');
    tInput.focus();
    updateTranscriptionVisuals('');
};

window.closeTranscription = () => { 
    document.getElementById('transcriptionModal').classList.add('hidden'); 
    tInput.blur();
    document.body.style.overflow = ''; 
};

window.skipTranscription = () => {
    const combined = [...firebaseSentences, ...localSentences];
    if (combined.length === 0) return alert("필사할 문장이 없습니다.");
    
    let next;
    do {
        next = combined[Math.floor(Math.random() * combined.length)];
    } while (combined.length > 1 && next.content === currentTranscriptionText);
    
    window.openTranscription(next.id);
};

tInput.addEventListener('input', function() {
    lockCaretToEnd(this);
    
    let val = this.value;
    if(val.length > currentTranscriptionText.length) val = val.substring(0, currentTranscriptionText.length);
    updateTranscriptionVisuals(val);
    
    if(val.length === currentTranscriptionText.length) {
        document.getElementById('transcriptionText').classList.add('finished');
        this.blur();
        setTimeout(() => {
            window.skipTranscription(); 
        }, 1500);
    }
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && !document.getElementById('transcriptionModal').classList.contains('hidden')) {
        window.closeTranscription();
    }
});

function updateTranscriptionVisuals(typed) {
    const tText = document.getElementById('transcriptionText');
    const originalArr = currentTranscriptionText.split('');
    let html = '';
    
    for (let i = 0; i < originalArr.length; i++) {
        const char = originalArr[i]; 
        const typedChar = typed[i];
        let className = ''; 
        let displayStr = char; 
        
        if (i === typed.length) {
            className = 'next-char';
        } else if (i < typed.length) {
            if (typedChar === char) {
                className = 'correct';
                displayStr = char;
            } else {
                // 오타 발생 시 처리
                className = 'incorrect';
                
                // 사용자의 피드백 반영: 
                // 글자를 입력해야 할 자리에 공백을 친 경우 -> 원문(char)을 빨간색으로 표시하여 가독성 유지
                // 그 외 글자 오타의 경우 -> 사용자가 실제로 친 글자(typedChar)를 빨간색으로 표시
                if (typedChar === ' ') {
                    displayStr = char;
                } else {
                    // 마지막 입력 글자가 한글 조합 중일 수 있으므로 composing-char 스타일 활용 가능하지만, 
                    // 여기서는 오타 기록을 명확히 보여주기 위해 typedChar를 그대로 노출
                    displayStr = typedChar;
                }
                
                // 단, 한글 조합 중인 마지막 글자의 시각적 어색함을 줄이기 위해 추가 처리
                if (i === typed.length - 1 && typedChar !== ' ' && typedChar !== char) {
                    className = 'composing-char incorrect';
                }
            }
        }
        
        const displayChar = displayStr === ' ' ? '&nbsp;' : displayStr === '\n' ? '<br>' : escapeHTML(displayStr);
        html += `<span class="${className}">${displayChar}</span>`;
    }
    
    tText.innerHTML = html;
    
    if (typed.length < currentTranscriptionText.length) {
        const progressEl = document.getElementById('transcriptionProgress');
        progressEl.style.color = 'var(--muted-color)';
        progressEl.innerText = Math.floor((typed.length / currentTranscriptionText.length) * 100) + '%';
    }
}