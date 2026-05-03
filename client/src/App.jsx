import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import QRCode from "qrcode";

const API = import.meta.env.PROD ? "" : "http://localhost:3001";
const SOCKET_URL = import.meta.env.PROD ? "/" : "http://localhost:3001";

// ── Helpers ────────────────────────────────────────────────────────────────

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}sa ${m}dk`;
  if (m > 0) return `${m}dk ${s}s`;
  return `${s}s`;
}

function getFileIcon(name) {
  const ext = name.split(".").pop().toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext)) return "🖼";
  if (["pdf"].includes(ext)) return "📄";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "📦";
  if (["mp4", "mov", "avi", "mkv"].includes(ext)) return "🎬";
  if (["mp3", "wav", "ogg", "flac"].includes(ext)) return "🎵";
  if (["doc", "docx"].includes(ext)) return "📝";
  if (["xls", "xlsx"].includes(ext)) return "📊";
  if (["ppt", "pptx"].includes(ext)) return "📑";
  if (["js", "ts", "jsx", "tsx", "py", "go", "rs", "cpp", "c", "java"].includes(ext)) return "💻";
  return "📁";
}

// ── QR Modal ───────────────────────────────────────────────────────────────

function QRModal({ code, onClose }) {
  const canvasRef = useRef();

  useEffect(() => {
    const url = `${window.location.origin}?join=${code}`;
    QRCode.toCanvas(canvasRef.current, url, {
      width: 220,
      margin: 2,
      color: { dark: "#e8ff47", light: "#161616" }
    });
  }, [code]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-title">QR ile Paylaş</div>
        <div className="modal-sub">Kamerayı tut, oda açılsın</div>
        <canvas ref={canvasRef} className="qr-canvas" />
        <div className="modal-code">{code}</div>
        <button className="modal-close" onClick={onClose}>Kapat</button>
      </div>
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState("home");
  const [codeInput, setCodeInput] = useState("");
  const [room, setRoom] = useState(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [timeLeft, setTimeLeft] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [newFileIds, setNewFileIds] = useState(new Set());

  const fileRef = useRef();
  const timerRef = useRef();
  const socketRef = useRef(null);

  // ── Check URL param ?join=XXXXXX ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get("join");
    if (joinCode && /^\d{6}$/.test(joinCode)) {
      setCodeInput(joinCode);
      handleJoinRoom(joinCode);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // ── Socket.io ─────────────────────────────────────────────
  const connectSocket = useCallback((code) => {
    if (socketRef.current) socketRef.current.disconnect();

    const socket = io(SOCKET_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join_room", code);
    });

    socket.on("files_updated", ({ files, totalSize }) => {
      setRoom(prev => {
        if (!prev) return prev;
        // Highlight newly added files
        const prevIds = new Set(prev.files.map(f => f.id));
        const added = files.filter(f => !prevIds.has(f.id)).map(f => f.id);
        if (added.length) {
          setNewFileIds(ids => {
            const next = new Set([...ids, ...added]);
            setTimeout(() => {
              setNewFileIds(cur => {
                const cleared = new Set(cur);
                added.forEach(id => cleared.delete(id));
                return cleared;
              });
            }, 1800);
            return next;
          });
        }
        return { ...prev, files, totalSize };
      });
    });

    socket.on("room_expired", () => {
      cleanup();
      setError("Odanın süresi doldu. Tüm dosyalar silindi.");
    });

    return socket;
  }, []);

  function cleanup() {
    if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
    clearInterval(timerRef.current);
    setScreen("home");
    setRoom(null);
    setTimeLeft(null);
  }

  // ── Countdown timer ───────────────────────────────────────
  useEffect(() => {
    if (screen !== "room" || !room?.expiresAt) return;
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        const next = prev - 1000;
        if (next <= 0) { clearInterval(timerRef.current); return 0; }
        return next;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [screen, room?.expiresAt]);

  // ── API helpers ───────────────────────────────────────────
  const fetchRoom = useCallback(async (code) => {
    try {
      const res = await fetch(`${API}/api/rooms/${code}`);
      if (!res.ok) { setError("Oda bulunamadı veya süresi doldu."); return null; }
      return await res.json();
    } catch {
      setError("Sunucuya bağlanılamadı.");
      return null;
    }
  }, []);

  async function createRoom() {
    setError("");
    try {
      const res = await fetch(`${API}/api/rooms`, { method: "POST" });
      const data = await res.json();
      setRoom(data);
      setTimeLeft(data.expiresAt - Date.now());
      setScreen("room");
      connectSocket(data.code);
    } catch {
      setError("Oda oluşturulamadı. Sunucu bağlantısını kontrol et.");
    }
  }

  async function handleJoinRoom(code) {
    setError("");
    const data = await fetchRoom(code);
    if (!data) return;
    setRoom(data);
    setTimeLeft(data.expiresAt - Date.now());
    setScreen("room");
    connectSocket(code);
  }

  async function joinRoom() {
    const code = codeInput.trim();
    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      setError("6 haneli bir sayı gir.");
      return;
    }
    await handleJoinRoom(code);
  }

  async function uploadFiles(files) {
    if (!files.length) return;
    setUploading(true);
    setUploadProgress(0);
    setError("");
    let done = 0;
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      try {
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.upload.onprogress = e => {
            if (e.lengthComputable) {
              const pct = Math.round(((done + e.loaded / e.total) / files.length) * 100);
              setUploadProgress(pct);
            }
          };
          xhr.onload = () => { done++; resolve(); };
          xhr.onerror = () => reject(new Error("Upload failed"));
          xhr.open("POST", `${API}/api/rooms/${room.code}/upload`);
          xhr.send(form);
        });
      } catch {
        setError(`"${file.name}" yüklenemedi.`);
      }
    }
    setUploading(false);
    setUploadProgress(0);
  }

  async function deleteFile(fileId) {
    await fetch(`${API}/api/rooms/${room.code}/files/${fileId}`, { method: "DELETE" });
  }

  function downloadFile(file) {
    window.open(`${API}/api/rooms/${room.code}/files/${file.id}`, "_blank");
  }

  function downloadAll() {
    window.open(`${API}/api/rooms/${room.code}/download-all`, "_blank");
  }

  function copyCode() {
    navigator.clipboard.writeText(room.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) uploadFiles(files);
  }, [room]);

  const usedPct = room ? Math.min(100, ((room.totalSize || 0) / (1024 ** 3)) * 100) : 0;

  // ── Home Screen ───────────────────────────────────────────
  if (screen === "home") {
    return (
      <div className="page">
        <div className="hero">
          <div className="logo">
            <div className="logo-icon">↑↓</div>
            <span className="logo-text">FileDrop</span>
          </div>
          <p className="tagline">Şifreli oda — 1 saat — dosyalar otomatik silinir</p>

          {error && <div className="error-box">{error}</div>}

          <div className="card-grid">
            <button className="action-card primary" onClick={createRoom}>
              <span className="card-icon">+</span>
              <span className="card-label">Yeni Oda Oluştur</span>
              <span className="card-sub">6 haneli kod alırsın</span>
            </button>

            <div className="action-card">
              <span className="card-icon">#</span>
              <span className="card-label">Odaya Katıl</span>
              <div className="code-input-row">
                <input
                  id="room-code-input"
                  className="code-input"
                  placeholder="000000"
                  maxLength={6}
                  value={codeInput}
                  onChange={e => setCodeInput(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={e => e.key === "Enter" && joinRoom()}
                />
                <button id="join-btn" className="join-btn" onClick={joinRoom}>Gir →</button>
              </div>
            </div>
          </div>

          <div className="features-row">
            <span className="feature-pill">🔒 Şifresiz, anonim</span>
            <span className="feature-pill">⚡ Gerçek zamanlı</span>
            <span className="feature-pill">📦 1 GB oda</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Room Screen ───────────────────────────────────────────
  return (
    <div className="page">
      {showQR && <QRModal code={room?.code} onClose={() => setShowQR(false)} />}

      <div className="room-layout">
        <header className="room-header">
          <button className="back-btn" onClick={() => { cleanup(); }}>← Geri</button>

          <div className="room-code-badge" onClick={copyCode} title="Kopyala">
            <span className="badge-label">Oda Kodu</span>
            <span className="badge-code">{room?.code}</span>
            <span className="badge-copy">{copied ? "✓" : "⧉"}</span>
          </div>

          <button className="qr-btn" onClick={() => setShowQR(true)} title="QR Kod">
            <span>▦</span>
          </button>

          <div className={`timer ${timeLeft !== null && timeLeft < 300000 ? "timer-warn" : ""}`}>
            {timeLeft != null ? `⏱ ${formatTime(timeLeft)}` : "—"}
          </div>
        </header>

        {error && <div className="error-box">{error}</div>}

        <div
          className={`drop-zone ${dragging ? "drop-active" : ""} ${uploading ? "uploading" : ""}`}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !uploading && fileRef.current.click()}
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={e => uploadFiles(Array.from(e.target.files))}
          />
          {uploading ? (
            <div className="upload-progress">
              <div className="progress-bar"><div className="progress-fill" style={{ width: `${uploadProgress}%` }} /></div>
              <span className="upload-pct">{uploadProgress}%</span>
            </div>
          ) : (
            <div className="drop-content">
              <span className="drop-icon">↑</span>
              <span className="drop-text">{dragging ? "Bırak!" : "Dosya yükle veya sürükle"}</span>
              <span className="drop-hint">Birden fazla dosya seçebilirsin</span>
            </div>
          )}
        </div>

        <div className="storage-row">
          <div className="storage-bar">
            <div className="storage-fill" style={{ width: `${usedPct}%` }} />
          </div>
          <span className="storage-label">{formatSize(room?.totalSize || 0)} / 1 GB</span>
        </div>

        <div className="file-list-header">
          <span className="file-list-title">
            Dosyalar {room?.files?.length ? `(${room.files.length})` : ""}
          </span>
          {room?.files?.length > 1 && (
            <button className="download-all-btn" onClick={downloadAll}>
              ↓ Tümünü ZIP İndir
            </button>
          )}
        </div>

        <div className="file-list">
          {(!room?.files || room.files.length === 0) ? (
            <div className="empty-state">
              <span className="empty-icon">📂</span>
              <span>Henüz dosya yok. Yukarıdan yükle.</span>
            </div>
          ) : room.files.map(f => (
            <div
              className={`file-row ${newFileIds.has(f.id) ? "file-row-new" : ""}`}
              key={f.id}
            >
              <span className="file-icon">{getFileIcon(f.originalName)}</span>
              <span className="file-name" title={f.originalName}>{f.originalName}</span>
              <span className="file-size">{formatSize(f.size)}</span>
              <button className="file-btn download" onClick={() => downloadFile(f)} title="İndir">↓</button>
              <button className="file-btn delete" onClick={() => deleteFile(f.id)} title="Sil">×</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
