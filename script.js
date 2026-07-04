import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, addDoc, deleteDoc,
  collection, query, where, orderBy, limit, onSnapshot,
  serverTimestamp, Timestamp, getDocs, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
// ==================== CONFIG ====================
const firebaseConfig = {
  apiKey: "AIzaSyCZ1vBeX58rM78gKHk79Ag-N46N1SGNtyw",
  authDomain: "bookverse-chat-pro.firebaseapp.com",
  projectId: "bookverse-chat-pro",
  storageBucket: "bookverse-chat-pro.firebasestorage.app",
  messagingSenderId: "935236665867",
  appId: "1:935236665867:web:32963d8c8c37be1e0dbd0e"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ==================== STATE ====================
let currentUser = null;
let currentProfile = null;
let currentView = 'chats';
let activeChat = null;
let friends = [];
let incomingRequests = [];
let outgoingRequests = [];
let groups = [];
let onlineIds = new Set();
let friendPresenceUnsubs = {};
let messagesUnsub = null;
let typingUnsub = null;
let typingTimeout = null;
let storiesByUser = {};
let activeStoryQueue = [];
let activeStoryIndex = 0;
let storyTimer = null;
let pendingMediaFile = null;
let friendsUnsub1 = null, friendsUnsub2 = null;

// ==================== HELPERS ====================
const $ = (id) => document.getElementById(id);
const esc = (s) => (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function initials(name){ if(!name) return '?'; return name.trim().split(/\s+/).slice(0,2).map(w=>w[0]?.toUpperCase()).join(''); }
function dmChatId(a,b){ return [a,b].sort().join('_'); }
function groupChatId(gid){ return 'g'+gid; }
function toDate(ts){ if(!ts) return new Date(); if(ts.toDate) return ts.toDate(); if(ts instanceof Date) return ts; return new Date(ts); }
function fmtTime(ts){ const d = toDate(ts); return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }
function toast(msg){ const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(()=>t.classList.add('hidden'), 2600); }
function avatarNode(profile, sizeClass=''){
  if(profile?.avatarUrl){
    return `<img src="${esc(profile.avatarUrl)}" class="w-full h-full object-cover ${sizeClass}" />`;
  }
  return `<span>${esc(initials(profile?.name))}</span>`;
}
function closeAllModals(){
  ['modal-profile','modal-group','modal-story-create','modal-story-view'].forEach(id=>$(id).classList.add('hidden'));
  $('modal-backdrop').classList.add('hidden');
  stopStoryTimer();
  const fs = document.getElementById('modal-friend-search');
  if(fs) fs.remove();
}
function openModal(id){ $('modal-backdrop').classList.remove('hidden'); $(id).classList.remove('hidden'); }

// ==================== AUTH ====================
$('tab-login').onclick = () => { $('tab-login').classList.add('text-gold','border-b-2','border-gold'); $('tab-login').classList.remove('text-muted'); $('tab-signup').classList.remove('text-gold','border-b-2','border-gold'); $('tab-signup').classList.add('text-muted'); $('login-form').classList.remove('hidden'); $('signup-form').classList.add('hidden'); $('auth-msg').textContent=''; };
$('tab-signup').onclick = () => { $('tab-signup').classList.add('text-gold','border-b-2','border-gold'); $('tab-signup').classList.remove('text-muted'); $('tab-login').classList.remove('text-gold','border-b-2','border-gold'); $('tab-login').classList.add('text-muted'); $('signup-form').classList.remove('hidden'); $('login-form').classList.add('hidden'); $('auth-msg').textContent=''; };

$('btn-login').onclick = async () => {
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  if(!email || !password){ $('auth-msg').textContent = 'Enter email and password.'; return; }
  $('auth-msg').textContent = 'Signing in…';
  try{
    await signInWithEmailAndPassword(auth, email, password);
  }catch(err){ $('auth-msg').textContent = err.message; $('auth-msg').classList.add('text-crimson'); }
};

$('btn-signup').onclick = async () => {
  const name = $('signup-name').value.trim();
  const email = $('signup-email').value.trim();
  const password = $('signup-password').value;
  if(!name || !email || password.length < 6){ $('auth-msg').textContent = 'Fill all fields (password ≥ 6 chars).'; return; }
  $('auth-msg').textContent = 'Creating your shelf…';
  try{
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db,'users',cred.user.uid), { name, avatarUrl: null, lastSeen: serverTimestamp() });
  }catch(err){ $('auth-msg').textContent = err.message; }
};

