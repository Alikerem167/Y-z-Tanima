
  const out = document.getElementById('out');
  const fileInput = document.getElementById('file');
  const sendBtn = document.getElementById('send');
  const logoutBtn = document.getElementById('logout');

  // Token kontrolü
  const token = localStorage.getItem('token');
  if (!token) location.href = 'otp.html';

  // API base (5500 ↔ 3000 karmaşasını çöz)
  const guessAPI = () => {
    const { origin } = window.location;
    if (origin.includes(':5500')) return origin.replace(':5500', ':3000');
    return origin; // prod’da aynı origin
  };
  const API = guessAPI();

  const show = (msg) => { out.textContent = msg; };
  const setBusy = (b) => {
    sendBtn.disabled = b;
    logoutBtn.disabled = b;
    fileInput.disabled = b;
    sendBtn.textContent = b ? 'Analiz ediliyor…' : 'Analiz Et';
  };

  logoutBtn.onclick = () => {
    localStorage.removeItem('token');
    location.href = 'login.html';
  };

  // İsteği yapan yardımcı (JSON olmayan cevapları da idare etsin)
  async function postForm(url, formData) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: formData
      });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
      return { ok: r.ok, status: r.status, data };
    } catch (e) {
      return { ok: false, status: 0, data: { error: e.message } };
    }
  }

  sendBtn.onclick = async () => {
    const f = fileInput.files[0];
    if (!f) return alert('Fotoğraf seç');

    // Backend 5MB limit koydu; kullanıcıya erken uyarı verelim
    if (f.size > 5 * 1024 * 1024) {
      return alert('Dosya 5MB’den küçük olmalı.');
    }

    const fd = new FormData();
    fd.append('photo', f);

    setBusy(true);
    show('Yükleniyor ve analiz ediliyor...');
    const res = await postForm(`${API}/analyze`, fd);

    // Yetkisiz ise OTP’ye dön
    if (res.status === 401 || res.status === 403) {
      show('Oturum geçersiz/sona ermiş. Giriş sayfasına yönlendiriliyorsun…');
      setTimeout(() => { location.href = 'login.html'; }, 600);
      return;
    }

    setBusy(false);
    // Sonuçları okunaklı bas
    show(`analyze -> ${res.status}\n` + JSON.stringify(res.data, null, 2));
  };
