import { useState, useEffect, useRef, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3001";

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}s ${m % 60}d`;
  if (m > 0) return `${m}d ${s % 60}s`;
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
  return "📁";
}

export default function App() {
  const [screen, setScreen] = useState("home"); // home | room
  const [codeInput, setCodeInput] = useState("");
  const [room, setRoom] = useState(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [timeLeft, setTimeLeft] = useState(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef();
  const pollRef = useRef();
  const timerRef = useRef();

  const fetchRoom = useCallback(async (code) => {
    try {
      const res = await fetch(`${API}/api/rooms/${code}`);
      if (!res.ok) {
        setScreen("home");
        setRoom(null);
        setError("Oda bulunamadı veya süresi doldu.");
        return;
      }
      const data = await res.json();
      setRoom(data);
      setTimeLeft(data.expiresAt - Date.now());
    } catch {
      setError("Sunucuya bağlanılamadı.");
    }
  }, []);

  useEffect(() => {
    if (screen !== "room" || !room) return;
    pollRef.current = setInterval(() => fetchRoom(room.code), 5000);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1000) {
          clearInterval(pollRef.current);
          clearInterval(timerRef.current);
          setScreen("home");
          setRoom(null);
          setError("Odanın süresi doldu. Tüm dosyalar silindi.");
          return 0;
        }
        return prev - 1000;
      });
    }, 1000);
    return () => {
      clearInterval(pollRef.current);
      clearInterval(timerRef.current);
    };
  }, [screen, room?.code, fetchRoom]);

  async function createRoom() {
    setError("");
    try {
      const res = await fetch(`${API}/api/rooms`, { method: "POST" });
      const data = await res.json();
      setRoom(data);
      setTimeLeft(data.expiresAt - Date.now());
      setScreen("room");
    } catch {
      setError("Oda oluşturulamadı. Sunucu bağlantısını kontrol et.");
    }
  }

  async function joinRoom() {
    setError("");
    const code = codeInput.trim();
    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      setError("6 haneli bir sayı gir.");
      return;
    }
    await fetchRoom(code);
    setScreen("room");
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
        const xhr = new XMLHttpRequest();
        await new Promise((resolve, reject) => {
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
    await fetchRoom(room.code);
  }

  async function deleteFile(fileId) {
    await fetch(`${API}/api/rooms/${room.code}/files/${fileId}`, { method: "DELETE" });
    await fetchRoom(room.code);
  }

  function downloadFile(file) {
    window.open(`${API}/api/rooms/${room.code}/files/${file.id}`, "_blank");
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
                  className="code-input"
                  placeholder="000000"
                  maxLength={6}
                  value={codeInput}
                  onChange={e => setCodeInput(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={e => e.key === "Enter" && joinRoom()}
                />
                <button className="join-btn" onClick={joinRoom}>Gir →</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="room-layout">
        <header className="room-header">
          <button className="back-btn" onClick={() => { setScreen("home"); setRoom(null); }}>← Geri</button>
          <div className="room-code-badge" onClick={copyCode} title="Kopyala">
            <span className="badge-label">Oda Kodu</span>
            <span className="badge-code">{room?.code}</span>
            <span className="badge-copy">{copied ? "✓" : "⧉"}</span>
          </div>
          <div className={`timer ${timeLeft < 300000 ? "timer-warn" : ""}`}>
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
              <span>{uploadProgress}%</span>
            </div>
          ) : (
            <div className="drop-content">
              <span className="drop-icon">↑</span>
              <span className="drop-text">{dragging ? "Bırak!" : "Dosya yükle veya sürükle"}</span>
            </div>
          )}
        </div>

        <div className="storage-bar">
          <div className="storage-fill" style={{ width: `${usedPct}%` }} />
          <span className="storage-label">{formatSize(room?.totalSize || 0)} / 1 GB kullanıldı</span>
        </div>

        <div className="file-list">
          {(!room?.files || room.files.length === 0) ? (
            <div className="empty-state">Henüz dosya yok. Yukarıdan yükle.</div>
          ) : room.files.map(f => (
            <div className="file-row" key={f.id}>
              <span className="file-icon">{getFileIcon(f.originalName)}</span>
              <span className="file-name">{f.originalName}</span>
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
