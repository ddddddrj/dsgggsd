// src/entries/glock18c.js
boot(glock18c_default, LIB).catch((e) => {
  console.error(e);
  const b = document.getElementById("boot-t");
  if (b) b.textContent = "Ошибка: " + e.message;
});

