const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ===== تنظیم دیتابیس =====
const db = new sqlite3.Database('./messenger.db');

db.serialize(() => {
  // جدول کاربران
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // جدول پیام‌ها
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user TEXT NOT NULL,
      to_user TEXT NOT NULL,
      message TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  console.log('✅ دیتابیس آماده است');
});

// ذخیره کاربران آنلاین
const onlineUsers = new Map();

// ===== API Route‌ها =====

// ثبت نام کاربر جدید
app.post('/api/register', (req, res) => {
  const { username } = req.body;
  
  if (!username || username.trim() === '') {
    return res.json({ success: false, error: 'نام کاربری نمی‌تواند خالی باشد' });
  }
  
  db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => {
    if (row) {
      res.json({ success: false, error: 'این نام کاربری قبلاً ثبت شده است' });
    } else {
      db.run('INSERT INTO users (username) VALUES (?)', [username], function(err) {
        if (err) {
          res.json({ success: false, error: 'خطا در ثبت نام' });
        } else {
          res.json({ success: true, userId: this.lastID, username: username });
        }
      });
    }
  });
});

// ورود کاربر
app.post('/api/login', (req, res) => {
  const { username } = req.body;
  
  db.get('SELECT id, username FROM users WHERE username = ?', [username], (err, row) => {
    if (row) {
      res.json({ success: true, userId: row.id, username: row.username });
    } else {
      res.json({ success: false, error: 'کاربر یافت نشد. ابتدا ثبت نام کنید.' });
    }
  });
});

// دریافت لیست همه کاربران
app.get('/api/users', (req, res) => {
  const currentUser = req.headers['x-user'];
  
  db.all('SELECT id, username FROM users WHERE username != ?', [currentUser], (err, rows) => {
    if (err) {
      res.json({ success: false, error: err.message });
    } else {
      // اضافه کردن وضعیت آنلاین
      const usersWithStatus = rows.map(user => ({
        ...user,
        isOnline: onlineUsers.has(user.username)
      }));
      res.json({ success: true, users: usersWithStatus });
    }
  });
});

// دریافت تاریخچه پیام‌ها
app.get('/api/messages/:otherUser', (req, res) => {
  const currentUser = req.headers['x-user'];
  const otherUser = req.params.otherUser;
  
  db.all(`
    SELECT * FROM messages 
    WHERE (from_user = ? AND to_user = ?) 
       OR (from_user = ? AND to_user = ?)
    ORDER BY timestamp ASC
    LIMIT 100
  `, [currentUser, otherUser, otherUser, currentUser], (err, rows) => {
    if (err) {
      res.json({ success: false, error: err.message });
    } else {
      res.json({ success: true, messages: rows });
    }
  });
});

// ===== WebSocket برای پیام‌های لحظه‌ای =====

io.on('connection', (socket) => {
  console.log('یک کاربر متصل شد');
  
  let currentUser = null;
  
  // ثبت نام کاربر در Socket
  socket.on('user-online', (username) => {
    currentUser = username;
    onlineUsers.set(username, socket.id);
    console.log(`📱 ${username} آنلاین شد`);
    
    // اطلاع به همه کاربران آنلاین
    io.emit('online-users', Array.from(onlineUsers.keys()));
  });
  
  // دریافت پیام جدید
  socket.on('send-message', (data) => {
    const { from, to, message } = data;
    
    // ذخیره در دیتابیس
    db.run(
      'INSERT INTO messages (from_user, to_user, message) VALUES (?, ?, ?)',
      [from, to, message],
      function(err) {
        if (!err) {
          const messageData = {
            id: this.lastID,
            from_user: from,
            to_user: to,
            message: message,
            timestamp: new Date().toISOString()
          };
          
          // ارسال به گیرنده اگر آنلاین است
          const receiverSocketId = onlineUsers.get(to);
          if (receiverSocketId) {
            io.to(receiverSocketId).emit('new-message', messageData);
          }
          
          // ارسال تایید به فرستنده
          socket.emit('message-sent', messageData);
        }
      }
    );
  });
  
  // شروع تایپ کردن
  socket.on('typing-start', (data) => {
    const { to, from } = data;
    const receiverSocketId = onlineUsers.get(to);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('user-typing', { from });
    }
  });
  
  // قطع تایپ کردن
  socket.on('typing-stop', (data) => {
    const { to, from } = data;
    const receiverSocketId = onlineUsers.get(to);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('user-stop-typing', { from });
    }
  });
  
  // قطع ارتباط
  socket.on('disconnect', () => {
    if (currentUser) {
      onlineUsers.delete(currentUser);
      console.log(`📱 ${currentUser} آفلاین شد`);
      io.emit('online-users', Array.from(onlineUsers.keys()));
    }
  });
});

// اجرای سرور
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 سرور روی پورت ${PORT} اجرا شد`);
  console.log(`📱 آدرس: http://localhost:${PORT}`);
});