$('btn-logout').onclick = async () => { await signOut(auth); };

onAuthStateChanged(auth, async (user) => {
  if(user){
    currentUser = user;
    await bootApp();
  } else {
    currentUser = null;
    $('auth-screen').classList.remove('hidden');
    $('app-screen').classList.add('hidden');
    Object.values(friendPresenceUnsubs).forEach(u => u());
    friendPresenceUnsubs = {};
    if(messagesUnsub) messagesUnsub();
    if(typingUnsub) typingUnsub();
    if(friendsUnsub1) friendsUnsub1();
    if(friendsUnsub2) friendsUnsub2();
  }
});

// ==================== BOOT ====================
async function bootApp(){
  $('auth-screen').classList.add('hidden');
  $('app-screen').classList.remove('hidden');

  let snap = await getDoc(doc(db,'users',currentUser.uid));
  if(!snap.exists()){
    await setDoc(doc(db,'users',currentUser.uid), { name: currentUser.email.split('@')[0], avatarUrl: null, lastSeen: serverTimestamp() });
    snap = await getDoc(doc(db,'users',currentUser.uid));
  }
  currentProfile = { id: currentUser.uid, ...snap.data() };
  renderSelfAvatar();

  updateDoc(doc(db,'users',currentUser.uid), { lastSeen: serverTimestamp() });
  setInterval(()=> updateDoc(doc(db,'users',currentUser.uid), { lastSeen: serverTimestamp() }), 30000);
  setInterval(recomputeOnline, 15000);

  subscribeFriendsRealtime();
  await loadGroups();
  setView('chats');
}

function renderSelfAvatar(){
  $('btn-open-profile').innerHTML = avatarNode(currentProfile);
}

// ==================== PRESENCE (heartbeat-based) ====================
function recomputeOnline(){
  const now = Date.now();
  onlineIds = new Set();
  friends.forEach(f => { if(f._lastSeenMs && now - f._lastSeenMs < 60000) onlineIds.add(f.id); });
  renderList();
  if(activeChat) renderChatHeaderStatus();
}
function watchFriendPresence(friendId){
  if(friendPresenceUnsubs[friendId]) return;
  friendPresenceUnsubs[friendId] = onSnapshot(doc(db,'users',friendId), (snap) => {
    if(!snap.exists()) return;
    const data = snap.data();
    const f = friends.find(fr => fr.id === friendId);
    if(f){ f.name = data.name; f.avatarUrl = data.avatarUrl; f._lastSeenMs = data.lastSeen ? toDate(data.lastSeen).getTime() : 0; }
    recomputeOnline();
  });
}

// ==================== NAV ====================
document.querySelectorAll('.nav-btn').forEach(btn => { btn.onclick = () => setView(btn.dataset.view); });
function setView(view){
  currentView = view;
  document.querySelectorAll('.nav-btn').forEach(b => {
    if(b.dataset.view === view){ b.classList.add('text-gold','bg-white/5'); b.classList.remove('text-muted'); }
    else { b.classList.remove('text-gold','bg-white/5'); b.classList.add('text-muted'); }
  });
  const titles = { chats: 'Chapters', friends: 'Circle', groups: 'Book Clubs' };
  $('list-title').textContent = titles[view];
  $('list-fab-wrap').classList.toggle('hidden', view === 'chats');
  $('list-fab').textContent = view === 'friends' ? '+ Find people' : '+ New book club';
  $('list-fab').onclick = () => view === 'friends' ? openFriendSearch() : openGroupModal();
  $('list-search').value = '';
  renderList();
}
$('list-search').oninput = () => renderList();

