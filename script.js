// متغیرهای全局
let socket = null;
let currentUser = null;
let currentChatUser = null;
let typingTimeout = null;
let allUsers = [];

// اتصال به سرور
function connectSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('متصل به سرور شد');
        if (currentUser) {
            socket.emit('user-online', currentUser);
        }
    });
    
    socket.on('online-users', (users) => {
        updateUsersOnlineStatus(users);
    });
    
    socket.on('new-message', (message) => {
        if (currentChatUser && (message.from_user === currentChatUser || message.to_user === currentChatUser)) {
            displayMessage(message, message.from_user === currentUser ? 'sent' : 'received');
        }
        loadUsersList();
    });
    
    socket.on('message-sent', (message) => {
        if (currentChatUser && message.to_user === currentChatUser) {
            displayMessage(message, 'sent');
        }
    });
    
    socket.on('user-typing', (data) => {
        if (currentChatUser === data.from) {
            showTypingIndicator(data.from);
        }
    });
    
    socket.on('user-stop-typing', (data) => {
        if (currentChatUser === data.from) {
            hideTypingIndicator();
        }
    });
}

// ثبت نام
async function register() {
    const username = document.getElementById('reg-username').value.trim();
    if (!username) {
        showAuthMessage('لطفاً نام کاربری را وارد کنید', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        const data = await response.json();
        
        if (data.success) {
            showAuthMessage('ثبت نام موفق! حالا وارد شوید', 'success');
            showLogin();
        } else {
            showAuthMessage(data.error, 'error');
        }
    } catch (error) {
        showAuthMessage('خطا در ارتباط با سرور', 'error');
    }
}

// ورود
async function login() {
    const username = document.getElementById('login-username').value.trim();
    if (!username) {
        showAuthMessage('لطفاً نام کاربری را وارد کنید', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        const data = await response.json();
        
        if (data.success) {
            currentUser = data.username;
            localStorage.setItem('messenger-user', currentUser);
            document.getElementById('current-username').innerText = currentUser;
            document.getElementById('auth-page').style.display = 'none';
            document.getElementById('chat-page').style.display = 'block';
            
            if (!socket) {
                connectSocket();
            } else {
                socket.emit('user-online', currentUser);
            }
            
            loadUsersList();
        } else {
            showAuthMessage(data.error, 'error');
        }
    } catch (error) {
        showAuthMessage('خطا در ارتباط با سرور', 'error');
    }
}

// خروج
function logout() {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    currentUser = null;
    currentChatUser = null;
    localStorage.removeItem('messenger-user');
    document.getElementById('auth-page').style.display = 'flex';
    document.getElementById('chat-page').style.display = 'none';
    document.getElementById('login-username').value = '';
}

// بارگذاری لیست کاربران
async function loadUsersList() {
    if (!currentUser) return;
    
    try {
        const response = await fetch('/api/users', {
            headers: { 'x-user': currentUser }
        });
        const data = await response.json();
        
        if (data.success) {
            allUsers = data.users;
            renderUsersList(allUsers);
        }
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

// رندر لیست کاربران
function renderUsersList(users) {
    const container = document.getElementById('users-list');
    
    if (users.length === 0) {
        container.innerHTML = '<div class="loading">هیچ کاربر دیگری یافت نشد</div>';
        return;
    }
    
    container.innerHTML = users.map(user => `
        <div class="user-item ${currentChatUser === user.username ? 'active' : ''}" onclick="selectUser('${user.username}')">
            <div class="user-name">
                <span class="user-status ${user.isOnline ? 'online' : 'offline'}"></span>
                <span>${escapeHtml(user.username)}</span>
            </div>
        </div>
    `).join('');
}

// جستجوی کاربران
function searchUsers() {
    const searchTerm = document.getElementById('search-user').value.toLowerCase();
    const filtered = allUsers.filter(user => 
        user.username.toLowerCase().includes(searchTerm)
    );
    renderUsersList(filtered);
}

// به‌روزرسانی وضعیت آنلاین
function updateUsersOnlineStatus(onlineUsernames) {
    allUsers = allUsers.map(user => ({
        ...user,
        isOnline: onlineUsernames.includes(user.username)
    }));
    renderUsersList(allUsers);
    
    if (currentChatUser) {
        const isOnline = onlineUsernames.includes(currentChatUser);
        const header = document.getElementById('chat-header');
        header.innerHTML = `💬 ${escapeHtml(currentChatUser)} ${isOnline ? '🟢 آنلاین' : '⚫ آفلاین'}`;
    }
}

// انتخاب کاربر برای چت
async function selectUser(username) {
    currentChatUser = username;
    
    const isOnline = allUsers.find(u => u.username === username)?.isOnline || false;
    document.getElementById('chat-header').innerHTML = `💬 ${escapeHtml(username)} ${isOnline ? '🟢 آنلاین' : '⚫ آفلاین'}`;
    
    document.getElementById('messages-container').innerHTML = '<div class="loading">در حال بارگذاری پیام‌ها...</div>';
    
    try {
        const response = await fetch(`/api/messages/${username}`, {
            headers: { 'x-user': currentUser }
        });
        const data = await response.json();
        
        if (data.success) {
            const container = document.getElementById('messages-container');
            container.innerHTML = '';
            
            if (data.messages.length === 0) {
                container.innerHTML = '<div class="empty-chat">💬 هنوز پیامی ارسال نشده است</div>';
            } else {
                data.messages.forEach(msg => {
                    const type = msg.from_user === currentUser ? 'sent' : 'received';
                    displayMessage(msg, type);
                });
            }
            scrollToBottom();
        }
    } catch (error) {
        console.error('Error loading messages:', error);
    }
    
    // به‌روزرسانی کلاس active در لیست
    document.querySelectorAll('.user-item').forEach(el => {
        el.classList.remove('active');
        if (el.innerText.includes(username)) {
            el.classList.add('active');
        }
    });
}

// نمایش پیام در صفحه
function displayMessage(message, type) {
    const container = document.getElementById('messages-container');
    
    if (container.querySelector('.empty-chat')) {
        container.innerHTML = '';
    }
    
    const time = new Date(message.timestamp).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.innerHTML = `
        <div class="message-content">
            <div class="message-text">${escapeHtml(message.message)}</div>
            <div class="message-time">${time}</div>
        </div>
    `;
    
    container.appendChild(messageDiv);
    scrollToBottom();
}

// ارسال پیام
function sendMessage() {
    const input = document.getElementById('message-input');
    const message = input.value.trim();
    
    if (!message || !currentChatUser) {
        if (!currentChatUser) alert('لطفاً ابتدا یک کاربر را انتخاب کنید');
        return;
    }
    
    socket.emit('send-message', {
        from: currentUser,
        to: currentChatUser,
        message: message
    });
    
    input.value = '';
    hideTypingIndicator();
}

// مدیریت کلید Enter
function handleKeyPress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
    
    if (currentChatUser && socket) {
        socket.emit('typing-start', { to: currentChatUser, from: currentUser });
        
        if (typingTimeout) clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            socket.emit('typing-stop', { to: currentChatUser, from: currentUser });
        }, 1000);
    }
}

// نمایش اندیکیتور تایپ
function showTypingIndicator(username) {
    const indicator = document.getElementById('typing-indicator');
    indicator.innerHTML = `✍️ ${escapeHtml(username)} در حال نوشتن...`;
}

// مخفی کردن اندیکیتور تایپ
function hideTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    indicator.innerHTML = '';
}

// اسکرول به پایین
function scrollToBottom() {
    const container = document.getElementById('messages-container');
    container.scrollTop = container.scrollHeight;
}

// توابع کمکی
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showAuthMessage(msg, type) {
    const box = document.getElementById('auth-message');
    box.textContent = msg;
    box.className = `message-box ${type}`;
    box.style.display = 'block';
    setTimeout(() => {
        box.style.display = 'none';
    }, 3000);
}

function showRegister() {
    document.getElementById('login-section').style.display = 'none';
    document.getElementById('register-section').style.display = 'block';
    document.getElementById('auth-message').style.display = 'none';
}

function showLogin() {
    document.getElementById('register-section').style.display = 'none';
    document.getElementById('login-section').style.display = 'block';
    document.getElementById('auth-message').style.display = 'none';
}

// بررسی ذخیره شده در localStorage
window.onload = () => {
    const savedUser = localStorage.getItem('messenger-user');
    if (savedUser) {
        document.getElementById('login-username').value = savedUser;
    }
};
