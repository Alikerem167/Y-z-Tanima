// --- mevcut kodun (değiştirmiyoruz) ---
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

// ========== SLIDER yardımcıları ==========
// 1) DÜZGÜN başlık/paragraf ayrıştırıcı (regex'siz, satır satır)
function parseSectionsFromMarkdown(md){
  const lines = (md || "").split(/\r?\n/);
  const sections = [];
  let cur = null;

  const push = () => {
    if (cur) {
      // biriken satırları tek metne çevir
      cur.text = cur.buffer.join("\n").trim();
      sections.push({ title: cur.title, text: cur.text });
      cur = null;
    }
  };

  for (let raw of lines){
    const line = raw; // bozmadan al
    const h = line.match(/^(#{1,2})\s+(.+?)\s*$/); // # veya ## başlık
    if (h){
      push();
      cur = { level: h[1].length, title: h[2], buffer: [] };
      continue;
    }
    if (!cur){
      // başlıktan önce gelen satırlar → "Analiz" bölümüne gider
      cur = { level: 1, title: "Analiz", buffer: [] };
    }
    cur.buffer.push(line); // olduğu gibi ekle (Türkçe harfler, virgüller vs. korunur)
  }
  push();

  return sections.length ? sections : [{ title: "Analiz", text: md || "" }];
}

// 2) Basit ama sağlam markdown → HTML çevirici
function mdToHtml(md){
  if (!md) return "";

  // Kalın
  let s = md.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Listeleri blok halinde işle: ardışık "- " satırlarını <ul><li>...</li></ul> yap
  const out = [];
  const lines = s.split(/\r?\n/);
  let listBuf = [];

  const flushList = () => {
    if (listBuf.length){
      out.push("<ul>" + listBuf.map(x=>`<li>${x}</li>`).join("") + "</ul>");
      listBuf = [];
    }
  };

  for (const ln of lines){
    const m = ln.match(/^\s*-\s+(.*)$/);
    if (m){
      listBuf.push(m[1]);
    } else {
      flushList();
      out.push(ln);
    }
  }
  flushList();

  // Boş satırlarla paragrafa çevir, tek satır içi \n'leri <br> yap
  return out
    .join("\n")
    .split(/\n{2,}/)
    .map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function buildSlides(sections, perSlide = 4){
  const slides = [];
  for (let i = 0; i < sections.length; i += perSlide){
    slides.push(sections.slice(i, i + perSlide));
  }
  return slides;
}


function renderSlider(md){
  const wrap = document.getElementById('sliderWrap');
  const slider = document.getElementById('slider');
  const dots  = document.getElementById('dots');
  const prev  = document.getElementById('prev');
  const next  = document.getElementById('next');
  if (!wrap || !slider) return;

  const sections = parseSectionsFromMarkdown(md);
  const groups = buildSlides(sections, 4);

  slider.innerHTML = '';
  dots.innerHTML = '';

  groups.forEach((group, idx) => {
    const slide = document.createElement('div');
    slide.className = 'slide';

    const grid = document.createElement('div');
    grid.className = 'grid';

    group.forEach(sec => {
      const card = document.createElement('div');
      card.className = 'card-mini';
      card.innerHTML = `
        <h3>${sec.title}</h3>
        <div class="body">${mdToHtml(sec.text)}</div>
      `;
      grid.appendChild(card);
    });

    slide.appendChild(grid);
    slider.appendChild(slide);

    const dot = document.createElement('div');
    dot.className = 'dot' + (idx===0 ? ' active' : '');
    dots.appendChild(dot);
  });

  const slides = Array.from(slider.querySelectorAll('.slide'));
  let index = 0;
  const go = (i) => {
    index = Math.max(0, Math.min(i, slides.length-1));
    slider.scrollTo({ left: slides[index].offsetLeft, behavior: 'smooth' });
    dots.querySelectorAll('.dot').forEach((d,di)=> d.classList.toggle('active', di===index));
  };
  Array.from(dots.children).forEach((d,i)=> d.onclick = () => go(i));
  prev.onclick = () => go(index-1);
  next.onclick = () => go(index+1);

  slider.addEventListener('scroll', () => {
    const near = slides
      .map((el, i) => ({ i, dist: Math.abs(slider.scrollLeft - el.offsetLeft) }))
      .sort((a,b)=>a.dist-b.dist)[0];
    if (near) {
      dots.querySelectorAll('.dot').forEach((d,di)=> d.classList.toggle('active', di===near.i));
      index = near.i;
    }
  });

  wrap.classList.remove('hidden');
}
out.style.display = 'none';
// ========== ANALYZE BUTONUNUN İÇİNE KURALLI ENTEGRASYON ==========
sendBtn.onclick = async () => {
  const f = fileInput.files[0];
  if (!f) return alert('Fotoğraf seç');
  if (f.size > 5 * 1024 * 1024) return alert('Dosya 5MB’den küçük olmalı.');

  const fd = new FormData();
  fd.append('photo', f);

  setBusy(true);
  show('Yükleniyor ve analiz ediliyor...');
  const res = await postForm(`${API}/analyze?mode=prose`, fd);

  // Yetkisiz ise OTP’ye dön
  if (res.status === 401 || res.status === 403) {
    show('Oturum geçersiz/sona ermiş. Giriş sayfasına yönlendiriliyorsun…');
    setTimeout(() => { location.href = 'login.html'; }, 600);
    return;
  }

  setBusy(false);

  // Debug çıktısı (istersen bırak)
  show(`analyze -> ${res.status}\n` + JSON.stringify(res.data, null, 2));

  // ✅ SLIDER’I BURADA ÇAĞIR
  if (res.ok && res.data && (res.data.format === 'markdown' || typeof res.data.text === 'string')){
    const md = res.data.text || '';
    renderSlider(md);
    // debug’u gizlemek istersen:
    // out.style.display = 'none';
  }
};
