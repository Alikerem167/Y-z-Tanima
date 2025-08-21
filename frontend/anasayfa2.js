 (() => {
      const wrap = document.querySelector('.file');
      const input = document.getElementById('file');
      ['dragenter','dragover'].forEach(ev => wrap.addEventListener(ev, e => {
        e.preventDefault(); wrap.style.borderColor = 'rgba(255,255,255,.5)';
      }));
      ['dragleave','drop'].forEach(ev => wrap.addEventListener(ev, e => {
        e.preventDefault(); wrap.style.borderColor = 'rgba(255,255,255,.18)';
      }));
      wrap.addEventListener('drop', e => {
        const file = e.dataTransfer.files?.[0];
        if (file) input.files = e.dataTransfer.files;
      });
    })();