// server.js
"use strict";

/* -------------------- Bağımlılıklar -------------------- */
require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const saltRounds = 10;

const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

const Database = require("better-sqlite3");
const db = new Database("veritabani.db");

const crypto = require("crypto");

/* OpenAI */
const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* -------------------- App -------------------- */
const app = express();
const PORT = process.env.PORT || 3000;

/* -------------------- Orta katmanlar -------------------- */
app.use(helmet());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 dk
    max: 300,                  // 300 istek
    standardHeaders: true,
    legacyHeaders: false,
  })
);
app.use(cors());
app.use(express.json({ limit: "2mb" })); // JSON body
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "frontend"))); // statik dosyalar

// Basit log
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

/* -------------------- Yardımcılar -------------------- */
function now() {
  return Date.now();
}
function hash(str) {
  return crypto.createHash("sha256").update(String(str)).digest("hex");
}
/** TR varsayımıyla normalize: 0XXXXXXXXXX / +90XXXXXXXXXX / XXXXXXXXXX => 90XXXXXXXXXX */
function normalizePhone(raw) {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.startsWith("90") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 11) return "9" + digits; // 0XXXXXXXXXX -> 90XXXXXXXXXX
  if (digits.length === 10) return "90" + digits; // XXXXXXXXXX -> 90XXXXXXXXXX
  return digits; // bilinmiyorsa olduğu gibi
}

/* -------------------- DB Şeması -------------------- */
db.prepare(`
  CREATE TABLE IF NOT EXISTS kullanicilar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    phone TEXT UNIQUE
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT,
    code_hash TEXT,
    expires_at INTEGER,
    attempts INTEGER DEFAULT 0,
    created_at INTEGER
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    created_at INTEGER
  )
`).run();

// Eski kolon ekleme denemesi (idempotent)
try {
  db.prepare(`ALTER TABLE kullanicilar ADD COLUMN phone TEXT UNIQUE`).run();
} catch (_e) {
  /* zaten var ise sessiz geç */
}

/* -------------------- Upload sayacı -------------------- */
function dailyCount(userId) {
  const since = now() - 24 * 60 * 60 * 1000;
  const r = db
    .prepare(
      "SELECT COUNT(*) AS c FROM uploads WHERE user_id = ? AND created_at > ?"
    )
    .get(userId, since);
  return r.c;
}
function addUpload(userId) {
  db.prepare("INSERT INTO uploads (user_id, created_at) VALUES (?, ?)").run(
    userId,
    now()
  );
}

/* -------------------- Multer -------------------- */
const multer = require("multer");
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

/* -------------------- Auth: JWT middleware -------------------- */
function verifyToken(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) return res.status(401).json({ error: "Token gerekli!" });

  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) return res.status(403).json({ error: "Token geçersiz!" });
    // payload: { id, phone, username }
    req.user = payload;
    next();
  });
}

/* -------------------- OTP: Gönder -------------------- */
app.post("/send-otp", (req, res) => {
  const raw = req.body?.phone;
  if (!raw) return res.status(400).json({ error: "Telefon gerekli" });
  const phone = normalizePhone(raw);

  // Aynı telefona 60 sn throttle
  const last = db
    .prepare(
      "SELECT created_at FROM otps WHERE phone=? ORDER BY id DESC LIMIT 1"
    )
    .get(phone);
  if (last && now() - last.created_at < 60 * 1000) {
    return res
      .status(429)
      .json({ error: "Çok hızlı! 1 dakika sonra tekrar dene." });
  }

  // Süresi geçenleri temizle (hafif)
  db.prepare("DELETE FROM otps WHERE expires_at < ?").run(now());

  const code = String(crypto.randomInt(100000, 1000000)); // 6 haneli güvenli RNG
  const expires = now() + 5 * 60 * 1000; // 5 dk

  db.prepare(
    "INSERT INTO otps (phone, code_hash, expires_at, created_at, attempts) VALUES (?, ?, ?, ?, 0)"
  ).run(phone, hash(code), expires, now());

  // DEV: SMS yok, konsola yaz
  console.log(`[DEV] OTP for ${phone}: ${code}`);

  return res.json({ ok: true, mesaj: "Doğrulama kodu gönderildi" });
});