// ==================== FRIENDS ====================
function subscribeFriendsRealtime(){
  const uid = currentUser.uid;
  const q1 = query(collection(db,'friends'), where('user1Id','==',uid));
  const q2 = query(collection(db,'friends'), where('user2Id','==',uid));
  let rows1 = [], rows2 = [];
  friendsUnsub1 = onSnapshot(q1, (snap) => { rows1 = snap.docs.map(d => ({ id: d.id, ...d.data() })); mergeFriendRows(rows1, rows2); });
  friendsUnsub2 = onSnapshot(q2, (snap) => { rows2 = snap.docs.map(d => ({ id: d.id, ...d.data() })); mergeFriendRows(rows1, rows2); });
}
async function mergeFriendRows(rows1, rows2){
  const uid = currentUser.uid;
  const rows = [...rows1, ...rows2];
  const accepted = rows.filter(r => r.status === 'accepted');
  const incoming = rows.filter(r => r.status === 'pending' && r.user2Id === uid);
  outgoingRequests = rows.filter(r => r.status === 'pending' && r.user1Id === uid);

  const friendIds = accepted.map(r => r.user1Id === uid ? r.user2Id : r.user1Id);
  const newFriends = [];
  for(const fid of friendIds){
    const existing = friends.find(f => f.id === fid);
    if(existing){ newFriends.push(existing); continue; }
    const s = await getDoc(doc(db,'users',fid));
    if(s.exists()) newFriends.push({ id: fid, ...s.data(), _lastSeenMs: 0 });
  }
  friends = newFriends;
  friends.forEach(f => watchFriendPresence(f.id));

  incomingRequests = [];
  for(const r of incoming){
    const s = await getDoc(doc(db,'users', r.user1Id));
    incomingRequests.push({ ...r, profile: s.exists() ? { id: r.user1Id, ...s.data() } : null });
  }

  await loadStories();
  await loadGroups();
  recomputeOnline();
  renderList();
}

async function searchUsers(query_){
  if(!query_.trim()) return [];
  const snap = await getDocs(collection(db,'users'));
  const q = query_.trim().toLowerCase();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(u => u.id !== currentUser.uid && u.name?.toLowerCase().includes(q))
    .slice(0, 15);
}

function openFriendSearch(){
  const box = document.createElement('div');
  box.id = 'modal-friend-search';
  box.className = 'fixed inset-0 z-50 flex items-center justify-center px-4';
  box.innerHTML = `
    <div class="bg-panel rounded-2xl p-6 w-full max-w-sm fade-in">
      <h3 class="font-display text-xl text-ivory mb-4">Find fellow readers</h3>
      <input id="fs-input" type="text" placeholder="Search by name…" class="ruled-input w-full py-2 text-ivory mb-4" />
      <div id="fs-results" class="max-h-64 overflow-y-auto space-y-2"></div>
      <button id="fs-close" class="w-full mt-4 py-2 rounded-lg border border-white/15 text-muted text-sm">Close</button>
    </div>`;
  document.body.appendChild(box);
  $('modal-backdrop').classList.remove('hidden');
  const input = box.querySelector('#fs-input');
  const results = box.querySelector('#fs-results');
  input.oninput = async () => {
    const users = await searchUsers(input.value);
    results.innerHTML = users.map(u => `
      <div class="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5">
        <div class="w-9 h-9 rounded-full bg-gold text-ink font-display font-semibold flex items-center justify-center overflow-hidden shrink-0">${avatarNode(u)}</div>
        <p class="flex-1 text-sm text-ivory truncate">${esc(u.name)}</p>
        <button data-uid="${u.id}" class="fs-add text-xs bg-gold text-ink px-3 py-1.5 rounded-full">Add</button>
      </div>`).join('') || '<p class="text-muted text-sm text-center py-4">No readers found.</p>';
    results.querySelectorAll('.fs-add').forEach(b => b.onclick = async () => {
      const uid = b.dataset.uid;
      try{
        await addDoc(collection(db,'friends'), { user1Id: currentUser.uid, user2Id: uid, status: 'pending', createdAt: serverTimestamp() });
        toast('Friend request sent.'); b.textContent = 'Sent'; b.disabled = true; b.classList.add('opacity-50');
      }catch(err){ toast(err.message); }
    });
  };
  box.querySelector('#fs-close').onclick = () => { box.remove(); closeAllModals(); };
}

