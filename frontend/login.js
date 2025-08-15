// /frontend/login.js
(() => {
  const out = document.getElementById('out');
  const sendBtn = document.getElementById('send');
  const verifyBtn = document.getElementById('verify');
  const phoneInput = document.getElementById('phone');
  const codeInput  = document.getElementById('code');

  // --- Yardımcılar ---
  const show = (msg) => { out.textContent = msg; };

  const maskPhone = (p) => {
    // +905551112233 -> +90*****2233 (logu temiz tutalım)
    const s = (p || '').replace(/\s/g, '');
    if (s.length < 6) return s;
    return s.slice(0, 3) + '*****' + s.slice(-4);
  };

  async function postJson(url, body) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
      return { ok: r.ok, status: r.status, data };
    } catch (e) {
      return { ok: false, status: 0, data: { error: e.message } };
    }
  }

  // TR normalize: +905xx..., 905xx..., 0 5xx..., 5xx... hepsi kabul
  function normalizeTR(p) {
    p = (p || '').replace(/\s|\-|\(|\)/g, '');
    if (p.startsWith('00')) p = '+' + p.slice(2);
    if (p.startsWith('0'))  p = '+90' + p.slice(1);
    if (!p.startsWith('+')) p = '+90' + p;
    return p;
  }

  // --- API base ---
  // Geliştirmede sık yaşanan 5500↔3000 karmaşasını engellemek için:
  // Eğer front 5500'deyse, base'i 3000'e çevir; değilse aynı origin.
  const guessAPI = () => {
    const { origin } = window.location;
    if (origin.includes(':5500')) return origin.replace(':5500', ':3000');
    return origin; // prod’da aynı domain/port
  };
  const API = guessAPI();

  // --- UI kilitleme/geri açma ---
  function setBusy(busy) {
    sendBtn.disabled = busy;
    verifyBtn.disabled = busy;
    phoneInput.disabled = busy;
    codeInput.disabled = busy;
    sendBtn.textContent = busy ? 'Bekleyin…' : 'Kodu Gönder';
    verifyBtn.textContent = busy ? 'Bekleyin…' : 'Doğrula';
  }

  // --- 429 bekleme geri sayımı (opsiyonel güzellik) ---
  function startCooldown(sec = 60) {
    let left = sec;
    const baseText = 'Çok hızlı istek. Tekrar deneyebilmek için bekleyin: ';
    setBusy(true);
    show(baseText + left + 's');
    const t = setInterval(() => {
      left -= 1;
      show(baseText + left + 's');
      if (left <= 0) {
        clearInterval(t);
        setBusy(false);
        show('Tekrar deneyebilirsin.');
      }
    }, 1000);
  }

  // --- Olaylar ---
  sendBtn.onclick = async () => {
    const phone = normalizeTR(phoneInput.value.trim());
    if (!phone) return show('Telefon gerekli');

    setBusy(true);
    show('Kod gönderiliyor...');
    const res = await postJson(`${API}/send-otp`, { phone });
    setBusy(false);

    // Logu sade göster
    if (res.ok) {
      show(`send-otp ✅ -> ${res.status} ${JSON.stringify(res.data)}\nTelefon: ${maskPhone(phone)}`);
    } else {
      show(`send-otp ❌ -> ${res.status} ${JSON.stringify(res.data)}`);
      if (res.status === 429) startCooldown(60);
    }
  };

  verifyBtn.onclick = async () => {
    const phone = normalizeTR(phoneInput.value.trim());
    const code  = (codeInput.value || '').trim();
    if (!phone || !code) return show('Telefon ve kod gerekli');

    setBusy(true);
    show('Doğrulanıyor...');
    const res = await postJson(`${API}/verify-otp`, { phone, code });

    if (res.ok && res.data.token) {
      // Token’ı sakla
      localStorage.setItem('token', res.data.token);
      show(`verify-otp ✅ -> ${res.status} (giriş başarılı)`);
      // Biraz görünsün:
      setTimeout(() => { location.href = 'anasayfa.html'; }, 400);
    } else {
      setBusy(false);
      show(`verify-otp ❌ -> ${res.status} ${JSON.stringify(res.data)}`);
      // Çok deneme uyarısı vs.
      if (res.status === 429) startCooldown(60);
    }
  };

  // Enter ile hızlandırma:
  phoneInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendBtn.click();
  });
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') verifyBtn.click();
  });

  // Sayfa açılışında küçük bilgi:
  show(`API: ${API}\nTelefonunu yazıp "Kodu Gönder"e tıklayın.`);
})();  