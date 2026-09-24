// src/entries/m870.js
boot(m870_default, LIB).catch((e) => {
  console.error(e);
  const b = document.getElementById("boot-t");
  if (b) b.textContent = "Ошибка: " + e.message;
});