async function acceptRequest(id){ await updateDoc(doc(db,'friends',id), { status: 'accepted' }); toast('Friend added.'); }
async function declineRequest(id){ await deleteDoc(doc(db,'friends',id)); }

// ==================== GROUPS ====================
async function loadGroups(){
  const q = query(collection(db,'groupMembers'), where('userId','==', currentUser.uid));
  const memSnap = await getDocs(q);
  const ids = memSnap.docs.map(d => d.data().groupId);
  groups = [];
  for(const gid of ids){
    const s = await getDoc(doc(db,'groups', gid));
    if(s.exists()) groups.push({ id: gid, ...s.data() });
  }
  renderList();
}

function openGroupModal(){
  $('group-name-input').value = '';
  const list = $('group-members-list');
  list.innerHTML = friends.map(f => `
    <label class="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 cursor-pointer">
      <input type="checkbox" value="${f.id}" class="gm-check accent-[#C6A15B]" />
      <div class="w-8 h-8 rounded-full bg-gold text-ink font-display font-semibold flex items-center justify-center overflow-hidden shrink-0 text-xs">${avatarNode(f)}</div>
      <span class="text-sm text-ivory">${esc(f.name)}</span>
    </label>`).join('') || '<p class="text-muted text-sm py-2">Add friends first to start a book club.</p>';
  openModal('modal-group');
}
$('btn-group-cancel').onclick = closeAllModals;
$('btn-group-create').onclick = async () => {
  const name = $('group-name-input').value.trim();
  if(!name){ toast('Give your book club a name.'); return; }
  const memberIds = Array.from(document.querySelectorAll('.gm-check:checked')).map(c => c.value);
  try{
    const groupRef = await addDoc(collection(db,'groups'), { name, adminId: currentUser.uid, createdAt: serverTimestamp() });
    const batch = writeBatch(db);
    const allMembers = [currentUser.uid, ...memberIds];
    allMembers.forEach(uid => {
      batch.set(doc(db,'groupMembers', `${groupRef.id}_${uid}`), { groupId: groupRef.id, userId: uid, joinedAt: serverTimestamp() });
    });
    await batch.commit();
    toast('Book club created.');
    closeAllModals();
    await loadGroups();
    setView('groups');
  }catch(err){ toast(err.message); }
};