/* -------------------- OTP: Doğrula -------------------- */
app.post("/verify-otp", (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const code = req.body?.code;
  if (!phone || !code)
    return res.status(400).json({ error: "Telefon ve kod gerekli" });

  const row = db
    .prepare("SELECT * FROM otps WHERE phone=? ORDER BY id DESC LIMIT 1")
    .get(phone);

  if (!row) return res.status(400).json({ error: "Kod bulunamadı" });
  if (row.expires_at < now())
    return res.status(400).json({ error: "Kodun süresi dolmuş" });
  if (row.attempts >= 5)
    return res.status(429).json({ error: "Çok fazla deneme. Yeni kod iste." });

  if (row.code_hash !== hash(code)) {
    db.prepare("UPDATE otps SET attempts = attempts + 1 WHERE id = ?").run(
      row.id
    );
    return res.status(400).json({ error: "Kod hatalı" });
  }

  // Tek kullanımlık: doğruysa sil
  db.prepare("DELETE FROM otps WHERE id=?").run(row.id);

  // Kullanıcıyı bul/oluştur
  let user = db
    .prepare("SELECT id, username, phone FROM kullanicilar WHERE phone=?")
    .get(phone);
  if (!user) {
    db.prepare(
      "INSERT INTO kullanicilar (username, password, phone) VALUES (?, ?, ?)"
    ).run(phone, null, phone);
    user = db
      .prepare("SELECT id, username, phone FROM kullanicilar WHERE phone=?")
      .get(phone);
  }

  // Token içine username de koy
  const token = jwt.sign(
    { id: user.id, phone: user.phone, username: user.username },
    JWT_SECRET,
    { expiresIn: "1d" }
  );

  return res.json({ token, mesaj: "Giriş başarılı" });
});




/* -------------------- Görsel Analiz -------------------- */
/* -------------------- OpenAI REST çağrısı fonksiyonu -------------------- */
async function callResponsesDirect(dataUrl) {
  const body = {
    model: "gpt-4o-mini",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
`Rolün:İlm İ Sima Yöntemi Kullanarak Kesinlik İddiası Olmadan Kişinin Yüzünden Karakter Özellkleri Çıkarma Detaylı Ve Uzun Olmalı Ayrıca Yüz Özelliklerine Bakarak Karakteri Hakkında Yorum Yapıcaksın (örn: İşte Çenesi Bu Şekildeyse Karakteri Böyledir Gibi) ayrıca karakteri hakkında falan aşırı detaylı yap işte çenesi böyleyse kararlıdır gözü şöyleyse böyledir gibi ve hepsinde ilmi sima kullan.
YASAK: kimlik, yaş, cinsiyet, etnik köken, sağlık,  ahlaki hüküm, siyaset.
Tarz: nazik, hafif mizahi, kesinlik iddiası yok.
Çıktı JSON şeması: {"genelIzlenim":"","duygu":"","stiller":[],"uyari":""}`
          },
          { type: "input_image", image_url: dataUrl }
        ]
      }
    ],
    text: {
  format: {
    type: "json_schema",
    name: "YuzAnaliz",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        genelIzlenim: { type: "string" },
        duygu: { type: "string" },
        stiller: { type: "array", items: { type: "string" } },
        uyari: { type: "string" }
      },
      required: ["genelIzlenim", "duygu", "stiller", "uyari"]
    }
  }
}
};


  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const errText = await r.text();
    console.error("OpenAI error", r.status, errText);
    throw new Error(`OpenAI ${r.status}`);
  }

  const resp = await r.json();

  // güvenli parse
  const content = resp?.output?.[0]?.content ?? [];
  const part = content.find(c => c && (c.type === "output_text" || c.type === "summary_text"));
  const raw = part?.text ?? resp?.output_text ?? (content[0]?.text ?? "");
  let json;
  try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
  return json ?? { genelIzlenim: "", duygu: "", stiller: [], uyari: "json_parse_error" };
}


/* -------------------- Görsel Analiz -------------------- */
 app.post("/analyze", verifyToken, upload.single("photo"), async (req, res) => {
   try {
     if (!process.env.OPENAI_API_KEY) {
       return res.status(500).json({ error: "OpenAI yapılandırılmamış (OPENAI_API_KEY gerekli)." });
     }
     if (!req.file) return res.status(400).json({ error: "Fotoğraf gerekli" });

     const count = dailyCount(req.user.id);
     if (count >= 3) return res.status(429).json({ error: "Günlük hakkın doldu (3/24s)" });

     const b64 = req.file.buffer.toString("base64");
     const dataUrl = `data:${req.file.mimetype};base64,${b64}`;

     const respJson = await callResponsesDirect(dataUrl);

     addUpload(req.user.id);
     return res.json(respJson);
   } catch (e) {
     console.error(e);
     return res.status(500).json({ error: "Analiz hatası" });
   }
 });



    

    

/* -------------------- Korunan Route: Profil -------------------- */
app.get("/profil", verifyToken, (req, res) => {
  const user = db
    .prepare("SELECT id, username, phone FROM kullanicilar WHERE id=?")
    .get(req.user.id);
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });

  return res.json({
    mesaj: `Merhaba ${user.username || user.phone}, profil sayfana hoş geldin!`,
    user,
  });
});

/* -------------------- Sunucu -------------------- */
app.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor...`);
  if (!process.env.OPENAI_API_KEY) {
    console.warn("Uyarı: OPENAI_API_KEY .env içinde tanımlı değil.");
  }
}); 