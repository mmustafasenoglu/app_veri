const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const MAX_ROOM_SIZE = 1 * 1024 * 1024 * 1024; // 1 GB
const ROOM_TTL = 60 * 60 * 1000; // 1 hour in ms

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/dist')));

// In-memory room store: { [code]: { files: [], createdAt, totalSize } }
const rooms = {};

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getRoomDir(code) {
  return path.join(UPLOAD_DIR, code);
}

function cleanupRoom(code) {
  const dir = getRoomDir(code);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  delete rooms[code];
  console.log(`Room ${code} deleted.`);
}

// Auto-cleanup expired rooms every 5 min
setInterval(() => {
  const now = Date.now();
  for (const code of Object.keys(rooms)) {
    if (now - rooms[code].createdAt >= ROOM_TTL) {
      cleanupRoom(code);
    }
  }
}, 5 * 60 * 1000);

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const code = req.params.code;
    const room = rooms[code];
    if (!room) return cb(new Error('Room not found'));
    const dir = getRoomDir(code);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = crypto.randomBytes(4).toString('hex');
    cb(null, `${unique}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_ROOM_SIZE }
});

// Create room
app.post('/api/rooms', (req, res) => {
  let code;
  do { code = generateCode(); } while (rooms[code]);
  rooms[code] = { files: [], createdAt: Date.now(), totalSize: 0 };
  fs.mkdirSync(getRoomDir(code), { recursive: true });
  res.json({ code, expiresAt: rooms[code].createdAt + ROOM_TTL });
});

// Join room
app.get('/api/rooms/:code', (req, res) => {
  const { code } = req.params;
  const room = rooms[code];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const now = Date.now();
  if (now - room.createdAt >= ROOM_TTL) {
    cleanupRoom(code);
    return res.status(404).json({ error: 'Room expired' });
  }
  res.json({
    code,
    files: room.files,
    expiresAt: room.createdAt + ROOM_TTL,
    totalSize: room.totalSize
  });
});

// Upload file
app.post('/api/rooms/:code/upload', (req, res) => {
  const { code } = req.params;
  const room = rooms[code];
  if (!room) return res.status(404).json({ error: 'Room not found' });

  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    if (room.totalSize + req.file.size > MAX_ROOM_SIZE) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Room storage limit (1 GB) exceeded' });
    }

    room.totalSize += req.file.size;
    const fileInfo = {
      id: crypto.randomBytes(8).toString('hex'),
      originalName: req.file.originalname,
      storedName: req.file.filename,
      size: req.file.size,
      uploadedAt: Date.now()
    };
    room.files.push(fileInfo);
    res.json(fileInfo);
  });
});

// Download file
app.get('/api/rooms/:code/files/:fileId', (req, res) => {
  const { code, fileId } = req.params;
  const room = rooms[code];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const fileInfo = room.files.find(f => f.id === fileId);
  if (!fileInfo) return res.status(404).json({ error: 'File not found' });
  const filePath = path.join(getRoomDir(code), fileInfo.storedName);
  res.download(filePath, fileInfo.originalName);
});

// Delete file
app.delete('/api/rooms/:code/files/:fileId', (req, res) => {
  const { code, fileId } = req.params;
  const room = rooms[code];
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const idx = room.files.findIndex(f => f.id === fileId);
  if (idx === -1) return res.status(404).json({ error: 'File not found' });
  const fileInfo = room.files[idx];
  const filePath = path.join(getRoomDir(code), fileInfo.storedName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  room.totalSize -= fileInfo.size;
  room.files.splice(idx, 1);
  res.json({ success: true });
});

// Serve React App for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

app.listen(PORT, () => console.log(`FileDrop server running on port ${PORT}`));