// ==================== LIST RENDERING ====================
function renderList(){
  const container = $('list-container');
  const q = $('list-search').value.trim().toLowerCase();

  if(currentView === 'chats'){
    renderStoriesBar();
    const dmItems = friends.map(f => ({ type:'dm', id: f.id, title: f.name, avatar: f, chatId: dmChatId(currentUser.uid, f.id) }));
    const groupItems = groups.map(g => ({ type:'group', id: g.id, title: g.name, avatar: null, chatId: groupChatId(g.id) }));
    let items = [...dmItems, ...groupItems];
    if(q) items = items.filter(i => i.title?.toLowerCase().includes(q));
    if(!items.length){
      container.innerHTML = `<div class="text-center text-muted text-sm py-10 font-read italic">No chapters yet. Add a friend to begin.</div>`;
      return;
    }
    container.innerHTML = items.map(i => {
      const online = i.type === 'dm' && onlineIds.has(i.id);
      const isActive = activeChat && activeChat.chatId === i.chatId;
      return `
      <div data-chatid="${i.chatId}" class="chat-item flex items-center gap-3 p-2.5 rounded-xl cursor-pointer mb-1 ${isActive ? 'bg-white/10' : 'hover:bg-white/5'}">
        <div class="relative w-11 h-11 rounded-full ${i.type==='group' ? 'bg-ink-2 border border-gold/40' : 'bg-gold'} text-gold flex items-center justify-center font-display font-semibold overflow-hidden shrink-0">
          ${i.type === 'group'
            ? `<svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="7" height="16" rx="1"/><rect x="12" y="7" width="9" height="13" rx="1"/></svg>`
            : `<span class="text-ink">${avatarNode(i.avatar)}</span>`}
          ${online ? '<span class="absolute bottom-0 right-0 w-3 h-3 bg-emerald-400 rounded-full border-2 border-panel"></span>' : ''}
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm text-ivory font-medium truncate">${esc(i.title)}</p>
          <p class="text-xs text-muted truncate font-read">${i.type==='group' ? 'Book club' : (online ? 'Reading now' : 'Offline')}</p>
        </div>
      </div>`;
    }).join('');
    container.querySelectorAll('.chat-item').forEach(el => {
      el.onclick = () => {
        const id = el.dataset.chatid;
        const item = items.find(i => i.chatId === id);
        openChat(item);
      };
    });
  }

  if(currentView === 'friends'){
    let html = '';
    if(incomingRequests.length){
      html += `<p class="text-xs uppercase tracking-wide text-gold px-2 mb-1 mt-2">Requests</p>`;
      html += incomingRequests.map(r => `
        <div class="flex items-center gap-3 p-2.5 rounded-xl mb-1">
          <div class="w-10 h-10 rounded-full bg-gold text-ink font-display font-semibold flex items-center justify-center overflow-hidden shrink-0">${avatarNode(r.profile)}</div>
          <p class="flex-1 text-sm text-ivory truncate">${esc(r.profile?.name || 'Someone')}</p>
          <button data-id="${r.id}" class="acc-btn text-xs bg-gold text-ink px-2.5 py-1 rounded-full">Accept</button>
          <button data-id="${r.id}" class="dec-btn text-xs text-muted px-2 py-1">✕</button>
        </div>`).join('');
    }
    const filtered = q ? friends.filter(f => f.name?.toLowerCase().includes(q)) : friends;
    html += `<p class="text-xs uppercase tracking-wide text-muted px-2 mb-1 mt-3">My circle (${friends.length})</p>`;
    html += filtered.map(f => `
      <div data-chatid="${dmChatId(currentUser.uid,f.id)}" class="chat-item flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/5 cursor-pointer mb-1">
        <div class="relative w-10 h-10 rounded-full bg-gold text-ink font-display font-semibold flex items-center justify-center overflow-hidden shrink-0">${avatarNode(f)}
          ${onlineIds.has(f.id) ? '<span class="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-panel"></span>' : ''}
        </div>
        <p class="flex-1 text-sm text-ivory truncate">${esc(f.name)}</p>
      </div>`).join('') || (friends.length ? '' : '<p class="text-muted text-sm px-2 font-read italic">No friends yet — tap "Find people".</p>');
    container.innerHTML = html;
    container.querySelectorAll('.acc-btn').forEach(b => b.onclick = () => acceptRequest(b.dataset.id));
    container.querySelectorAll('.dec-btn').forEach(b => b.onclick = () => declineRequest(b.dataset.id));
    container.querySelectorAll('.chat-item').forEach(el => el.onclick = () => {
      const f = friends.find(fr => dmChatId(currentUser.uid,fr.id) === el.dataset.chatid);
      openChat({ type:'dm', id: f.id, title: f.name, avatar: f, chatId: el.dataset.chatid });
    });
  }

  if(currentView === 'groups'){
    let items = groups;
    if(q) items = items.filter(g => g.name.toLowerCase().includes(q));
    container.innerHTML = items.map(g => `
      <div data-chatid="${groupChatId(g.id)}" class="chat-item flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/5 cursor-pointer mb-1">
        <div class="w-10 h-10 rounded-full bg-ink-2 border border-gold/40 text-gold flex items-center justify-center shrink-0">
          <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="7" height="16" rx="1"/><rect x="12" y="7" width="9" height="13" rx="1"/></svg>
        </div>
        <p class="flex-1 text-sm text-ivory truncate">${esc(g.name)}</p>
      </div>`).join('') || '<p class="text-muted text-sm px-2 font-read italic">No book clubs yet.</p>';
    container.querySelectorAll('.chat-item').forEach(el => el.onclick = () => {
      const g = groups.find(gr => groupChatId(gr.id) === el.dataset.chatid);
      openChat({ type:'group', id: g.id, title: g.name, chatId: el.dataset.chatid });
    });
  }
}

