(function(){
      const code = document.getElementById('code');
      const verify = document.getElementById('verify');
      const send = document.getElementById('send');
      const phone = document.getElementById('phone');

      const lock = () => verify.disabled = (code.value.trim().length !== 6);
      code.addEventListener('input', lock);
      lock();

      // Basit telefon temizleme (boşluk vs.)
      phone.addEventListener('blur', () => {
        phone.value = phone.value.replace(/\s+/g,'');
      });

      // Gönder sonrası 60sn buton kilidi (backend throttle ile uyumlu)
      let t;
      send.addEventListener('click', () => {
        if (t) clearInterval(t);
        let s = 60;
        send.disabled = true;
        const originText = send.textContent;
        t = setInterval(() => {
          s--;
          send.textContent = s > 0 ? `Kodu Gönder (${s})` : originText;
          if (s <= 0){ clearInterval(t); send.disabled = false; }
        }, 1000);
      }, { once:false });
    })();