// ==================== STORIES ====================
async function loadStories(){
  const now = Timestamp.now();
  const q = query(collection(db,'stories'), where('expiresAt','>', now), orderBy('expiresAt'), orderBy('timestamp'));
  const snap = await getDocs(q);
  const relevantIds = new Set([currentUser.uid, ...friends.map(f=>f.id)]);
  storiesByUser = {};
  snap.docs.forEach(d => {
    const s = { id: d.id, ...d.data() };
    if(!relevantIds.has(s.userId)) return;
    (storiesByUser[s.userId] = storiesByUser[s.userId] || []).push(s);
  });
  Object.values(storiesByUser).forEach(list => list.sort((a,b) => toDate(a.timestamp) - toDate(b.timestamp)));
  renderStoriesBar();
}

function renderStoriesBar(){
  const bar = $('stories-bar');
  const mine = storiesByUser[currentUser.uid] || [];
  let html = `
    <div class="flex flex-col items-center gap-1 shrink-0 cursor-pointer" id="story-add-btn">
      <div class="relative w-14 h-14 rounded-full ${mine.length ? 'ring-2 ring-gold' : 'ring-2 ring-dashed ring-muted/50'} p-0.5">
        <div class="w-full h-full rounded-full bg-gold text-ink font-display font-semibold flex items-center justify-center overflow-hidden">${avatarNode(currentProfile)}</div>
        <div class="absolute -bottom-1 -right-1 w-5 h-5 bg-gold rounded-full flex items-center justify-center text-ink text-xs font-bold border-2 border-panel">+</div>
      </div>
      <span class="text-[10px] text-muted">Your mark</span>
    </div>`;
  friends.forEach(f => {
    const st = storiesByUser[f.id];
    if(!st || !st.length) return;
    const allSeen = st.every(s => (s.seenLocally));
    html += `
      <div class="flex flex-col items-center gap-1 shrink-0 cursor-pointer story-avatar" data-uid="${f.id}">
        <div class="relative w-14 h-14 rounded-full ring-2 ${allSeen ? 'ring-muted/40' : 'ring-gold'} p-0.5">
          <div class="w-full h-full rounded-full bg-gold text-ink font-display font-semibold flex items-center justify-center overflow-hidden">${avatarNode(f)}</div>
        </div>
        <span class="text-[10px] text-muted truncate w-14 text-center">${esc(f.name.split(' ')[0])}</span>
      </div>`;
  });
  bar.innerHTML = html;
  $('story-add-btn').onclick = () => { $('story-text-input').value=''; openModal('modal-story-create'); };
  bar.querySelectorAll('.story-avatar').forEach(el => el.onclick = () => openStoryViewer(el.dataset.uid));
}

$('btn-story-cancel').onclick = closeAllModals;
$('btn-story-post').onclick = async () => {
  const text = $('story-text-input').value.trim();
  if(!text){ toast('Write something.'); return; }
  let mediaUrl = null, type = 'text';
  try{
    const expiresAt = Timestamp.fromMillis(Date.now() + 24*3600*1000);
    await addDoc(collection(db,'stories'), { userId: currentUser.uid, text: text || null, mediaUrl, type, timestamp: serverTimestamp(), expiresAt });
    toast('Bookmark pinned for 24 hours.');
    closeAllModals();
    loadStories();
  }catch(err){ toast(err.message); }
};

function openStoryViewer(uid){
  activeStoryQueue = storiesByUser[uid] || [];
  activeStoryIndex = 0;
  if(!activeStoryQueue.length) return;
  openModal('modal-story-view');
  renderStoryFrame();
}
function renderStoryFrame(){
  stopStoryTimer();
  const story = activeStoryQueue[activeStoryIndex];
  if(!story){ closeAllModals(); return; }
  const owner = friends.find(f=>f.id===story.userId) || currentProfile;
  $('story-progress').innerHTML = activeStoryQueue.map((_,i)=>`<div class="flex-1 h-full rounded-full bg-white/25 overflow-hidden"><div class="h-full bg-gold ${i<activeStoryIndex?'w-full':(i===activeStoryIndex?'story-fill':'w-0')}"></div></div>`).join('');
  $('story-view-body').innerHTML = story.mediaUrl
    ? `<img src="${esc(story.mediaUrl)}" class="max-h-full max-w-full rounded-lg object-contain" />`
    : `<p class="font-read text-ivory text-xl leading-relaxed">${esc(story.text)}</p>`;
  $('story-view-footer').innerHTML = `
    <div class="w-6 h-6 rounded-full bg-gold text-ink flex items-center justify-center overflow-hidden text-[10px] font-semibold">${avatarNode(owner)}</div>
    <span>${esc(owner.name)} · ${fmtTime(story.timestamp)}</span>`;
  story.seenLocally = true;
  setDoc(doc(db,'storyViews', `${story.id}_${currentUser.uid}`), { storyId: story.id, viewerId: currentUser.uid, timestamp: serverTimestamp() }, { merge: true });
  const fillBar = document.querySelectorAll('#story-progress .story-fill')[0];
  if(fillBar){ fillBar.style.transition = 'width 5s linear'; requestAnimationFrame(()=> fillBar.style.width = '100%'); }
  storyTimer = setTimeout(() => { activeStoryIndex++; renderStoryFrame(); }, 5000);
}
function stopStoryTimer(){ if(storyTimer) clearTimeout(storyTimer); storyTimer = null; }
$('btn-story-close').onclick = closeAllModals;

// ==================== PROFILE MODAL ====================
$('btn-open-profile').onclick = () => {
  $('profile-name-input').value = currentProfile.name || '';
  $('profile-avatar-preview').innerHTML = avatarNode(currentProfile);
  openModal('modal-profile');
};
$('btn-profile-cancel').onclick = closeAllModals;
$('btn-profile-save').onclick = async () => {
  const name = $('profile-name-input').value.trim();
  let avatarUrl = currentProfile.avatarUrl;
  try{
    await updateDoc(doc(db,'users',currentUser.uid), { name, avatarUrl });
    currentProfile = { ...currentProfile, name, avatarUrl };
    renderSelfAvatar();
    toast('Bookplate updated.');
    closeAllModals();
  }catch(err){ toast(err.message); }
};

// ==================== CHAT ====================
async function openChat(item){
  activeChat = item;
  if(item.type === 'group'){
    const q = query(collection(db,'groupMembers'), where('groupId','==', item.id));
    const snap = await getDocs(q);
    activeChat.memberIds = snap.docs.map(d => d.data().userId);
  } else {
    activeChat.memberIds = [currentUser.uid, item.id];
  }
  $('chat-empty').classList.add('hidden');
  $('chat-active').classList.remove('hidden');
  $('chat-active').classList.add('flex');
  $('chat-panel').classList.remove('hidden');
  $('chat-panel').classList.add('flex');
  if(window.innerWidth < 640){ $('list-panel').classList.add('hidden'); }

  $('chat-avatar').innerHTML = item.type === 'group'
    ? `<svg viewBox="0 0 24 24" class="w-5 h-5 text-ink" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="7" height="16" rx="1"/><rect x="12" y="7" width="9" height="13" rx="1"/></svg>`
    : avatarNode(item.avatar);
  $('chat-name').textContent = item.title;
  renderChatHeaderStatus();

  subscribeMessages(item.chatId);
  subscribeTyping(item.chatId);
  renderList();
}

function renderChatHeaderStatus(){
  if(!activeChat) return;
  if(activeChat.type === 'dm'){
    $('chat-sub').textContent = onlineIds.has(activeChat.id) ? 'reading now' : 'offline';
  } else {
    $('chat-sub').textContent = `${(activeChat.memberIds||[]).length} members`;
  }
}

$('btn-back').onclick = () => {
  $('list-panel').classList.remove('hidden');
  $('chat-panel').classList.add('hidden');
};

function subscribeMessages(chatId){
  if(messagesUnsub) messagesUnsub();
  const q = query(
    collection(db,'messages'),
    where('chatId','==',chatId),
    where('participants','array-contains', currentUser.uid),
    orderBy('timestamp','asc'),
    limit(300)
  );
  let first = true;
  messagesUnsub = onSnapshot(q, (snap) => {
    if(first){
      $('messages').innerHTML = '';
      snap.docs.forEach(d => appendMessage({ id: d.id, ...d.data() }, false));
      scrollMessagesToBottom();
      first = false;
      return;
    }
    snap.docChanges().forEach(change => {
      if(change.type === 'added') appendMessage({ id: change.doc.id, ...change.doc.data() }, true);
    });
  });
}

function subscribeTyping(chatId){
  if(typingUnsub) typingUnsub();
  typingUnsub = onSnapshot(doc(db,'typingStatus',chatId), (snap) => {
    if(!snap.exists()) return;
    const data = snap.data();
    const now = Date.now();
    const typers = Object.entries(data)
      .filter(([uid, ts]) => uid !== currentUser.uid && ts && (now - ts) < 3000);
    $('typing-indicator').textContent = typers.length ? 'writing…' : '';
  });
}

function appendMessage(m, animate){
  const mine = m.senderId === currentUser.uid;
  const wrap = document.createElement('div');
  wrap.className = `flex ${mine ? 'justify-end' : 'justify-start'} ${animate ? 'fade-in' : ''}`;
  const bubbleClass = mine ? 'torn-out' : 'torn-in';
  let mediaHtml = '';
  if(m.mediaUrl && m.mediaType === 'image'){
    mediaHtml = `<img src="${esc(m.mediaUrl)}" class="rounded-lg max-w-[220px] mb-1.5" />`;
  }
  wrap.innerHTML = `
    <div class="relative max-w-[75%] ${bubbleClass} px-3.5 py-2.5">
      ${mediaHtml}
      ${m.text ? `<p class="font-read text-parchment-ink text-[15px] leading-snug whitespace-pre-wrap">${esc(m.text)}</p>` : ''}
      <p class="font-mono text-[10px] text-parchment-ink/50 mt-1 text-right">${fmtTime(m.timestamp)}</p>
    </div>`;
  $('messages').appendChild(wrap);
  if(animate) scrollMessagesToBottom();
}
function scrollMessagesToBottom(){ const c = $('messages'); c.scrollTop = c.scrollHeight; }

$('msg-input').addEventListener('input', () => {
  $('msg-input').style.height = 'auto';
  $('msg-input').style.height = Math.min($('msg-input').scrollHeight, 112) + 'px';
  if(activeChat){
    setDoc(doc(db,'typingStatus',activeChat.chatId), { [currentUser.uid]: Date.now() }, { merge: true });
  }
});

$('composer').onsubmit = async (e) => {
  e.preventDefault();
  if(!activeChat) return;
  const text = $('msg-input').value.trim();
  if(!text) return;

  try{
    await addDoc(collection(db,'messages'), {
      chatId: activeChat.chatId,
      chatType: activeChat.type,
      senderId: currentUser.uid,
      participants: activeChat.memberIds,
      text: text || null,
      mediaUrl: null, mediaType: null,
      status: 'sent',
      timestamp: serverTimestamp()
    });
  }catch(err){ toast(err.message); return; }

  $('msg-input').value = '';
  $('msg-input').style.height = 'auto';
};

// close modals on backdrop click
$('modal-backdrop').onclick = closeAllModals;
